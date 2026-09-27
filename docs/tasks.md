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

- [x] AIC-004 Send prompts to any local agent CLI, not only Codex		#providers
  Four new provider types: Claude CLI, Pi CLI, Hermes CLI and Local command.
  Each output shape was read from the real CLI before writing an adapter, and
  all three installed CLIs were then driven through the plugin's own runner.
  The Claude CLI reports token counts including cache reads; Pi and Hermes
  print plain text. gemini-cli has no working auth on this machine, so it is
  covered by Local command rather than a preset that was never verified.
  Tool parts are still dropped on this path, so MCP tools do not reach a CLI
  provider.

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

- [x] AIC-006 Show what a card cost, on the card		#cost !low
  The badge beside the model now carries the cost, for example
  `Bifrost • flash • $0.0004`. One cost calculation is shared with the
  Langfuse trace, so the card and the trace cannot disagree. The badge
  reserves the finished width while generating, so nothing shifts, and it
  stays quiet when the model has no published prices.

## Observability

- [x] AIC-007 Trace image generation too		#observability !low
  `observeImage` wraps every image path, recording the prompt, model, provider
  and what came back, or the error. Image APIs bill per image rather than per
  token, so no cost is guessed. Covered by unit tests; not yet watched against
  a live image run.
