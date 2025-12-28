# Repository Guidelines

## Project Structure & Module Organization
Source lives in `src/` and is organized by feature area. The plugin entry point is `src/AugmentedCanvasPlugin.ts`. Action handlers are under `src/actions` (commands, canvas node actions, context menus). UI flows are in `src/Modals`, settings UI/data in `src/settings`, Obsidian integration/patches in `src/obsidian`, provider wiring in `src/openai`, shared helpers in `src/utils`, and type stubs in `src/types`. Static assets live in `assets/`. Styling is split across `styles.css`, `main.css`, and `src/styles/settings.css`. Release metadata lives in `manifest.json` and `versions.json`; build tooling is in `esbuild.config.mjs` and `deploy.mjs`.

## Build, Test, and Development Commands
Use `pnpm` (see `packageManager` in `package.json`). Key commands:
- `pnpm install`: install dependencies.
- `pnpm run dev`: build and watch for changes during development.
- `pnpm run build`: type-check with `tsc` then bundle with esbuild for production.
- `pnpm run deploy`: run the build and prepare release artifacts via `deploy.mjs`.
- `pnpm run version`: bump versions and stage `manifest.json` and `versions.json`.

## Coding Style & Naming Conventions
Indent with tabs (4 width), LF, final newline per `.editorconfig`. TypeScript is the primary language; keep new files in the existing folder patterns (PascalCase modals like `src/Modals/InputModal.ts`, camelCase utilities like `src/utils/ai.ts`). ESLint is configured in `.eslintrc` with TypeScript rules; run manually with `pnpm exec eslint src --ext .ts` if needed.

## Testing Guidelines
There is no automated test suite in the repo. Validate changes by running `pnpm run dev` and loading the plugin in Obsidian, then exercising the canvas actions you touched (menu items, commands, and modals). If you add tests in the future, keep them under `tests/` or alongside features with `*.test.ts`.

## Commit & Pull Request Guidelines
Recent commits use short descriptive summaries (sentence-case or imperative). Keep messages concise and scoped to one change. For PRs, include a clear description, list testing performed, link related issues, and add screenshots or GIFs for UI or canvas behavior changes. Update `manifest.json`/`versions.json` only when releasing.

## Security & Configuration Tips
API keys are provided through Obsidian settings; never hardcode credentials or commit local vault paths. If debugging, avoid logging full prompts or secrets outside user-controlled debug mode.
