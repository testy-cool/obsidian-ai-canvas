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

- [x] AIC-003 Use MCP resources and prompts, not only tools		#mcp !low
  The client now reads `resources/list`, `resources/read`, `prompts/list` and
  `prompts/get`, and a command puts either on the canvas as a card. A server is
  only asked for what it advertised at initialize, so a tools-only server is
  never sent a call it would reject. The announced protocol moved to 2025-06-18
  after checking that the published filesystem server negotiates both versions
  identically.

- [ ] AIC-009 Authenticate to an MCP server with OAuth		#mcp !low
  Split out of AIC-003. Remote servers can require OAuth 2.1 with discovery,
  dynamic client registration, a browser redirect and token refresh. That is a
  project of its own, not a flag, and half of it would be worse than none. A
  static bearer token still works for servers that accept one.

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

- [x] AIC-008 Make prefix caching reliable instead of occasional		#cost !low
  Closed without building it, because it cannot be reached or verified from
  this setup. Explicit Gemini caching needs `POST /v1beta/cachedContents`. The
  gateway answers that path with "Provider 'gemini' is not allowed for this
  virtual key", with the vertex-prefixed model name too, so the gateway sends
  that endpoint to AI Studio while ordinary generation goes to Vertex. The
  direct Gemini key on this machine is invalid and the Vertex provider has no
  credentials, so no route is left to test against. Anthropic
  `cache_control` is the other half and there is no Anthropic provider here.
  Shipping a cache lifecycle into the generation path with no way to run it
  once would be worse than leaving implicit caching alone.

  To unblock: allow the gemini provider on the gateway's virtual key, or put
  working Vertex credentials on the Vertex provider. Cached tokens are now
  recorded per generation, so the traces will show whether chains are long
  enough to be worth it.

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

## Working on this repo

- [ ] AIC-010 See the plugin running, not only its tests		#tooling !high
  Obsidian's command line interface is off, so `pnpm run deploy` copies the
  build and cannot reload it, and no rendered card, badge width or font size
  was ever read from the real app this session. Everything UI shaped was
  checked by unit test and type check instead. Turning it on is one in-app
  step: Settings, General, Advanced, Command line interface, then follow the
  register prompt. After that `obsidian dev:dom`, `dev:console` and
  `dev:screenshot` work, which is what the 12px rule needs.

- [ ] AIC-011 Write down which providers the gateway key may use		#tooling
  Several probes went into discovering that the virtual key allows vertex but
  not gemini, and that the gateway sends `/v1beta/cachedContents` to gemini
  whatever model name is asked for. That is the fact that closed AIC-008. It
  belongs in the untracked local runbook where the next session reads it in a
  second.

- [ ] AIC-012 Stop rewriting the live-test shim		#testing
  The same throwaway was written three times: replace Obsidian's `requestUrl`
  with real fetch, read the provider and observability keys out of the vault's
  `data.json`, run something for real, delete the file. It should be one
  helper with one opt-in test that uses it, skipped by default like the live
  Gemini test, so the next live check is a few lines instead of a hundred.

- [ ] AIC-013 Record how each local agent CLI is driven		#docs
  Claude takes the prompt on stdin and prints JSON lines with hook noise first
  and token counts last. Pi wants it as a positional argument, prints plain
  text and puts its version warning on stderr. Hermes carries it in a flag.
  gemini-cli has no working credentials here. All of that was rediscovered by
  hand and is not written anywhere.

- [ ] AIC-014 Make lint mean something again		#tooling
  288 problems in 40 files, so lint carries no signal. 149 are `no-explicit-any`
  and 47 are non-null assertions, both of which the Canvas internals require on
  purpose. The rest are mechanical. Relax what the codebase deliberately does,
  fix what is really wrong, and add a script so the command exists.

- [ ] AIC-015 Remove the abandoned sdd briefs		#tooling
  `.superpowers/sdd` holds 656K of step by step briefs from finished plans.
  Untracked, referenced nowhere, and mdtask read every checkbox in them as an
  open task until it was scoped away.
