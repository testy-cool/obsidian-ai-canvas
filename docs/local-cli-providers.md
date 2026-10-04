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
| `Pi CLI` | `pi -p --mode json [--fork <id>]` | positional argument | JSON lines |
| `Hermes CLI` | `hermes -z <prompt>` | the `-z` flag | plain text on stdout |
| `Local command` | whatever the binary path is | stdin | plain text on stdout |
| `Codex` | `codex exec --json --ephemeral --skip-git-repo-check -s read-only` | stdin | JSON lines |

Per CLI, the parts that cost time to discover:

- **Claude.** Opens with a run of `system` events for session start and hooks,
  which carry no answer. The answer is in `assistant` events at
  `message.content[].text`. A final `result` event carries real token counts,
  including `cache_read_input_tokens`, which is the only local CLI that reports
  caching. `--verbose` is required alongside `stream-json`.
- **Pi.** Runs in json mode (Pi 1.0.1, measured 2026-10-04): one JSON event per
  line on stdout, warnings on **stderr**. Takes the prompt as a positional
  argument, not on stdin, and waits for more input while stdin is open, so the
  runner closes it. The details that cost time to find:
  - **Events of one turn.** `session`, `agent_start`, `turn_start`, then
    `message_start` and `message_end` for the system message, the user message,
    an injected MCP catalog message, and each assistant message, with
    `message_update` events between the start and end of an assistant message,
    then `turn_end`, `agent_end`, `entry_appended`, `agent_settled`. A run that
    uses tools repeats `turn_start` to `turn_end` once per round, and adds
    `tool_execution_start`, `tool_execution_update` and `tool_execution_end`
    (fields `toolCallId`, `toolName`, `args` or `result`, `isError`) plus
    `toolResult` messages. The assistant `message_update` carries
    `assistantMessageEvent` with `thinking_*`, `text_*` and `toolcall_*` types.
  - **The answer.** The last assistant message of `agent_end.messages`. Its
    `text` parts carry a `textSignature` JSON whose `phase` is `final_answer`;
    `thinking` and `toolCall` parts are not the answer. The plugin shows only
    the answer, and the status line shows "Thinking…" and "Using <tool>…".
  - **Usage and cost.** Every assistant message has `usage` (`input`, `output`,
    `cacheRead`, `cacheWrite`, `reasoning`, `cost.total` in dollars). A run with
    tools has one assistant message per round, so the plugin sums them: in the
    recorded tool run the last message alone was $0.027 of $0.324. `agent_end`
    holds only the messages of that run, also for a fork. `input` leaves out
    `cacheRead`, so the plugin adds it, as it does for Claude.
  - **Cost of a tiny turn.** About 64,000 input tokens before the question,
    because of the system prompt, skills and tools: $0.26 for "reply OK" on
    gpt-5.6-sol with thinking at max, and about $0.03 when the cache is hit.
    A turn takes 16 to 19 s without tools and about 40 s with two rounds of
    tools. A session file is about 287 KB per turn and stays where Pi puts it
    (`~/.pi/agent/sessions`), so `pi --resume` can open it.
  - **Sessions.** The `session` event holds the run's session `id`, and
    `parentSession` (a file path) when the run was a fork. The plugin keeps the
    id on the answer card as `pi_session`. `--fork <id>` copies that session
    into a new one, answers in one run, and leaves the original as it was: a
    fork of the first answer still remembered the first answer after another
    fork had moved on. Measured: `--fork` finds the id from any folder, while
    `--session-id <id>` only finds sessions of the current folder. An unknown id
    makes Pi print `No session found matching '<id>'` on stderr, exit 1 and
    print nothing on stdout; the plugin then runs the whole chain as a fresh
    session and puts a note on the card.
  - **Which cards are sent.** With a session on a card above, the plugin forks
    the nearest one and sends only the cards added since, without the default
    system prompt. With none it sends the whole chain as one prompt, as for the
    other CLIs.
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
  The exception is Pi, which acts on files: it runs in the folder that holds
  the canvas file, so the files it writes land next to the canvas.

## Adding one

1. Run it by hand first and keep the output. `echo prompt | <cli> ...`, or with
   the prompt as an argument if stdin is ignored.
2. Add an adapter to `CLI_ADAPTERS` with its provider type, binary, base
   arguments, how the prompt arrives, and a `parseLine` only if the output is
   JSON lines. Use `createParser` instead when the events only make sense in
   order, as Pi's do. No parser means stdout is streamed as text.
3. Add the provider type to the presets in `src/Modals/UnifiedProviderModal.ts`.
4. Test the argument building, and drive the real binary once.
