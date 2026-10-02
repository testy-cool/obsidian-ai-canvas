# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Always use `pnpm` (pinned via `packageManager` in `package.json`).

- `pnpm run dev` — esbuild watch build with inline sourcemaps, output `main.js`.
- `pnpm run build` — `tsc -noEmit` type check, then esbuild production build.
- `pnpm run deploy` — build and copy `main.js`, `manifest.json`, `styles.css` into the local vault at `/home/testycool/Obsidian-New/.obsidian/plugins/obsidian-ai-canvas` (path is hardcoded in `deploy.mjs`). Reload the plugin in Obsidian afterwards.
- `pnpm run build:diff` — build, then diff the shipped `main.js` against the one that was there before. Use it to prove a cleanup changed nothing in the build. Tree-shaken code never reaches the bundle, so an unused export shows as no change.
- `pnpm test` — run the Vitest suite once (40 files, 508 tests). `pnpm run test:watch` for watch mode.
- Single test file: `pnpm exec vitest run test/mcp.test.ts`. Single test by name: `pnpm exec vitest run -t "name"`.
- `pnpm run lint` — eslint over `src`. Unused imports are auto-fixable, so `pnpm exec eslint src --ext .ts --fix` clears them.
- `pnpm dlx knip` — finds dead files, unused dependencies and exports nothing imports. Config in `knip.json`; it is not a dependency, run it on demand. The tree passes it, so any problem it reports is yours. `no-explicit-any` and `no-non-null-assertion` are off on purpose: Obsidian does not expose the Canvas API, so the internals are untyped by necessity and flagging every one buried the real problems.

### Tests

- Vitest only picks up `test/**/*.test.ts` (see `vitest.config.ts`). The `obsidian` module is aliased to the hand-written mock in `test/__mocks__/obsidian.ts`; extend that mock when a new Obsidian API is used by code under test.
- `vitest.config.ts` loads `.env`. `test/api.test.ts` hits the live Gemini API and skips itself when `GEMINI_API_KEY` is absent; there is no `.env` in the repo, so a clean checkout reports one skipped file. Tests against live MCP are written to stay green when the server is unreachable.
- Test MCP server for development: the Windmill SSE endpoint in the vault plugin's `data.json` at `.mcpServers[0].url` (read it with `jq`; the local runbook has the path). Keep the token out of tracked files.
- The `*.mjs` files in `test/` are manual Gemini debugging scripts, not part of the suite.

## Architecture

An Obsidian plugin that turns Canvas into an AI workspace. Prompt cards produce AI response cards connected by edges, and the chain of connected cards is the conversation history.

### Entry point and canvas patching

`src/AugmentedCanvasPlugin.ts` loads settings (with schema migrations), sets up the Langfuse `ObservabilityClient`, registers the settings tab and commands, then after `onLayoutReady` patches the Canvas with `monkey-around`. Obsidian does not expose Canvas APIs, so the type definitions for its internals live in `src/obsidian/canvas-internal.d.ts` and `src/types/`.

Patching detail that matters: Obsidian defers rendering background canvas tabs, so the menu patch must be bound to an active, rendered canvas. `findCanvasMenuHost` in `src/obsidian/canvas-patches.ts` handles this. `canvas-patches.ts` also owns `createNode`, `addEdge`, and `getIncomingEdgeDirection` (new response cards are placed opposite to the incoming edge).

Two persistence hooks re-attach UI on `active-leaf-change` / `layout-change` because Canvas re-renders its DOM: `setupCanvasIndicatorPersistence` (the `provider • model` badge on generated cards, in `src/utils.ts`) and `setupHtmlPreviewPersistence` (`src/utils/htmlPreview.ts`).

### Generation pipeline

`src/actions/canvasNodeMenuActions/noteGenerator.ts` is the central engine. Flow for "Ask AI":

