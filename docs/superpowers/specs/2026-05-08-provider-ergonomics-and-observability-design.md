# Provider Ergonomics, Observability, and Model Configuration

**Date**: 2026-05-08
**Scope**: Bug fixes + provider UX overhaul + per-model inference config + observability integration

---

## 1. Bug Fixes

### 1.1 Scoped Fetch Patch (src/utils/ai.ts:21-59)

**Problem**: `patchFetchForGemini()` replaces `globalThis.fetch` permanently. Every fetch in the Obsidian process — other plugins, sync, core — hits the interceptor.

**Fix**: Store `originalFetch` before each `streamText`/`generateText` call. Wrap only that call's fetch. Restore immediately after. The interceptor logic stays the same (fix broken tool schemas in `functionDeclarations`), but its lifetime is scoped to a single LLM request.

```typescript
const scopedFetch = (originalFetch: typeof fetch) => {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (!url.includes("generativelanguage.googleapis.com") &&
        !url.includes("aiplatform.googleapis.com")) {
      return originalFetch(input, init);
    }
    // existing schema fix logic...
    return originalFetch(input, patchedInit);
  };
};
```

Pass as the `fetch` option to `createGoogleGenerativeAI()` / `createGoogle()` instead of patching global.

### 1.2 Deep-Copy Tool Schemas (src/utils/mcpClient.ts)

**Problem**: `convertToGeminiSchema()` mutates cached tool schemas in-place. After first Gemini use, non-Gemini providers get mangled schemas.

**Fix**: `JSON.parse(JSON.stringify(schema))` before conversion. The schemas are plain JSON objects, no functions or circular refs.

### 1.3 Dead Code Removal

- Delete `src/openai/models.ts` (exports `{}`) and `src/openai/` directory
- Remove commented-out code blocks in `canvas-patches.ts`, `flashcards.ts`, `youtubeCaptions.ts`
- Remove stale TODOs that describe permanently broken things (`utils.ts:58`, `AugmentedCanvasPlugin.ts:274`)

---

## 2. LLMModel Interface Extensions

Current interface:

```typescript
interface LLMModel {
  id: string;
  providerId: string;
  model: string;
  enabled: boolean;
}
```

Extended:

```typescript
interface LLMModel {
  id: string;
  providerId: string;
  model: string;
  enabled: boolean;

  // Universal fields (all providers)
  timeoutMs?: number;             // request timeout, 0 = provider default
  maxRetries?: number;            // retry count, default: 2
  inputCostPerMillion?: number;   // user-entered, USD
  outputCostPerMillion?: number;

  // Provider-specific params — opaque bag, interpreted per provider type
  providerParams?: Record<string, unknown>;
}
```

### Provider-Specific Parameters

Each provider type defines which params are available. The `providerParams` bag is a `Record<string, unknown>` — the UI renders the right fields based on the provider type, and `ai.ts` reads them at call time.

**Known provider params:**

| Provider | Param | Type | Default | Description |
|----------|-------|------|---------|-------------|
| Gemini | `serviceTier` | `"standard" \| "flex" \| "priority"` | `"standard"` | Inference priority. Flex = 50% cheaper, 1-15 min latency. |
| Gemini | `flexFallback` | `boolean` | `false` | Retry with "standard" if flex times out. |
| OpenAI | `reasoningEffort` | `"low" \| "medium" \| "high"` | — | For o-series models. Controls thinking budget. |
| Anthropic | `thinking` | `boolean` | `false` | Enable extended thinking for Claude. |

New provider params can be added by:
1. Adding an entry to a `PROVIDER_PARAM_DEFS` registry (provider type → param name, type, label, default, description)
2. The settings UI reads the registry and renders the right fields for each model's provider
3. `ai.ts` reads `providerParams` and injects them into the request (via scoped fetch interceptor or `providerOptions`)

No code changes needed per new param — just a registry entry.

### Service Tier Implementation (Gemini)

Since `@ai-sdk/google` v4 (which has native `serviceTier` support) is beta-only, we inject `service_tier` via the scoped fetch interceptor from 1.1. When the provider is Gemini/Vertex and `providerParams.serviceTier` is set, the interceptor adds `"service_tier": "<value>"` to the request body JSON before forwarding.

