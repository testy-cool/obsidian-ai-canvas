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

- [x] AIC-002 Restore MCP tools in the live vault		#mcp
  Dropped, not fixed: the remote server behind the 302 is deprecated, so there
  is nothing to restore. Local servers cover this now (AIC-001). The stale
  entry can stay switched off in settings.

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

- [x] AIC-005 Stop paying full input price for long card chains		#cost
  Measured first, and the premise was half wrong: providers cache the repeated
  prefix by themselves, no `cache_control` needed. An identical 6036-token
  prefix reported 5841 cached tokens on one run out of four. What was actually
  broken was the accounting, which charged full price for cached tokens, so
  that is what got fixed.

- [ ] AIC-008 Make prefix caching reliable instead of occasional		#cost !low
  Implicit caching hit once in four identical runs. An explicit cache, Gemini
  `cachedContent` or Anthropic `cache_control` breakpoints, would make the
  saving dependable on a long chain. Worth it only if the traces show chains
  long enough to matter.

- [ ] AIC-006 Show what a card cost, on the card		#cost !low
  Prices are already fetched and per-trace cost is already computed for
  Langfuse. The number never reaches the canvas.

## Observability

- [ ] AIC-007 Trace image generation too		#observability !low
  `observeLLM` wraps text only, so image runs leave no trace and no cost.
