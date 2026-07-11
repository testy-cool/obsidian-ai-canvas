# Provider update: params wiring, Vertex/Azure images, Codex CLI provider

Date: 2026-07-11
Status: approved (scope + approach user-approved; details by executive decision)

## Problem

The 0.2.1 review (xhigh, 14 verified findings) showed the provider-params feature is
UI-only: params are rendered and saved but never reach a request. On top of the fixes,
four features are wanted: current model detection (gpt-5.6 sol/luna/terra), image
generation through Vertex (service-account JSON) and Azure OpenAI (gpt-image-2), and a
local Codex CLI provider using `codex exec` non-interactively.

## Approach

"Targeted seams" (approved): keep the existing `getLlm`/`streamResponse` structure,
add three well-bounded seams — a unified params pipeline, an image-generator
dispatcher, and a Codex adapter module. One spec, staged releases:

| Release | Content |
|---|---|
| 0.2.2 | Params pipeline fixes + gpt-5.x detection (review findings) |
| 0.2.3 | Vertex image generation |
| 0.2.4 | Azure provider (text + images) |
| 0.2.5 | Codex CLI provider |

Each release follows the repo workflow: version bump, build, commit, tag, gh release.

## Stage 1 — Params pipeline (0.2.2)

`src/utils/providerParams.ts` becomes the single source of truth:

- `detectProviderLabel(modelId, providerType)` is the only detection chain;
  `getParamsForModel` delegates to it (removes the duplicated if-chain).
- Precedence inverted: model-ID detection wins when it matches a known family
  (gemini / claude / o-series / gpt-5.x); provider type is the fallback. Fixes
  OpenAI-typed proxies serving Gemini models.
- Detection fixes: gpt-5.x family added to the OpenAI branch
  (`/(?:^|[\/-])gpt-5/` in addition to legacy `o[134]`); Gemini match anchored to
  path segments (no bare-substring hits on aliases like `o3-via-gemini-proxy`);
  non-string modelId guarded (no `toLowerCase` crash on legacy data.json entries).
- `getDefaultProviderParams(modelId, providerType)` becomes model-aware so proxy
  models get seeded defaults matching what the UI displays.

Wiring (headline fix):

- `StreamOptions` and `getResponse` options gain `providerParams`; every call site
  (noteGenerator, runPromptFolder, llm.ts wrapper, title/group generators) resolves
  the active `LLMModel` and forwards `model.providerParams`.
- `getLlm`: native Google providers keep `createScopedGeminiFetch`. OpenAI-compat
  providers (OpenAI/Custom/LiteLLM/Other/Azure) get a body-injection fetch wrapper
  mapping `serviceTier → service_tier`, `reasoningEffort → reasoning_effort`,
  `thinking → thinking` into the chat-completions JSON body (Bifrost/LiteLLM shape).
- `flexFallback` consumer: on flex-tier request failure (429/503), retry once at
  standard tier.

UI:

- Params section ported into `UnifiedProviderModal` (the live edit flow), recomputed
  when the model name field changes. `EditModelModal` deleted (dead code, tree-shaken
  out of the bundle).
- `apiModel` id-vs-name mismatch fixed: adding the first provider stores the model
  **id** so the Default Model dropdown and params section render.

Tests: precedence with mismatched pairs (e.g. `("claude-sonnet-4-6", "Gemini")`),
`detectProviderLabel` coverage, body-injection unit tests.

## Stage 2 — Vertex images (0.2.3)

`generateImage.ts` resolves a generator by provider type; one contract
(`prompt, options → ImageGenerationOutput`):

| Provider type | Function | Auth | Endpoint |
|---|---|---|---|
| Gemini/Google | `createGeminiImage` (existing) | API key | generativelanguage REST |
| Vertex | `createVertexImage` (new) | OAuth from SA JSON | `{location}-aiplatform.googleapis.com/.../models/{model}:generateContent` |
| Azure | `createAzureImage` (new) | `api-key` header | `{endpoint}/openai/v1/images/generations` |
| other | `createImage` (existing) | Bearer | OpenAI-compat |