This keeps us on stable `@ai-sdk/google` v3 while supporting the feature.

### Timeout & Retries

- `timeoutMs` passed as `AbortSignal.timeout(ms)` to the `streamText`/`generateText` call
- Default timeout: 60s. Models with Gemini `serviceTier: "flex"` default to 600s (10min) unless overridden.
- `maxRetries` uses exponential backoff (1s, 2s, 4s...)
- Gemini flex fallback: if `providerParams.flexFallback` is true and flex times out after all retries, retry once with `serviceTier: "standard"`

### Cost Fields

**Auto-populated from OpenRouter.** On model fetch or on demand, we call OpenRouter's public `/api/v1/models` endpoint (no auth required) and match models by ID. The response includes `pricing.prompt` and `pricing.completion` (cost per token) — we multiply by 1M for our `$/M tokens` format.

- Works for models from any provider, not just OpenRouter — their catalog covers OpenAI, Anthropic, Google, Meta, Mistral, etc.
- Model ID matching: try exact match first (`gemini-3-flash-preview`), then prefix match (`google/gemini-3-flash-preview`), then fuzzy
- User can override auto-fetched values. Overrides are sticky (won't be replaced on next fetch)
- A "Refresh pricing" button in model config re-fetches from OpenRouter
- If no match found, fields stay empty for manual entry
- Pricing data cached locally to avoid repeated API calls (refresh on demand or daily)

---

## 3. Provider Ergonomics

### 3.1 Unified Add-Provider Modal

Replace the current multi-step flow (add provider modal -> close -> fetch models modal -> close -> select active) with a single modal:

**Step 1 — Choose preset or custom:**
Dropdown with presets:
- OpenAI (`https://api.openai.com/v1`)
- Anthropic (`https://api.anthropic.com/v1`)
- Groq (`https://api.groq.com/openai/v1`)
- OpenRouter (`https://openrouter.ai/api/v1`)
- Gemini (uses Google SDK, no base URL needed)
- Vertex AI (uses Google SDK + service account)
- Ollama (`http://localhost:11434/v1`)
- **OpenAI-Compatible** (any URL — Bifrost, LiteLLM, vLLM, etc.)

"OpenAI-Compatible" is the prominent custom option. User enters a name (e.g., "Bifrost") and base URL.

**Step 2 — Credentials (same modal, below preset):**
- API Key field (or Service Account JSON for Vertex)
- "Test Connection" button — tries `/v1/models` endpoint, shows green check or error

**Step 3 — Models (same modal, below credentials):**
- Auto-fetches models after successful connection test
- Checkbox list with Select All / Clear
- Filter/search input
- Custom model text field for unlisted models
- Each model row has an expand arrow to set: service tier, cost, timeout (collapsed by default)

**Step 4 — Save:**
- Creates provider + selected models in one action
- If this is the user's only provider, auto-set as active

### 3.2 Edit Existing Provider

Same modal, pre-filled. Provider ID is read-only after creation.

### 3.3 Settings Page Cleanup

The main settings page shows:
- **Active provider** dropdown (existing)
- **Active model** dropdown (existing)
- **Provider-specific params** for the active model (rendered dynamically from `PROVIDER_PARAM_DEFS` — e.g., service tier dropdown for Gemini, reasoning effort for OpenAI o-series)
- Provider list with edit/delete buttons (existing, simplified)

---

## 4. Observability Integration

### 4.1 Architecture

Both Langfuse and Laminar JS SDKs require Node.js + OpenTelemetry, which don't work in Obsidian's Electron browser context. Instead, we use **direct REST API calls** to the observability platform's ingestion endpoint.

This is a thin module (~100 lines) with zero external dependencies.

### 4.2 Settings

New settings section "Observability":

```typescript
interface ObservabilitySettings {
  provider: "none" | "langfuse" | "laminar" | "custom";
  host: string;          // e.g., "https://langfuse-f6tim406.voidxd.cloud"
  publicKey: string;
  secretKey: string;
  enabled: boolean;       // global toggle
  traceSessionId?: string; // auto-generated per Obsidian session, or user-set
}
```

### 4.3 Trace Data

After each `streamText`/`generateText` completes, POST trace data:

```typescript
interface TracePayload {
  traceId: string;        // crypto.randomUUID()
  name: string;           // action name ("chat", "generate-title", "image", etc.)
  input: string;          // user prompt / system prompt
  output: string;         // model response
  model: string;          // model ID
  provider: string;       // provider ID
  serviceTier?: string;
  startTime: string;      // ISO timestamp
  endTime: string;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  cost?: {                // calculated from model's cost fields
    input: number;
    output: number;
    total: number;
  };
  metadata: {
    pluginVersion: string;
    vaultName: string;
    canvasName?: string;
  };
  status: "success" | "error";
  error?: string;
}
```

### 4.4 API Endpoints

**Langfuse**: `POST {host}/api/public/ingestion` with Basic auth (`publicKey:secretKey`). Batch format — array of events. See [Langfuse API docs](https://langfuse.com/docs/api-and-data-platform/features/public-api).

**Laminar**: `POST {host}/v1/traces` with Bearer token. See Laminar API docs.

**Custom**: User provides endpoint URL. We POST the `TracePayload` JSON with Bearer auth using the secret key.

### 4.5 Implementation

- Fire-and-forget: trace POST happens async, doesn't block the response stream
- Batch: buffer traces and flush every 5s or on plugin unload (reduces HTTP calls)
- Retry once on failure, then drop (observability should never break the plugin)
- No sensitive data: input/output are the prompts and responses the user already sees on canvas

---

## 5. Provider Params via Fetch Interceptor

The scoped fetch interceptor (section 1.1) handles injecting provider-specific params into API requests. Each provider type gets its own injection logic:

**Gemini/Vertex** — inject `service_tier` into request body:
```typescript
if (providerParams?.serviceTier && providerParams.serviceTier !== "standard") {
  const body = JSON.parse(init.body as string);
  body.service_tier = providerParams.serviceTier;
  init.body = JSON.stringify(body);
}
```

**OpenAI-compatible** — inject via request body fields (e.g., `reasoning_effort` for o-series).

**Anthropic** — inject via request body or headers as needed.

The interceptor reads `providerParams` from the model config at call time. Adding support for a new provider param means adding the injection logic to the interceptor's switch statement and a registry entry for the UI.

This approach is removed when/if provider SDKs add native support for these params (e.g., `@ai-sdk/google` v4 for `serviceTier`).

---

## 6. Files Changed

| File | Change |
|---|---|
| `src/settings/AugmentedCanvasSettings.ts` | Extend `LLMModel` interface, add `ObservabilitySettings`, update defaults |
| `src/settings/SettingsTab.ts` | Add service tier dropdown, observability section, model cost/timeout fields |
| `src/utils/ai.ts` | Scope fetch patch, inject service tier, add timeout/retry, hook observability |
| `src/utils/mcpClient.ts` | Deep-copy schemas before Gemini conversion |
| `src/utils/observability.ts` | **New** — trace client (~100 lines, zero deps) |
| `src/utils/modelFetch.ts` | No changes needed |
| `src/Modals/EditProviderModal.ts` | Unified add flow with inline model fetch |
| `src/Modals/EditModelModal.ts` | Add service tier, cost, timeout fields |
| `src/Modals/ModelFetchModal.ts` | Integrate into EditProviderModal (may become unused) |
| `src/openai/models.ts` | **Delete** |
| `src/openai/` | **Delete directory** |

### New dependencies: None

Everything uses `fetch` (available in Electron) and `crypto.randomUUID()` (available in modern browsers).

---

## 7. Migration

Existing settings are backward-compatible. New fields are all optional with sensible defaults:
- `serviceTier` defaults to undefined (= "standard" behavior)
- `timeoutMs` defaults to 0 (= provider default)
- `maxRetries` defaults to 2
- Cost fields default to undefined (= no cost tracking)
- Observability defaults to `{ provider: "none", enabled: false }`

No data migration needed.

---

## 8. Out of Scope

- Auto-fetching pricing from provider APIs (unreliable, changes constantly)
- Token counting UI in canvas (could be a follow-up)
- `@ai-sdk/google` v4 upgrade (wait for stable)
- Streaming cancellation (separate concern, not related to this work)