1. `collectNodeAndAncestors` in `src/obsidian/canvasUtil.ts` walks edges backwards to build the message history; with several ancestors the `PromptContextModal` lets the user pick which to include.
2. A placeholder card and an edge are created, the edge carries `unknownData.isGenerated = true` (this is what enables "Regenerate Response" on the edge menu).
3. `createGenerationStatus` (`src/utils/generationStatus.ts`) draws the in-card status line — phase text, elapsed timer, Stop button — and owns that card's `AbortController`.
4. `streamResponse` from `src/utils/llm.ts` streams into the card, periodically resizing it to a 3:5 aspect ratio. Reasoning deltas render as `<details>` blocks, MCP tool calls render as live status pills, and the status phase follows the stream (`Connecting tools…`, `Thinking…`, `Using <tool>…`).
5. On completion the card's `unknownData` keeps the model, provider, and context counts used for the request; the model badge is drawn, auto-titling runs if enabled, and any ```html fence is mounted as a preview.

Metadata the plugin stores on canvas nodes (`unknownData`): `ai_provider`, `ai_model`, `ai_cost` (dollars, drawn in the badge), `ai_usage` (input, output and cached tokens; the badge shows the cached share), `ai_duration_ms` (shown with the tokens when the card is selected), `ai_context_count` (cards that contributed), `ai_context_total` (all reachable cards), `ai_context_excluded` (card IDs switched off for regeneration), `ai_notes`, `isGenerated`, `imagePrompt`, `questions`.

Cancellation: `abortSignal` threads from `noteGenerator.ts` through `llm.ts` and `ai.ts` into `codexCli.ts`, `cancelActiveGenerations()` stops every running card on plugin unload, and an aborted run must not fall through to the flex/retry fallback in `ai.ts`. `test/codexCancellation.test.ts` and `test/flexFallback.test.ts` guard that.

### Provider routing