`createVertexImage` reuses `getVertexAccessToken(serviceAccountJson)`; same nano
banana models, same `responseModalities: ["IMAGE"]` body and response extraction as
the Gemini path — only auth and hostname differ. Vertex becomes selectable in Image
Generation settings; validation requires SA JSON + projectId.

## Stage 3 — Azure provider (0.2.4)

New provider type `"Azure"`: endpoint (e.g.
`https://sfera-2425-resource.services.ai.azure.com`) + API key. No api-version field
— the v1-compat endpoint (`/openai/v1/`) doesn't need one.

- Images: POST `{model, prompt, size, quality, output_format: "png"}`, parse
  `data[0].b64_json`. Quality (low ~15s / medium ~40s / high ~2min) is a dropdown in
  Image Generation settings shown when an Azure provider is selected; default medium.
  Size follows the canvas's landscape orientation (1536x1024). Request shape matches
  the proven Hermes plugin on the Zenbook (`~/.hermes/plugins/image_gen/azure/`).
- Text: `getLlm` treats Azure as OpenAI-compat against `{endpoint}/openai/v1` with
  the `api-key` header. Model fetch tries `/openai/v1/models`, falls back to manual
  deployment-name entry.
- Default image model for Azure: `gpt-image-2`.

## Stage 4 — Codex CLI provider (0.2.5)

Provider type `"Codex"`, desktop-only (`Platform.isDesktopApp` guard). New optional
`binaryPath?: string` on `LLMProvider`.

- Detection probe order: `binaryPath` override → `which codex` → common install dirs
  (`~/.local/share/pnpm`, `~/.local/bin`, `~/.bun/bin`, `/usr/local/bin`,
  `~/.nvm/versions/node/*/bin`, `/opt/homebrew/bin`). Needed because Obsidian's
  Electron gets a minimal PATH. Provider modal shows detected path / not-found status.
- Execution (`src/utils/codexCli.ts`):
  `codex exec --json --ephemeral --skip-git-repo-check -s read-only -C <scratch dir>
  [-m model] [-c model_reasoning_effort=<v>]`, prompt via stdin, system prompt
  prepended (codex has no system-prompt flag). Read-only sandbox: Codex is treated as
  a pure LLM, never an agent with vault access.
- Streaming: parse JSONL events from stdout, forward agent-message deltas through the
  same callback contract `streamResponse` consumers already use. Hooks in at the top
  of `streamResponse`/`getResponse` before any HTTP client is built.
- MCP tools, temperature, max_tokens are ignored for Codex. Timeout:
  `model.timeoutMs` or 300s default; kill the process on timeout, surface stderr tail
  in the Notice on non-zero exit.
- Models: `default` entry (uses `~/.codex/config.toml`, currently gpt-5.6-sol xhigh)
  plus curated `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.3-codex`;
  custom entries allowed. `reasoningEffort` param UI comes from the gpt-5.x detection
  fix in Stage 1.

## Error handling

- Request-path failures keep the existing Notice pattern (status + provider message).
- Flex fallback logs the downgrade via `logDebug` and notices once per generation.
- Codex: binary missing → Notice with probe locations tried and a hint to set the
  path override; non-zero exit → stderr tail; JSONL parse errors fall back to
  `-o <file>` final-message mode.
- Vertex token minting failures surface the Google error body (scope/clock issues).

## Testing

- Unit (vitest, existing `pnpm test` harness): params detection/precedence/injection,
  Codex JSONL event parsing, Azure/Vertex request-builder pure functions.
- E2E per stage before release: build + manual vault check; Azure verified against
  the real `sfera-2425-resource` deployment (key on Zenbook); Codex verified against
  the local binary (`codex-cli 0.144.0`).
- Model IDs verified via `models` CLI on 2026-07-11: gpt-5.6-sol ($5/$30),
  gpt-5.6-terra ($2.5/$15), gpt-5.6-luna ($1/$6), released 2026-07-09.

## Out of scope

- Pre-seeding OpenAI chat models in DEFAULT_SETTINGS (models auto-fetch per provider).
- Azure image *edits* (reference images / multipart) — generation only this round.
- Codex resume/sessions, hooks, or agentic (non-read-only) modes.
