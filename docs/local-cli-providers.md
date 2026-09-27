# Local CLI providers

The plugin can send a card's chain to an agent CLI installed on the same
computer. Each CLI is described by an adapter in `src/utils/localCli.ts`, and
Codex keeps its own older runner in `src/utils/codexCli.ts`.

Everything below was read from the real command on 2026-09-27, then driven
through the plugin's runner. Do not add an adapter for a CLI whose output you
have not seen: the five differ more than their similar purpose suggests.

## What was measured

| Provider type | Command | Prompt arrives via | Output |
|---|---|---|---|
| `Claude CLI` | `claude -p --output-format stream-json --verbose` | stdin | JSON lines |
| `Pi CLI` | `pi -p --mode text` | positional argument | plain text on stdout |
| `Hermes CLI` | `hermes -z <prompt>` | the `-z` flag | plain text on stdout |
| `Local command` | whatever the binary path is | stdin | plain text on stdout |
| `Codex` | `codex exec --json --ephemeral --skip-git-repo-check -s read-only` | stdin | JSON lines |

Per CLI, the parts that cost time to discover:

- **Claude.** Opens with a run of `system` events for session start and hooks,
  which carry no answer. The answer is in `assistant` events at
  `message.content[].text`. A final `result` event carries real token counts,
  including `cache_read_input_tokens`, which is the only local CLI that reports
  caching. `--verbose` is required alongside `stream-json`.
- **Pi.** Prints a version warning first, on **stderr**, so plain stdout stays
  clean. `--mode json` exists and emits session, agent and message events, but
  text mode is enough and simpler. Takes the prompt as a positional argument,
  not on stdin.
- **Hermes.** `-z` is a top level option and needs no subcommand. Prints the
  answer and nothing else.
- **gemini-cli.** Installed here but refuses to run without credentials
  (`GEMINI_API_KEY`, `GOOGLE_GENAI_USE_VERTEXAI` or `GOOGLE_GENAI_USE_GCA`), so
  it has no preset. Use `Local command` for it once a key is set.
- **Codex.** Reports no token counts at all, so a Codex card shows no cost.

## Rules that apply to all of them

- Desktop only. `Platform.isDesktopApp` is checked before spawning, and the
  error says so rather than failing inside a `require`.
- A model id of `default` sends no model flag, so the CLI uses its own
  configuration. Every adapter offers it first.
- Extra arguments from the provider settings are split on whitespace. Quoted
  arguments are not supported; a flag and its value are two words.
- Tool parts of the message chain are dropped, because none of these take a
  tool list. MCP tools never reach a CLI provider.
- The command runs in a temporary directory, not in a vault or a repository.

## Adding one

1. Run it by hand first and keep the output. `echo prompt | <cli> ...`, or with
   the prompt as an argument if stdin is ignored.
2. Add an adapter to `CLI_ADAPTERS` with its provider type, binary, base
   arguments, how the prompt arrives, and a `parseLine` only if the output is
   JSON lines. No `parseLine` means stdout is streamed as text.
3. Add the provider type to the presets in `src/Modals/UnifiedProviderModal.ts`.
4. Test the argument building, and drive the real binary once.