- `src/utils/llm.ts` is the thin public router. Text goes to `src/utils/ai.ts` (Vercel AI SDK: `@ai-sdk/openai`, `@ai-sdk/google`, `ai`); image generation lives in `llm.ts` itself as four entry points — `createGeminiImage` (`nano-banana-pro-preview`), `createVertexImage` (Imagen), `createAzureImage` / `createAzureImageEdit` (`gpt-image-2`), and `createImage` for any OpenAI-compatible endpoint (default `dall-e-3`). Whether a model makes images is its `kind` (Text or Image, set per model in the provider's model list); left on Auto, `guessImageModel` in `src/utils/modelKind.ts` guesses from the name, for Azure and Gemini providers only. The backend is then picked by provider type in `generateImage.ts`. Gemini is the best-supported family, not the only one: GPT image models are first-class, so never describe the plugin or its images as Gemini-only.
- `src/utils/codexCli.ts` spawns a local `codex exec` in read-only sandbox mode as a provider. `src/utils/localCli.ts` does the same for Claude, Pi, Hermes and any other command, one adapter each. `docs/local-cli-providers.md` records each CLI's measured invocation and output shape; read it before touching an adapter, and never add one for a CLI you have not run.
- Every non-Google provider (Anthropic, OpenRouter, Groq, Ollama, LiteLLM, Bifrost, custom endpoints) goes through the OpenAI-compatible path. Provider quirks and the Responses API vs Chat Completions choice are handled in `ai.ts` and guarded by `test/aiCompat.test.ts` and `test/flexFallback.test.ts`.
- Desktop builds send Bifrost traffic through Node rather than the renderer: `ai.ts` picks `desktopFetch` (`src/utils/desktopFetch.ts`) when `Platform.isDesktopApp && isBifrostProvider(provider)`, because the gateway rejects browser CORS requests. It pumps one chunk at a time so SSE stays incremental, and `node-fetch` is `require`d lazily so mobile never loads the Node transport. Guarded by `test/desktopFetch.test.ts`.
- Errors from the SDK are unwrapped (`error.cause`, `error.responseBody`, nested `error.data.error.message`) and written onto the card so the user sees gateway rejections without DevTools. Keep that behaviour when touching error paths.
- `src/utils/providerParams.ts` maps per-model parameters (temperature, max tokens, thinking budget). `modelFetch.ts` and `pricingFetch.ts` discover models and prices dynamically from provider APIs and OpenRouter/LiteLLM.

### Provider capabilities

`src/utils/capabilityProbe.ts` sends one real request per capability (`image`, `pdf`, `video`, `youtube`, `search`, `urlContext`) and stores a per-model `capabilityReport` on the provider, with verdicts `yes | no | untested | error | inconclusive`. `getProviderCapabilities()` in `src/utils/providerCapabilities.ts` folds a stored report over static per-family defaults, so a measured probe always beats the guess. Bifrost providers carry a `geminiNative` toggle that routes through Bifrost's Gemini-native path, which is what makes grounding, URL context and YouTube `fileData` work. Covered by `test/capabilityProbe.test.ts` and `test/providerCapabilities.test.ts`. Probing spends real tokens against a budgeted gateway, so never loop it.

### Observability

Tracing is wired, not a stub. `AugmentedCanvasPlugin.ts` builds the Langfuse `ObservabilityClient` and calls `configureLLMObservability`; `observeLLM` in `src/utils/llmObservability.ts` wraps every text generation and calls `client.track()` inside a `finally`, so a tracing failure can never break a response. Text only — image generation is not traced.

### MCP

`src/utils/mcpClient.ts` connects to configured servers (`http`, `sse`, or `websocket` transport) and converts their tool definitions to AI SDK tools with zod schemas, so any model can call them mid-generation.

### HTML previews

`src/utils/htmlPreview.ts` finds ```html fences in text cards and mounts a sandboxed iframe inside the card, with a native-style toolbar (Render/Code toggle, open in an isolated app window). Previews are removed when the fence disappears. This area has had many regressions around Canvas re-rendering and clipping; run `test/htmlPreview.test.ts` and check a real canvas after changing it.

### Settings

`src/settings/AugmentedCanvasSettings.ts` holds the settings interface, defaults, and migrations. `src/settings/SettingsTab.ts` is split into sections (Providers, Models, MCP Servers, Generation, Images, Card Naming, Prompts, Observability) with a cross-section search filter. Styles for it live in `src/styles/settings.css`.

### Where actions live

`src/actions/` mirrors where the action surfaces in the UI: `canvasNodeMenuActions` (card toolbar buttons), `canvasNodeContextMenuActions` (right-click on a card), `canvasContextMenuActions` (right-click on the background), `commands` (command palette). Modals are in `src/Modals/`. Built-in system prompts ship as `src/data/prompts.csv.txt`, parsed by `src/utils/csvUtils.ts`.

### Build notes

`esbuild.config.mjs` bundles to CommonJS `main.js` with `obsidian`, `electron`, CodeMirror and Node builtins external. The `ai` and `@ai-sdk/*` packages are deliberately bundled (the externals filter strips anything starting with `ai`). `DOCUMENTATION.md` is a longer architecture map; keep it in sync when the module layout changes.

## Style

Tabs (width 4), LF, final newline per `.editorconfig`. PascalCase for modal files, camelCase for utilities.

## CRITICAL: Releasing Changes

**EVERY TIME you make code changes, you MUST:**

1. Bump version in `manifest.json`, `package.json`, and `versions.json`
2. Build: `pnpm run build`
3. Commit all files including `main.js`: `git add -A && git commit -m "version: description"`
4. Push: `git push`
5. Tag: `git tag X.Y.Z && git push origin X.Y.Z`
6. Release: `gh release create X.Y.Z main.js manifest.json --title "X.Y.Z" --notes "description"`

Tags are bare `X.Y.Z` (no `v` prefix) since 0.3.x.

**One-liner:**
```bash
# After editing, run:
pnpm run build && git add -A && git commit -m "X.Y.Z: description" && git push && git tag X.Y.Z && git push origin X.Y.Z && gh release create X.Y.Z main.js manifest.json --title "X.Y.Z" --notes "description"
```

Run `pnpm test` before releasing anything that touches providers, MCP, or HTML previews.

## Local runbook

On the development machine an untracked `.claude/rules/local-runbook.md` holds vault paths, provider ids, gateway hosts, Obsidian CLI commands, and the rollback procedure. Read it first when something is broken. It is excluded from git on purpose.

## Other instruction files

`AGENTS.md` (read by Codex, ignored by Claude Code while this file exists) and `DOCUMENTATION.md` are both drifting: each still says 14 test files, and `AGENTS.md` names a `src/openai` directory that no longer exists. Fix them in the same change as the code, or leave them alone deliberately.
