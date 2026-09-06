# Local development workflow

Use this runbook for small fixes to AI Canvas. Keep it current when the workflow
changes. It describes repeatable procedures; individual commits record the
problem, resulting behavior, tradeoffs and verification for each change.

## Where information belongs

| Information | Home |
| --- | --- |
| How to reproduce, edit, verify, install and undo a local fix | This runbook |
| What changed, why, and the evidence for that change | The commit message |
| Behavior that must keep working | Existing or new regression tests |
| Rules every agent must follow | `AGENTS.md`, when editing it is authorized |
| A substantial architectural decision with lasting tradeoffs | A short decision document, when needed |

Avoid a new document for every small edit. Update the relevant procedure when a
fix teaches something reusable. Temporary logs and session transcripts are not
the source of truth for the workflow.

## Start from the reported behavior

1. Read the active brief and repository instructions. Run `git status --short`
   and `git log -5 --oneline`; preserve changes belonging to other work.
2. State the observable acceptance condition. For example: “An empty response
   card shows one status line; Stop preserves partial text; completion removes
   the loading controls.” A screenshot is useful evidence about appearance.
3. Find the owning code with `rg` and `rg --files`. Trace the user's actual
   action before changing helpers or provider configuration.
4. Make the smallest complete change. Reuse existing tests. Add a regression
   test for meaningful failure behavior; ordinary spacing adjustments do not
   need tests that merely repeat the CSS declarations.

The owner's desktop is not a test fixture. Before sending keyboard or mouse
input, or changing window focus, explain the intended action and obtain explicit
agreement. Permission to edit code does not grant permission to control the
desktop. Honor any active prohibition on browser automation, Obsidian GUI or
Obsidian CLI use; an isolated headless browser still counts as browser automation.

## Find the right implementation and checks

Paths below are relative to the repository root.

| Change | Start here | Focused checks under `test/` |
| --- | --- | --- |
| Star button, context selection, response persistence | `src/actions/canvasNodeMenuActions/advancedCanvas.ts`, `noteGenerator.ts` in the same directory | `promptContextRequests.test.ts`, `promptContextSelection.test.ts` |
| Loading controls, timer, Stop, cleanup | `src/utils/generationStatus.ts`, `noteGenerator.ts`, `src/AugmentedCanvasPlugin.ts` | `promptContextRequests.test.ts` |
| Model badge and restoration after rendering | `src/utils.ts` | `promptContextRequests.test.ts` |
| Streaming, provider routing, abort and fallback | `src/utils/llm.ts`, `src/utils/ai.ts`, `src/utils/desktopFetch.ts`, `src/utils/codexCli.ts` | `aiCompat.test.ts`, `desktopFetch.test.ts`, `flexFallback.test.ts`, `codexCancellation.test.ts` |
| Settings, provider editing, capability reports | `src/settings/SettingsTab.ts`, `src/Modals/UnifiedProviderModal.ts`, `src/utils/capabilityProbe.ts` | `settingsLayout.test.ts`, `modalFinesse.test.ts`, `capabilityProbe.test.ts` |
| Trace creation and delivery | `src/utils/llmObservability.ts`, `src/utils/observability.ts` | `llmObservability.test.ts`, `observability.test.ts` |
| HTML previews | `src/utils/htmlPreview.ts` | `htmlPreview.test.ts`, `htmlPreviewSettings.test.ts` |

The deployed stylesheet is `styles.css`. Some settings rules also exist in
`src/styles/settings.css`; inspect both when changing shared rules. The current
build does not copy that file into `styles.css`. Do not assume `main.css` is the
runtime stylesheet. Keep text at least 12px and settings sections on the same
content width.

Loading controls belong outside replaceable markdown, on the card's `nodeEl`.
They must not become saved prompt text. Preserve partial output on cancellation,
prevent fallback after Stop, and clean up timers on success, failure, cancellation,
card deletion and plugin unload. These behaviors already have regression checks.

## Verify at the appropriate level

For example, while working on loading controls:

```sh
pnpm exec vitest run test/promptContextRequests.test.ts test/canvasPerformanceStyles.test.ts
```

Before committing a code checkpoint, run the required repository gates:

```sh
pnpm test
pnpm run build
```

The build type-checks TypeScript and bundles `main.js`. Include that generated
file if it changed. Do not hand-edit it. Vitest uses the Obsidian mock configured
in `vitest.config.ts`; passing those tests does not prove rendered layout.

For request changes, also exercise the real action and configured provider using
synthetic input. The star-button harness pattern is in
`test/promptContextRequests.test.ts`: an isolated canvas implements node creation,
rendering and saving. For live proof, retain the real request implementation
instead of mocking `streamResponse`, save to a temporary canvas, and verify the
saved answer. For Stop, verify retained partial text and no extra generation
request. Never print credentials or private prompts. Verify real model IDs with
the installed `models` CLI rather than inventing them.

The live harnesses used during the September 2026 fixes were temporary scripts;
they are not a checked-in live test command. Preserve a sanitized, reproducible
harness in the repository if it becomes a recurring need. Do not present a
temporary fixture result as an Obsidian GUI test.

For provider failures, separate transport, authentication, model capability and
budget errors before editing UI code. Test the affected model and request route;
a successful connection test does not prove video input or generation works.
Likewise, verify tracing with the ID from a fresh generation in the intended
project, rather than relying on a “connected” label. A gateway budget rejection
does not authorize changing that budget.

For appearance changes, use an explicitly authorized rendered check or user
feedback. Check waiting, streaming and completed cards, readable computed font
sizes, content widths and reduced motion where applicable. If rendered checking
is not authorized, report that limitation separately from test/build results.

## Commit, install and roll back

Create one commit per understandable effect at a verified checkpoint. Stage only
the files owned by the change, then inspect `git diff --cached --check` and
`git diff --cached` before committing. Follow the repository's current message
convention and any attribution required by the active brief.

Use an imperative subject such as `Keep generation feedback to one quiet line`.
The body should explain the problem and resulting behavior, any important
constraint, and what was tested, including limitations. Commit `25e7951` is a
concrete example. Keep general maintenance instructions here rather than copying
them into every commit.

Local installation and a release are separate actions. Do not bump versions,
push, tag or publish a release unless the task authorizes it.

For an authorized local installation:

1. Confirm the intended vault's `.obsidian/plugins/obsidian-ai-canvas` directory.
   Keep private vault paths and credentials out of committed documentation.
2. Back up the installed `main.js` and `styles.css` to a uniquely named directory.
   Record the backup path and the source commit.
3. Copy the verified `main.js` and `styles.css` into that plugin directory. Copy
   `manifest.json` only when an authorized change requires it. Leave `data.json`
   and the user's settings untouched.
4. Compare installed and source files byte-for-byte, or verify their SHA-256
   hashes. A settings hash before and after can confirm settings were preserved
   without displaying their contents.
5. Report the commit, installation result and whether a reload actually occurred.
   Files being copied does not prove that the running plugin loaded them.

`pnpm run deploy` currently builds, copies files, then invokes the Obsidian CLI to
reload the plugin. Do not use it under a no-CLI boundary. The explicit file-copy
procedure above allows installation without controlling the application.

To undo an installation, restore the same files from the recorded backup and
verify the restored bytes. Reload only within the user's authorization. This
restores the plugin artifacts without changing settings or vault content.

Finish with a short report: visible behavior, verification performed, commit hash
and exact subject, installation/reload status, and any remaining uncertainty.
