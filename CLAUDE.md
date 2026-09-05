# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Always use `pnpm` (pinned via `packageManager` in `package.json`).

- `pnpm run dev` — esbuild watch build with inline sourcemaps, output `main.js`.
- `pnpm run build` — `tsc -noEmit` type check, then esbuild production build.
- `pnpm run deploy` — build and copy `main.js`, `manifest.json`, `styles.css` into the local vault at `/home/testycool/Obsidian-New/.obsidian/plugins/obsidian-ai-canvas` (path is hardcoded in `deploy.mjs`). Reload the plugin in Obsidian afterwards.
- `pnpm test` — run the Vitest suite once. `pnpm run test:watch` for watch mode.
- Single test file: `pnpm exec vitest run test/mcp.test.ts`. Single test by name: `pnpm exec vitest run -t "name"`.
- Lint (no script defined): `pnpm exec eslint src --ext .ts`.

### Tests

- Vitest only picks up `test/**/*.test.ts` (see `vitest.config.ts`). The `obsidian` module is aliased to the hand-written mock in `test/__mocks__/obsidian.ts`; extend that mock when a new Obsidian API is used by code under test.
- `vitest.config.ts` loads `.env`. `test/api.test.ts` needs `GEMINI_API_KEY` and hits the live API. Tests against live MCP are written to stay green when the server is unreachable.
- Test MCP URL for development: `https://windmill.voidxd.cloud/api/mcp/w/main/sse?token=FDYWBRm6fHYwb1DLJ1PHpiuOKTfoH4cp`
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
3. `streamResponse` from `src/utils/llm.ts` streams into the card, periodically resizing it to a 3:5 aspect ratio. Reasoning deltas render as `<details>` blocks and MCP tool calls render as live status pills.
4. On completion the card's `unknownData` gets `ai_model` and `ai_provider`, the model badge is drawn, auto-titling runs if enabled, and any ```html fence is mounted as a preview.

Metadata the plugin stores on canvas nodes (`unknownData`): `ai_provider`, `ai_model`, `isGenerated`, `imagePrompt`, `questions`.

### Provider routing

- `src/utils/llm.ts` is the thin public router. It delegates to `src/utils/ai.ts` (Vercel AI SDK: `@ai-sdk/openai`, `@ai-sdk/google`, `ai`) and also holds image generation for OpenAI and Gemini.
- `src/utils/codexCli.ts` spawns a local `codex exec` in read-only sandbox mode as a provider.
- Every non-Google provider (Anthropic, OpenRouter, Groq, Ollama, LiteLLM, Bifrost, custom endpoints) goes through the OpenAI-compatible path. Provider quirks and the Responses API vs Chat Completions choice are handled in `ai.ts` and guarded by `test/aiCompat.test.ts` and `test/flexFallback.test.ts`.
- Errors from the SDK are unwrapped (`error.cause`, `error.responseBody`, nested `error.data.error.message`) and written onto the card so the user sees gateway rejections without DevTools. Keep that behaviour when touching error paths.
- `src/utils/providerParams.ts` maps per-model parameters (temperature, max tokens, thinking budget). `modelFetch.ts` and `pricingFetch.ts` discover models and prices dynamically from provider APIs and OpenRouter/LiteLLM.

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
