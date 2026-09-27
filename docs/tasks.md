# Tasks

Measured on 2026-09-27: tracing lands real traces in Langfuse, and the MCP
client completes initialize, tools/list and tools/call against a live server.
The gaps below are what that probe exposed.

## MCP

- [x] AIC-001 Reach local MCP servers over stdio		#mcp !high
  Nearly every local MCP server is launched as a command over stdio, and the
  client can only POST JSON-RPC to a URL, so none of them can be used.
  `@ai-sdk/mcp` is already a dependency and never imported.
  The `transport` field is also decorative today: the client never reads it,
  so `sse` and `websocket` behave exactly like `http`. Make the field mean
  what it says, or narrow it to the transports the client really speaks.

- [ ] AIC-002 Restore MCP tools in the live vault		#mcp !high
  The one remote MCP server configured on this machine sits behind an access
  proxy that answers 302 to a login page for both GET and POST, so tool calls
  never reach it. It needs a bypass rule for that path. Owner's infrastructure,
  so their call. Details are in the untracked local runbook.

- [ ] AIC-003 Use MCP resources and prompts, not only tools		#mcp !low
  The client reads `tools/list` and nothing else, announces protocol
  2024-11-05, and authenticates with a static bearer token. Servers that
  expose resources, prompts or OAuth cannot be used fully.

## Providers

- [ ] AIC-004 Send prompts to any local agent CLI, not only Codex		#providers
  `codexCli.ts` hardcodes the `codex` binary and its JSONL shape. Claude, Pi,
  Hermes and gemini-cli all take a non-interactive prompt and print events,
  so one provider with a command, an args template and a small output adapter
  would cover them. Tool parts are dropped on this path, so MCP tools never
  reach the CLI providers.

## Cost

- [ ] AIC-005 Stop paying full input price for long card chains		#cost
  There is no prompt caching anywhere in `src`, and each ask resends the whole
  ancestor chain, so a long branch pays for every earlier card every turn.

- [ ] AIC-006 Show what a card cost, on the card		#cost !low
  Prices are already fetched and per-trace cost is already computed for
  Langfuse. The number never reaches the canvas.

## Observability

- [ ] AIC-007 Trace image generation too		#observability !low
  `observeLLM` wraps text only, so image runs leave no trace and no cost.
