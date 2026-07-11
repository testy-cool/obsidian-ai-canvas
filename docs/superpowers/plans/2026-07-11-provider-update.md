# Provider Update Implementation Plan (0.2.2 → 0.2.5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make provider params actually reach requests, then add Vertex image generation, an Azure OpenAI provider (text + gpt-image-2 images), and a local Codex CLI provider — released as 0.2.2, 0.2.3, 0.2.4, 0.2.5.

**Architecture:** "Targeted seams" (spec: `docs/superpowers/specs/2026-07-11-provider-update-design.md`). Three seams: (1) `src/utils/providerParams.ts` is the single source of truth for param detection and body mapping; (2) `generateImage.ts` dispatches to one of four image generators by provider type; (3) `src/utils/codexCli.ts` adapts `codex exec --json` to the existing streaming callback contract.

**Tech Stack:** TypeScript, esbuild, vitest (`pnpm test`), Obsidian plugin API (`requestUrl`, `Platform`), `@ai-sdk/openai` / `@ai-sdk/google`, Node `child_process` (desktop only).

## Global Constraints

- Package manager is `pnpm` (10.8.1). Build: `pnpm run build`. Tests: `pnpm test`.
- Each stage ends with the repo release ritual: bump version in `manifest.json`, `package.json`, `versions.json`; `pnpm run build`; commit **including `main.js`**; push; tag; `gh release create X.Y.Z main.js manifest.json --title "X.Y.Z" --notes "..."`.
- Commit subjects describe the effect in the world, not the files (user rule).
- Current released version is 0.2.1. Stages release 0.2.2, 0.2.3, 0.2.4, 0.2.5.
- Tabs for indentation in `src/utils/ai.ts`, `src/utils/llm.ts`, `src/settings/SettingsTab.ts`, actions files; 2-space in `src/Modals/UnifiedProviderModal.ts`, `src/utils/providerParams.ts`. Match the file you edit.
- Never hardcode a model ID not listed in this plan (IDs verified via `models` CLI 2026-07-11).

---

# Stage A — Params pipeline fixes (release 0.2.2)

### Task 1: Single detection chain in providerParams.ts

**Files:**
- Modify: `src/utils/providerParams.ts`
- Modify: `src/Modals/UnifiedProviderModal.ts:314` (caller of changed signature)
- Test: `test/providerParams.test.ts`

**Interfaces:**
- Produces: `detectProviderLabel(modelId: unknown, providerType: string): string`; `getParamsForModel(modelId: unknown, providerType: string): ProviderParamDef[]`; `getDefaultProviderParams(modelId: unknown, providerType: string): Record<string, unknown>`; `applyOpenAICompatParams(body: Record<string, any>, params: Record<string, unknown> | undefined): boolean` (mutates body, returns true if modified).
- Consumes: existing `PROVIDER_PARAM_DEFS`, `getParamsForProvider`.

- [ ] **Step 1: Write the failing tests** — replace the `getParamsForModel` describe-block in `test/providerParams.test.ts` (keep the `getParamsForProvider` and defaults tests above it, but update the two `getDefaultProviderParams` call sites to the new signature: `getDefaultProviderParams("gemini-3-flash", "Gemini")` and `getDefaultProviderParams("llama-3", "Ollama")`):

```typescript
import {
  PROVIDER_PARAM_DEFS,
  getParamsForProvider,
  getParamsForModel,
  getDefaultProviderParams,
  detectProviderLabel,
  applyOpenAICompatParams,
  type ProviderParamDef,
} from "../src/utils/providerParams";

describe("getParamsForModel", () => {
  it("detects Gemini params from model ID when provider is Custom", () => {
    const params = getParamsForModel("gemini-3-flash-preview", "Custom");
    expect(params.find((p) => p.key === "serviceTier")).toBeDefined();
  });

  it("model-ID detection beats provider type (OpenAI-typed proxy serving Gemini)", () => {
    const params = getParamsForModel("gemini-3-flash", "OpenAI");
    expect(params.find((p) => p.key === "serviceTier")).toBeDefined();
    expect(params.find((p) => p.key === "reasoningEffort")).toBeUndefined();
  });

  it("mismatched pair: claude model on Gemini provider gets Anthropic params", () => {
    const params = getParamsForModel("claude-sonnet-4-6", "Gemini");
    expect(params.find((p) => p.key === "thinking")).toBeDefined();
    expect(params.find((p) => p.key === "serviceTier")).toBeUndefined();
  });

  it("detects gpt-5.x family as OpenAI", () => {
    for (const id of ["openai/gpt-5.4", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      const params = getParamsForModel(id, "Custom");
      expect(params.find((p) => p.key === "reasoningEffort"), id).toBeDefined();
    }
  });

  it("still detects legacy o-series", () => {
    const params = getParamsForModel("o3", "Custom");
    expect(params.find((p) => p.key === "reasoningEffort")).toBeDefined();
  });

  it("gemini substring in a route prefix does not win over the leaf segment", () => {
    const params = getParamsForModel("gemini-gateway/o3", "Custom");
    expect(params.find((p) => p.key === "reasoningEffort")).toBeDefined();
    expect(params.find((p) => p.key === "serviceTier")).toBeUndefined();
  });

  it("falls back to provider type when family is unknown", () => {
    const params = getParamsForModel("llama-3-70b", "Gemini");
    expect(params.find((p) => p.key === "serviceTier")).toBeDefined();
  });

  it("does not crash on non-string model IDs", () => {
    expect(getParamsForModel(undefined, "Gemini").length).toBeGreaterThan(0);
    expect(getParamsForModel(undefined, "SomeRandom")).toEqual([]);
  });
});

describe("detectProviderLabel", () => {
  it("labels by detected family first", () => {
    expect(detectProviderLabel("gemini-3-flash", "Custom")).toBe("Gemini");
    expect(detectProviderLabel("claude-sonnet-4-6", "Custom")).toBe("Anthropic");
    expect(detectProviderLabel("gpt-5.6-sol", "Custom")).toBe("OpenAI");
  });
  it("falls back to provider type", () => {
    expect(detectProviderLabel("llama-3", "Ollama")).toBe("Ollama");
    expect(detectProviderLabel(undefined, "Gemini")).toBe("Gemini");
  });
});

describe("getDefaultProviderParams (model-aware)", () => {
  it("seeds Gemini defaults for a gemini model on a Custom provider", () => {
    const defaults = getDefaultProviderParams("gemini-3-flash", "Custom");
    expect(defaults.serviceTier).toBe("standard");
    expect(defaults.flexFallback).toBe(false);
  });
});

describe("applyOpenAICompatParams", () => {
  it("injects service_tier and reasoning_effort", () => {
    const body: Record<string, any> = { model: "x", messages: [] };
    const modified = applyOpenAICompatParams(body, {
      serviceTier: "flex",
      reasoningEffort: "high",
    });
    expect(modified).toBe(true);
    expect(body.service_tier).toBe("flex");
    expect(body.reasoning_effort).toBe("high");
  });
  it("skips standard tier, empty values, and maps thinking", () => {
    const body: Record<string, any> = {};
    const modified = applyOpenAICompatParams(body, {
      serviceTier: "standard",
      reasoningEffort: undefined,
      thinking: true,
    });
    expect(body.service_tier).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(modified).toBe(true);
  });
  it("returns false when nothing applies", () => {
    const body: Record<string, any> = {};
    expect(applyOpenAICompatParams(body, undefined)).toBe(false);
    expect(applyOpenAICompatParams(body, { flexFallback: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm test`
Expected: FAIL — `detectProviderLabel`/`applyOpenAICompatParams` import errors and precedence assertions failing.

- [ ] **Step 3: Implement** — replace everything from `getParamsForModel` to the end of `src/utils/providerParams.ts` with:

```typescript
/**
 * Detect the model family from the model ID's leaf segment (after any
 * route prefix like "openai/" or "models/"). Returns a provider label
 * from PROVIDER_PARAM_DEFS.providerTypes, or null when unrecognized.
 */
function detectModelFamily(modelId: unknown): string | null {
  if (typeof modelId !== "string" || !modelId) return null;
  const lower = modelId.toLowerCase();
  const segment = lower.split("/").pop() ?? lower;
  if (segment.startsWith("gemini")) return "Gemini";
  if (segment.includes("claude")) return "Anthropic";
  if (/^gpt-5/.test(segment)) return "OpenAI";
  if (/(?:^|-)o[134](?:-|\.|$)/.test(segment)) return "OpenAI";
  return null;
}

/**
 * Model-ID detection wins when it matches a known family; the provider
 * type is the fallback. This makes proxy providers (Bifrost, LiteLLM)
 * work regardless of whether they are typed "Custom" or "OpenAI".
 */
export function detectProviderLabel(
  modelId: unknown,
  providerType: string
): string {
  return detectModelFamily(modelId) ?? providerType;
}

export function getParamsForModel(
  modelId: unknown,
  providerType: string
): ProviderParamDef[] {
  return getParamsForProvider(detectProviderLabel(modelId, providerType));
}

export function getDefaultProviderParams(
  modelId: unknown,
  providerType: string
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const def of getParamsForModel(modelId, providerType)) {
    if (def.default !== undefined) {
      defaults[def.key] = def.default;
    }
  }
  return defaults;
}

/** Body-field mapping for OpenAI-compatible chat requests (Bifrost/LiteLLM shape). */
const OPENAI_COMPAT_PARAM_MAP: Record<string, string> = {
  serviceTier: "service_tier",
  reasoningEffort: "reasoning_effort",
};

/**
 * Mutates an OpenAI-compatible request body with the model's provider
 * params. Returns true when the body was modified.
 */
export function applyOpenAICompatParams(
  body: Record<string, any>,
  params: Record<string, unknown> | undefined
): boolean {
  if (!params) return false;
  let modified = false;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (key === "serviceTier" && value === "standard") continue;
    if (key === "thinking") {
      if (value === true) {
        body.thinking = { type: "enabled" };
        modified = true;
      }
      continue;
    }
    const target = OPENAI_COMPAT_PARAM_MAP[key];
    if (target) {
      body[target] = value;
      modified = true;
    }
  }
  return modified;
}
```

Then update the one caller of the old signature — `src/Modals/UnifiedProviderModal.ts`: delete line 314 (`const defaultParams = getDefaultProviderParams(provider.type);`) and inside the `.map((modelId) => {` callback compute per model: `const defaultParams = getDefaultProviderParams(modelId, provider.type);` (fixes seeding for proxy models).

- [ ] **Step 4: Run tests** — `pnpm test` → all PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Make param detection recognize gpt-5.x and win over mistyped proxy provider types"`

### Task 2: Inject params into OpenAI-compat requests; consume flexFallback

**Files:**
- Modify: `src/utils/ai.ts`

**Interfaces:**
- Consumes: `applyOpenAICompatParams` from Task 1.
- Produces: `getLlm` OpenAI-compat branch honoring `providerParams`; `streamResponse`/`getResponse` retrying once at standard tier when `flexFallback` is set and the flex attempt fails before any output.

- [ ] **Step 1: Add the compat fetch wrapper** — in `src/utils/ai.ts`, import `applyOpenAICompatParams` from `./providerParams`, then add below `createScopedGeminiFetch`:

```typescript
/**
 * Fetch wrapper for OpenAI-compatible providers: injects provider params
 * (service_tier, reasoning_effort, thinking) into JSON request bodies.
 * Returns undefined when there is nothing to inject so the SDK default
 * fetch is used.
 */
const createOpenAICompatFetch = (
	providerParams?: Record<string, unknown>
): typeof fetch | undefined => {
	const probe: Record<string, any> = {};
	if (!applyOpenAICompatParams(probe, providerParams)) return undefined;

	const originalFetch = globalThis.fetch;
	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		if (init?.body && typeof init.body === "string") {
			try {
				const body = JSON.parse(init.body);
				if (applyOpenAICompatParams(body, providerParams)) {
					init.body = JSON.stringify(body);
					logDebug("[AI] Injected provider params into OpenAI-compat body");
				}
			} catch (e) {
				// Not JSON, pass through
			}
		}
		return originalFetch(input, init);
	};
};
```

- [ ] **Step 2: Use it in getLlm** — change the OpenAI-compat `return` (the `case "OpenAI": ... case "Other":` branch) to:

```typescript
			return createOpenAI({
				apiKey: provider.apiKey,
				baseURL: provider.baseUrl,
				fetch: createOpenAICompatFetch(providerParams),
			});
```

- [ ] **Step 3: flexFallback in streamResponse** — inside `streamResponse`, track whether anything was delivered and retry once at standard tier. Add right after `const isFlexTier = ...` line:

```typescript
	const wantsFlexFallback = isFlexTier && providerParams?.flexFallback === true;
```

Add `let deliveredOutput = false;` before the `for await` loop, set `deliveredOutput = true;` as the first statement inside the `case 'text-delta':` branch. Then wrap the two existing failure paths: in the initial `catch (error: any)` (the one that rethrows when `!canUseSearch && !canUseUrlContext`) and in the outer `catch (streamError: any)`, insert before the existing rethrow/onComplete logic:

```typescript
		if (wantsFlexFallback && !deliveredOutput) {
			logDebug("[AI] Flex tier failed, retrying at standard tier");
			return streamResponse(
				provider,
				messages,
				{
					max_tokens, model, temperature, tools: mcpTools, maxSteps, timeoutMs, onComplete,
					providerParams: { ...providerParams, serviceTier: "standard", flexFallback: false },
				},
				cb
			);
		}
```

(In the outer catch, guard the recursive call so `onComplete` is not also invoked with an error for the failed flex attempt — do the recursion *before* the `if (onComplete)` error block and `throw`.)

- [ ] **Step 4: flexFallback in getResponse** — same pattern in `getResponse`'s catch path (the branch that currently throws when `!canUseSearch && !canUseUrlContext`): before invoking `onComplete`/`throw`, insert:

```typescript
			const wantsFlexFallback = isFlexTier && providerParams?.flexFallback === true;
			if (wantsFlexFallback) {
				logDebug("[AI] Flex tier failed, retrying at standard tier");
				clearTimeout(timer);
				return getResponse(provider, messages, {
					model, max_tokens, temperature, isJSON, timeoutMs, onComplete,
					providerParams: { ...providerParams, serviceTier: "standard", flexFallback: false },
				});
			}
```

- [ ] **Step 5: Build + test** — `pnpm test && pnpm run build` → PASS, no type errors.
- [ ] **Step 6: Commit** — `git commit -am "Send provider params (service tier, reasoning effort, thinking) with proxy requests and fall back from flex tier on failure"`

### Task 3: Thread model.providerParams through every call site

**Files:**
- Modify: `src/utils/llm.ts:20-36` (wrapper drops options)
- Modify: `src/actions/canvasNodeMenuActions/noteGenerator.ts:679-687`
- Modify: `src/actions/commands/runPromptFolder.ts:77`
- Modify: `src/actions/commands/relevantQuestions.ts:51`
- Modify: `src/actions/canvasNodeMenuActions/titleGenerator.ts:290,356`
- Modify: `src/actions/canvasContextMenuActions/flashcards.ts:70`
- Modify: `src/actions/canvasNodeContextMenuActions/flashcards.ts:70`

**Interfaces:**
- Consumes: `StreamOptions.providerParams` and `getResponse` options (already exist in `ai.ts`).
- Produces: every AI call carries `providerParams: <LLMModel>.providerParams` and `timeoutMs: <LLMModel>.timeoutMs` when the call site has an `LLMModel`.

- [ ] **Step 1: Fix the llm.ts wrapper** — `getResponse` in `src/utils/llm.ts` currently forwards only `{ model, max_tokens, temperature, isJSON }`. Change it to accept and forward the full options object (match `ai.ts` option names):

```typescript
export const getResponse = async (
	provider: LLMProvider,
	messages: ModelMessage[],
	options: Parameters<typeof getResponseFromAI>[2] = {}
) => {
	return getResponseFromAI(provider, messages, options);
};
```

- [ ] **Step 2: noteGenerator** — at the `streamResponse(` call (line ~679), the resolved `model: LLMModel` is in scope. Add two lines to the options object:

```typescript
						providerParams: model.providerParams,
						timeoutMs: model.timeoutMs,
```

- [ ] **Step 3: Each remaining call site** — for each file listed above, read the surrounding function. Where an `LLMModel` object is in scope, add the same two options. Where only a model *string* is in scope, resolve the model first (pattern used in `noteGenerator.ts:248-254`):

```typescript
	const modelSettings = settings.models.find(
		(m) => m.providerId === provider.id && m.model === modelName
	);
```

then pass `providerParams: modelSettings?.providerParams, timeoutMs: modelSettings?.timeoutMs`.

- [ ] **Step 4: Verify no call site was missed**

Run: `grep -rn "streamResponse(\|getResponse(" src/actions/ | wc -l` then confirm each hit passes `providerParams`.
Run: `pnpm test && pnpm run build` → PASS.

- [ ] **Step 5: Commit** — `git commit -am "Carry per-model provider params and timeouts on every AI call"`

### Task 4: Fix params UI — live edit flow, apiModel mismatch, dead modal

**Files:**
- Modify: `src/settings/SettingsTab.ts:157` and `:75-86`
- Modify: `src/Modals/UnifiedProviderModal.ts` (params editor per selected model)
- Delete: `src/Modals/EditModelModal.ts`

**Interfaces:**
- Consumes: `getParamsForModel`, `detectProviderLabel`, `getDefaultProviderParams` (Task 1 signatures).
- Produces: params editable in the live provider-edit modal; `settings.apiModel` always stores a model **id**.

- [ ] **Step 1: apiModel id fix** — `src/settings/SettingsTab.ts:157`: change `this.plugin.settings.apiModel = models[0].model;` to `this.plugin.settings.apiModel = models[0].id;`

- [ ] **Step 2: Robust activeModel lookup** — in `renderGeneralSettings` (line ~78) make the lookup tolerate legacy name-valued `apiModel`:

```typescript
        const activeModel = availableModels.find(
            m => m.id === this.plugin.settings.apiModel
        ) ?? availableModels.find(
            m => m.model === this.plugin.settings.apiModel
        );
```

Also fix the params-section provider lookup to use the model's own provider, not `activeProvider` (a default model can belong to a non-active provider): `const paramsProvider = this.plugin.settings.providers.find(p => p.id === activeModel?.providerId) ?? activeProvider;` and use `paramsProvider.type` at lines 83/85.

- [ ] **Step 3: Params editor in UnifiedProviderModal** — in `renderModelList()`, for each **selected** model row whose `getParamsForModel(modelId, this.provider.type ?? "")` is non-empty, append a gear button that toggles an inline params container under the row. Store edits in a new field `private modelParams = new Map<string, Record<string, unknown>>();` seeded in the constructor from `existingModels` (`if (m.providerParams) this.modelParams.set(m.model, { ...m.providerParams });`). Render controls exactly like SettingsTab does (select → dropdown with "(default)" empty option, boolean → toggle), writing into the map:

```typescript
  private renderParamsEditor(container: HTMLElement, modelId: string): void {
    const type = this.provider.type ?? "";
    const defs = getParamsForModel(modelId, type);
    if (!defs.length) return;
    const current = this.modelParams.get(modelId) ?? {};
    container.createEl("div", {
      text: `${detectProviderLabel(modelId, type)} settings`,
      cls: "setting-item-description",
    });
    for (const def of defs) {
      const row = new Setting(container).setName(def.label).setDesc(def.description);
      if (def.type === "select" && def.options) {
        row.addDropdown((dd) => {
          dd.addOption("", "(default)");
          for (const opt of def.options!) dd.addOption(opt, opt);
          dd.setValue((current[def.key] as string) ?? "").onChange((val) => {
            const params = this.modelParams.get(modelId) ?? {};
            if (val) params[def.key] = val; else delete params[def.key];
            this.modelParams.set(modelId, params);
          });
        });
      } else if (def.type === "boolean") {
        row.addToggle((t) => {
          t.setValue(!!current[def.key]).onChange((val) => {
            const params = this.modelParams.get(modelId) ?? {};
            params[def.key] = val;
            this.modelParams.set(modelId, params);
          });
        });
      }
    }
  }
```

In `save()`, replace the `providerParams:` line with:

```typescript
        providerParams:
          this.modelParams.get(modelId) ??
          existing?.providerParams ??
          (Object.keys(defaultParams).length > 0 ? defaultParams : undefined),
```

(with `defaultParams` computed per-model as done in Task 1). Import `getParamsForModel, detectProviderLabel` at the top.

- [ ] **Step 4: Delete dead modal** — `git rm src/Modals/EditModelModal.ts`. Run `grep -rn "EditModelModal" src/` → expect zero hits.

- [ ] **Step 5: Build + manual check** — `pnpm test && pnpm run build` → PASS.
- [ ] **Step 6: Commit** — `git commit -am "Expose model params in the live provider edit flow and fix default-model selection after first provider add"`

### Task 5: Release 0.2.2

- [ ] **Step 1:** Bump `manifest.json`, `package.json`, `versions.json` to 0.2.2 (versions.json adds `"0.2.2": "<same minAppVersion as 0.2.1 entry>"`).
- [ ] **Step 2:** `pnpm run build && git add -A && git commit -m "0.2.2: provider params reach requests; gpt-5.x detection; live params editing" && git push && git tag 0.2.2 && git push origin 0.2.2 && gh release create 0.2.2 main.js manifest.json --title "0.2.2" --notes "Provider params (service tier, reasoning effort, thinking) are now sent with requests including proxy providers; flex fallback; gpt-5.x family detection; params editable in provider modal."`

---

# Stage B — Vertex image generation (release 0.2.3)

### Task 6: createVertexImage

**Files:**
- Modify: `src/utils/llm.ts` (new export next to `createGeminiImage`)
- Test: `test/imageGen.test.ts` (new)

**Interfaces:**
- Consumes: `getVertexAccessToken(serviceAccountJson)` from `src/utils/ai.ts`; `LLMProvider` (projectId, location, serviceAccountJson).
- Produces: `createVertexImage(provider: LLMProvider, prompt: string, opts?: { model?: string; parts?: {...}[] }): Promise<ImageGenerationOutput>` and exported pure helper `buildVertexImageUrl(provider: LLMProvider, modelId: string): string`.

- [ ] **Step 1: Failing test** for the pure URL builder in new `test/imageGen.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildVertexImageUrl } from "../src/utils/llm";

describe("buildVertexImageUrl", () => {
  it("builds the aiplatform generateContent URL", () => {
    const provider: any = { projectId: "my-proj", location: "europe-west4" };
    expect(buildVertexImageUrl(provider, "gemini-3-pro-image-preview")).toBe(
      "https://europe-west4-aiplatform.googleapis.com/v1/projects/my-proj/locations/europe-west4/publishers/google/models/gemini-3-pro-image-preview:generateContent"
    );
  });
  it("defaults location to us-central1 and strips models/ prefix", () => {
    const provider: any = { projectId: "p" };
    expect(buildVertexImageUrl(provider, "models/nano-banana")).toBe(
      "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/publishers/google/models/nano-banana:generateContent"
    );
  });
});
```

Note: `src/utils/llm.ts` imports `obsidian` — check `vitest.config.ts`/`test/` for the existing mock pattern used by `providerParams.test.ts`; if `obsidian` is not aliased, add to `vitest.config.ts`: `resolve: { alias: { obsidian: "/test/mocks/obsidian.ts" } }` and create `test/mocks/obsidian.ts` exporting stub `requestUrl`, `Notice`, `Platform`.

- [ ] **Step 2:** `pnpm test` → FAIL (no export).
- [ ] **Step 3: Implement** in `src/utils/llm.ts` (imports: `getVertexAccessToken` from `./ai`, `LLMProvider` type):

```typescript
export const buildVertexImageUrl = (
	provider: LLMProvider,
	modelId: string
): string => {
	const location = provider.location || "us-central1";
	const model = modelId.replace(/^models\//i, "");
	return `https://${location}-aiplatform.googleapis.com/v1/projects/${provider.projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
};

export const createVertexImage = async (
	provider: LLMProvider,
	prompt: string,
	{
		model,
		parts,
	}: {
		model?: string;
		parts?: { text?: string; inlineData?: { data: string; mimeType: string } }[];
	} = {}
): Promise<ImageGenerationOutput> => {
	if (!provider.serviceAccountJson || !provider.projectId) {
		throw new Error("Vertex image generation requires service account JSON and project ID.");
	}
	if (!model) {
		throw new Error("Vertex image model is required.");
	}

	const token = await getVertexAccessToken(provider.serviceAccountJson);
	const contentParts =
		Array.isArray(parts) && parts.length > 0 ? parts : [{ text: prompt }];

	const response = await requestUrl({
		url: buildVertexImageUrl(provider, model),
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			contents: [{ role: "user", parts: contentParts }],
			generationConfig: { responseModalities: ["IMAGE"] },
		}),
	});
	const raw = typeof response.text === "string" ? response.text : null;
	const payload = response.json ?? (raw ? JSON.parse(raw) : null);
	const imageResult = extractGeminiInlineImage(payload);
	if (!imageResult) {
		logDebug("Image data not found in Vertex response.");
	}
	return { image: imageResult, raw: raw ?? (payload ? safeStringify(payload) : null) };
};
```

- [ ] **Step 4:** `pnpm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "Generate images through Vertex AI with service-account auth"`

### Task 7: Image dispatcher + Vertex in image settings

**Files:**
- Modify: `src/actions/canvasNodeContextMenuActions/generateImage.ts:104-199`
- Modify: `src/settings/SettingsTab.ts` (image provider dropdown, ~line 640-690 — read the section first)

**Interfaces:**
- Consumes: `createVertexImage` (Task 6), existing `createGeminiImage`/`createImage`.
- Produces: `handleGenerateImage` dispatching on provider type; Vertex selectable as image provider.

- [ ] **Step 1: Dispatch** — in `handleGenerateImage`, add `const isVertex = imageProvider?.type === "Vertex";` next to the existing `isGeminiProvider` usage. Replace the API-key guard so Vertex is exempt (`if (!apiKey && !isVertex) { ... }`), require a model for Vertex like for Gemini, and extend the generation expression:

```typescript
		const imageOutput = isVertex
			? await createVertexImage(imageProvider!, nodeContent, {
					model: model,
					parts: options?.parts,
			  })
			: isGeminiProvider(imageProvider)
			? await createGeminiImage(apiKey, nodeContent, {
					model: model,
					baseUrl: imageProvider?.baseUrl,
					parts: options?.parts,
			  })
			: await createImage(
					apiKey,
					nodeContent,
					{
						isVertical: false,
						model: model,
						baseUrl: baseUrl,
						headers: headers,
					}
			  );
```

Add a pre-flight validation Notice: if `isVertex && (!imageProvider?.serviceAccountJson || !imageProvider?.projectId)` → `new Notice("Vertex image generation needs a service account JSON and project ID in the provider settings."); return;`

- [ ] **Step 2: Settings dropdown** — read the Image Generation section in `SettingsTab.ts` (search `imageProviderId`). If the provider dropdown filters provider types, ensure `Vertex` is included; if it lists all providers, no change. Ensure the image-model dropdown for Vertex providers lists that provider's configured models (same as Gemini path).
- [ ] **Step 3:** `pnpm test && pnpm run build` → PASS. Manual: with the Vertex provider configured (user's SA JSON), right-click a card → Generate image → image lands on canvas.
- [ ] **Step 4: Commit** — `git commit -am "Allow Vertex as the image generation provider"`

### Task 8: Release 0.2.3

- [ ] **Step 1:** Bump versions to 0.2.3 (three files).
- [ ] **Step 2:** `pnpm run build && git add -A && git commit -m "0.2.3: image generation via Vertex service accounts" && git push && git tag 0.2.3 && git push origin 0.2.3 && gh release create 0.2.3 main.js manifest.json --title "0.2.3" --notes "Generate images through Vertex AI using service-account JSON — no Gemini API key needed."`

---

# Stage C — Azure OpenAI provider (release 0.2.4)

### Task 9: Azure provider type (text path + model fetch)

**Files:**
- Modify: `src/Modals/UnifiedProviderModal.ts:14-23` (preset) and Base URL desc
- Modify: `src/utils/ai.ts` (`getLlm` — dedicated Azure case)
- Modify: `src/utils/modelFetch.ts` (Azure models URL + api-key header)

**Interfaces:**
- Produces: provider type `"Azure"`; `getLlm` returns an OpenAI-compat client at `{baseUrl}/openai/v1` with `api-key` header; `fetchProviderModels` works for Azure.
- Consumes: `createOpenAICompatFetch` (Task 2).

- [ ] **Step 1: Preset** — add to `PRESETS` after `openrouter`: `{ id: "azure", type: "Azure", baseUrl: "" }` and give Azure a placeholder in the Base URL setting when `this.provider.type === "Azure"`: `https://<resource>.services.ai.azure.com` (desc: "Azure OpenAI resource endpoint — no path, no api-version").
- [ ] **Step 2: getLlm** — remove `case "Azure":` from the generic compat list and add above it:

```typescript
		case "Azure": {
			const azureBase = provider.baseUrl.replace(/\/+$/, "").replace(/\/openai\/v1$/, "");
			return createOpenAI({
				apiKey: provider.apiKey,
				baseURL: `${azureBase}/openai/v1`,
				headers: { "api-key": provider.apiKey },
				fetch: createOpenAICompatFetch(providerParams),
			});
		}
```

- [ ] **Step 3: modelFetch** — in `fetchProviderModels`, add `const isAzure = provider.type === "Azure";` and when true: url = `` `${normalizeBaseUrl(provider.baseUrl)}/openai/v1/models` ``, headers = `{ "api-key": apiKey ?? provider.apiKey }` (no Bearer). Keep the OpenAI-compat response parsing (Azure v1 returns `{ data: [{ id }] }`). If the request 404s, surface the error so the modal's manual "Custom model ID" path is the fallback (already exists).
- [ ] **Step 4:** `pnpm test && pnpm run build` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "Add Azure OpenAI as a provider for text models"`

### Task 10: Azure image generation (gpt-image-2)

**Files:**
- Modify: `src/utils/llm.ts` (new `createAzureImage` + pure body builder)
- Modify: `src/actions/canvasNodeContextMenuActions/generateImage.ts` (dispatch branch)
- Modify: `src/settings/AugmentedCanvasSettings.ts` (new `azureImageQuality` field + default)
- Modify: `src/settings/SettingsTab.ts` (quality dropdown in Image Generation section)
- Test: `test/imageGen.test.ts`

**Interfaces:**
- Produces: `createAzureImage(provider: LLMProvider, prompt: string, opts: { model?: string; quality: "low"|"medium"|"high" }): Promise<ImageGenerationOutput>`; pure `buildAzureImageRequest(baseUrl: string, model: string | undefined, prompt: string, quality: string): { url: string; body: Record<string, unknown> }`; settings field `azureImageQuality: "low" | "medium" | "high"` default `"medium"`.
- Request shape (proven by the Hermes plugin on the Zenbook): POST `{ model, prompt, size, quality, output_format: "png" }` to `{base}/openai/v1/images/generations`, `api-key` header, image at `data[0].b64_json`.

- [ ] **Step 1: Failing test** in `test/imageGen.test.ts`:

```typescript
import { buildAzureImageRequest } from "../src/utils/llm";

describe("buildAzureImageRequest", () => {
  it("builds the v1 generations request", () => {
    const { url, body } = buildAzureImageRequest(
      "https://sfera-2425-resource.services.ai.azure.com/",
      undefined,
      "a red fox",
      "medium"
    );
    expect(url).toBe("https://sfera-2425-resource.services.ai.azure.com/openai/v1/images/generations");
    expect(body).toEqual({
      model: "gpt-image-2",
      prompt: "a red fox",
      size: "1536x1024",
      quality: "medium",
      output_format: "png",
    });
  });
});
```

- [ ] **Step 2:** `pnpm test` → FAIL. **Step 3: Implement** in `src/utils/llm.ts`:

```typescript
export const buildAzureImageRequest = (
	baseUrl: string,
	model: string | undefined,
	prompt: string,
	quality: string
): { url: string; body: Record<string, unknown> } => {
	const base = baseUrl.replace(/\/+$/, "").replace(/\/openai\/v1$/, "");
	return {
		url: `${base}/openai/v1/images/generations`,
		body: {
			model: model || "gpt-image-2",
			prompt,
			size: "1536x1024",
			quality,
			output_format: "png",
		},
	};
};

export const createAzureImage = async (
	provider: LLMProvider,
	prompt: string,
	{ model, quality }: { model?: string; quality: "low" | "medium" | "high" }
): Promise<ImageGenerationOutput> => {
	if (!provider.apiKey) {
		throw new Error("Azure image generation requires an API key.");
	}
	const { url, body } = buildAzureImageRequest(provider.baseUrl, model, prompt, quality);
	const response = await requestUrl({
		url,
		method: "POST",
		headers: { "Content-Type": "application/json", "api-key": provider.apiKey },
		body: JSON.stringify(body),
		throw: false,
	});
	const raw = typeof response.text === "string" ? response.text : null;
	const payload = response.json ?? (raw ? JSON.parse(raw) : null);
	if (response.status >= 400) {
		throw new Error(`Azure image generation failed (${response.status}): ${payload?.error?.message ?? raw}`);
	}
	const b64 = payload?.data?.[0]?.b64_json;
	return {
		image: b64 ? { base64: b64, mimeType: "image/png" } : null,
		raw: raw ?? (payload ? safeStringify(payload) : null),
	};
};
```

- [ ] **Step 4: Settings** — add `azureImageQuality` to `AugmentedCanvasSettings` interface (`/** Quality tier for Azure image generation. */ azureImageQuality: "low" | "medium" | "high";`) and `azureImageQuality: "medium"` to `DEFAULT_SETTINGS`. In the Image Generation section of `SettingsTab.ts`, add a Quality dropdown (options low/medium/high, desc "Azure gpt-image-2 quality: low ~15s, medium ~40s, high ~2min") rendered when the selected image provider's type is `Azure`.
- [ ] **Step 5: Dispatch** — in `generateImage.ts`, add `const isAzure = imageProvider?.type === "Azure";` and a branch before the Gemini one: `isAzure ? await createAzureImage(imageProvider!, nodeContent, { model, quality: settings.azureImageQuality || "medium" }) : ...`
- [ ] **Step 6:** `pnpm test && pnpm run build` → PASS.
- [ ] **Step 7: Live verification** (key stays on the Zenbook — do not copy it into the repo):

```bash
ssh zenbook 'source ~/.hermes/.env 2>/dev/null || export $(grep AZURE_GPT_IMAGE_KEY ~/.hermes/.env); curl -s -X POST "https://sfera-2425-resource.services.ai.azure.com/openai/v1/images/generations" -H "api-key: $AZURE_GPT_IMAGE_KEY" -H "Content-Type: application/json" -d "{\"model\":\"gpt-image-2\",\"prompt\":\"a tiny test square\",\"size\":\"1024x1024\",\"quality\":\"low\",\"output_format\":\"png\"}" | head -c 200'
```

Expected: JSON starting with `{"created":...,"data":[{"b64_json":"iVBOR...` — confirms the request shape the plugin now sends.

- [ ] **Step 8: Commit** — `git commit -am "Generate images on Azure gpt-image-2 with selectable quality tiers"`

### Task 11: Release 0.2.4

- [ ] **Step 1:** Bump versions to 0.2.4 (three files).
- [ ] **Step 2:** `pnpm run build && git add -A && git commit -m "0.2.4: Azure OpenAI provider with gpt-image-2 image generation" && git push && git tag 0.2.4 && git push origin 0.2.4 && gh release create 0.2.4 main.js manifest.json --title "0.2.4" --notes "New Azure provider: text deployments via the v1-compat endpoint, plus gpt-image-2 image generation with quality tiers."`

---

# Stage D — Codex CLI provider (release 0.2.5)

### Task 12: codexCli adapter module

**Files:**
- Create: `src/utils/codexCli.ts`
- Modify: `src/settings/AugmentedCanvasSettings.ts` (LLMProvider gains `binaryPath?: string` — needed by this task's code)
- Test: `test/codexCli.test.ts`

**Interfaces:**
- Produces:
  - `findCodexBinary(override?: string): string | null` (sync fs checks)
  - `parseCodexEvent(line: string): { textDelta?: string; finalText?: string; error?: string } | null` (pure)
  - `buildCodexArgs(opts: { model?: string; reasoningEffort?: string }): string[]` (pure)
  - `streamCodexResponse(provider: LLMProvider, messages: ModelMessage[], options: StreamOptions, cb: StreamCallback): Promise<void>` where `StreamCallback` matches the `cb` in `ai.ts:streamResponse`.
- Consumes: Node `child_process.spawn`, `fs`, `os`, `path` via `require` (desktop only); `LLMProvider.binaryPath` (added in this task).

- [ ] **Step 0: Add the binaryPath field** — in `src/settings/AugmentedCanvasSettings.ts`, add to the `LLMProvider` interface after `serviceAccountJson`:

```typescript
	/**
	 * Path to a local CLI binary (for Codex provider)
	 */
	binaryPath?: string;
```

- [ ] **Step 1: Discover the real JSONL shape first** (codex-cli 0.144.0 installed locally):

```bash
codex exec --json --ephemeral --skip-git-repo-check -s read-only -C /tmp 'Reply with exactly: ping' 2>/dev/null | head -30
```

Record the event types seen (expect lines like `{"type":"item.completed","item":{"type":"agent_message","text":"ping"}}` and possibly `agent_message` delta events; also `turn.completed` with usage). **Adjust `parseCodexEvent` cases in Step 2/4 to the observed shapes** — the shapes below are the expected baseline, the observed output is authoritative.

- [ ] **Step 2: Failing tests** in `test/codexCli.test.ts` (update fixture lines to match Step 1 observations):

```typescript
import { describe, it, expect } from "vitest";
import { parseCodexEvent, buildCodexArgs } from "../src/utils/codexCli";

describe("parseCodexEvent", () => {
  it("extracts final agent message", () => {
    const line = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hello" } });
    expect(parseCodexEvent(line)).toEqual({ finalText: "hello" });
  });
  it("extracts deltas when present", () => {
    const line = JSON.stringify({ type: "item.delta", item: { type: "agent_message" }, delta: "he" });
    expect(parseCodexEvent(line)?.textDelta).toBe("he");
  });
  it("surfaces errors", () => {
    const line = JSON.stringify({ type: "error", message: "boom" });
    expect(parseCodexEvent(line)).toEqual({ error: "boom" });
  });
  it("ignores unrelated events and junk", () => {
    expect(parseCodexEvent(JSON.stringify({ type: "turn.started" }))).toBeNull();
    expect(parseCodexEvent("not json")).toBeNull();
  });
});

describe("buildCodexArgs", () => {
  it("always runs sandboxed, ephemeral, json", () => {
    const args = buildCodexArgs({});
    expect(args).toContain("exec");
    expect(args).toContain("--json");
    expect(args).toContain("--ephemeral");
    expect(args).toContain("--skip-git-repo-check");
    expect(args.join(" ")).toContain("-s read-only");
  });
  it("passes model and reasoning effort", () => {
    const args = buildCodexArgs({ model: "gpt-5.6-terra", reasoningEffort: "high" });
    expect(args.join(" ")).toContain("-m gpt-5.6-terra");
    expect(args.join(" ")).toContain("-c model_reasoning_effort=\"high\"");
  });
  it("omits -m for the default model sentinel", () => {
    expect(buildCodexArgs({ model: "default" }).join(" ")).not.toContain("-m");
  });
});
```

- [ ] **Step 3:** `pnpm test` → FAIL (module missing).
- [ ] **Step 4: Implement `src/utils/codexCli.ts`:**

```typescript
import { Platform } from "obsidian";
import type { ModelMessage } from "@ai-sdk/provider-utils";
import type { LLMProvider } from "src/settings/AugmentedCanvasSettings";
import type { StreamOptions, ToolEvent } from "./ai";
import { logDebug } from "src/logDebug";

export const CODEX_DEFAULT_MODEL = "default";
export const CODEX_MODELS = [
	CODEX_DEFAULT_MODEL, // uses ~/.codex/config.toml
	"gpt-5.6-sol",
	"gpt-5.6-terra",
	"gpt-5.6-luna",
	"gpt-5.3-codex",
];

const COMMON_BIN_DIRS = [
	"~/.local/share/pnpm",
	"~/.local/bin",
	"~/.bun/bin",
	"/usr/local/bin",
	"/opt/homebrew/bin",
];

const expandHome = (p: string, home: string) => p.replace(/^~/, home);

/** Locate the codex binary. Returns an absolute path or null. */
export const findCodexBinary = (override?: string): string | null => {
	if (!Platform.isDesktopApp) return null;
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const fs = require("fs");
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const os = require("os");
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const path = require("path");
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const { execSync } = require("child_process");

	const home = os.homedir();
	const candidates: string[] = [];
	if (override?.trim()) candidates.push(expandHome(override.trim(), home));
	try {
		const which = execSync("which codex", { encoding: "utf8", timeout: 3000 }).trim();
		if (which) candidates.push(which);
	} catch {
		// not on PATH — Obsidian's Electron often gets a minimal PATH
	}
	for (const dir of COMMON_BIN_DIRS) {
		candidates.push(path.join(expandHome(dir, home), "codex"));
	}
	// nvm installs: ~/.nvm/versions/node/*/bin/codex
	try {
		const nvmBase = path.join(home, ".nvm", "versions", "node");
		for (const v of fs.readdirSync(nvmBase)) {
			candidates.push(path.join(nvmBase, v, "bin", "codex"));
		}
	} catch {
		// no nvm
	}
	for (const c of candidates) {
		try {
			fs.accessSync(c, fs.constants.X_OK);
			return c;
		} catch {
			// keep looking
		}
	}
	return null;
};

/** Parse one JSONL event line from `codex exec --json`. */
export const parseCodexEvent = (
	line: string
): { textDelta?: string; finalText?: string; error?: string } | null => {
	let event: any;
	try {
		event = JSON.parse(line);
	} catch {
		return null;
	}
	if (!event || typeof event !== "object") return null;
	if (event.type === "error") {
		return { error: event.message ?? "Codex error" };
	}
	const itemType = event.item?.type ?? event.item?.item_type;
	if (itemType === "agent_message") {
		if (event.type === "item.completed" && typeof event.item?.text === "string") {
			return { finalText: event.item.text };
		}
		if (typeof event.delta === "string") {
			return { textDelta: event.delta };
		}
	}
	return null;
};

export const buildCodexArgs = (opts: {
	model?: string;
	reasoningEffort?: string;
}): string[] => {
	const args = [
		"exec",
		"--json",
		"--ephemeral",
		"--skip-git-repo-check",
		"-s",
		"read-only",
	];
	if (opts.model && opts.model !== CODEX_DEFAULT_MODEL) {
		args.push("-m", opts.model);
	}
	if (opts.reasoningEffort) {
		args.push("-c", `model_reasoning_effort="${opts.reasoningEffort}"`);
	}
	return args;
};

/** Flatten chat messages into a single prompt (codex exec takes one prompt). */
const flattenMessages = (messages: ModelMessage[]): string =>
	messages
		.map((m) => {
			const content =
				typeof m.content === "string"
					? m.content
					: m.content
							.map((part: any) => (part.type === "text" ? part.text : ""))
							.join("");
			return m.role === "system" ? content : `${m.role}: ${content}`;
		})
		.join("\n\n");

/** Run codex exec and adapt its JSONL output to the streamResponse callback contract. */
export const streamCodexResponse = async (
	provider: LLMProvider,
	messages: ModelMessage[],
	{ model, providerParams, timeoutMs, onComplete }: StreamOptions,
	cb: (chunk: string | null, final: any, tool: ToolEvent | null, reasoningDelta: any) => void
): Promise<void> => {
	if (!Platform.isDesktopApp) {
		throw new Error("The Codex provider only works in the desktop app.");
	}
	const binary = findCodexBinary(provider.binaryPath);
	if (!binary) {
		throw new Error(
			"Codex CLI not found. Install it (npm i -g @openai/codex) or set the binary path in the provider settings."
		);
	}
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const { spawn } = require("child_process");
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const os = require("os");

	const args = buildCodexArgs({
		model,
		reasoningEffort: providerParams?.reasoningEffort as string | undefined,
	});
	const prompt = flattenMessages(messages);
	logDebug("[Codex] spawning", { binary, args });

	return new Promise<void>((resolve, reject) => {
		const child = spawn(binary, args, { cwd: os.tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
		const timeout = timeoutMs ?? 300_000;
		let finalText = "";
		let streamedText = "";
		let stderrTail = "";
		let settled = false;

		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			settle(new Error(`Codex timed out after ${Math.round(timeout / 1000)}s`));
		}, timeout);

		const settle = (err?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (err) {
				onComplete?.({ inputTokens: 0, outputTokens: 0, totalText: "", error: err.message });
				reject(err);
				return;
			}
			const text = finalText || streamedText;
			// Emit any final text not already streamed, then the final marker.
			if (finalText && !streamedText) cb(finalText, null, null, null);
			cb(null, { text }, null, null);
			onComplete?.({ inputTokens: 0, outputTokens: 0, totalText: text });
			resolve();
		};

		let buffer = "";
		child.stdout.on("data", (chunk: Buffer) => {
			buffer += chunk.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				const parsed = parseCodexEvent(line);
				if (!parsed) continue;
				if (parsed.error) {
					settle(new Error(parsed.error));
					return;
				}
				if (parsed.textDelta) {
					streamedText += parsed.textDelta;
					cb(parsed.textDelta, null, null, null);
				}
				if (parsed.finalText) {
					finalText = parsed.finalText;
				}
			}
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderrTail = (stderrTail + chunk.toString()).slice(-500);
		});
		child.on("error", (err: Error) => settle(new Error(`Failed to run codex: ${err.message}`)));
		child.on("close", (code: number) => {
			if (code !== 0 && !finalText && !streamedText) {
				settle(new Error(`codex exited with code ${code}: ${stderrTail.trim()}`));
			} else {
				settle();
			}
		});
		child.stdin.write(prompt);
		child.stdin.end();
	});
};
```

Note on the `final` callback argument: `noteGenerator` treats a non-null `final` as end-of-stream (verify by reading its callback before wiring; adjust the `{ text }` shape to what the callback actually reads — it may only check truthiness).

- [ ] **Step 5:** `pnpm test` → PASS (fixtures matched to Step 1 output).
- [ ] **Step 6: Commit** — `git commit -am "Add Codex CLI adapter that streams codex exec output like an API provider"`

### Task 13: Codex provider type in settings and routing

**Files:**
- Modify: `src/Modals/UnifiedProviderModal.ts` (preset, Codex-specific fields, curated model list)
- Modify: `src/utils/ai.ts` (route Codex in `streamResponse` and `getResponse`)

**Interfaces:**
- Consumes: `findCodexBinary`, `streamCodexResponse`, `CODEX_MODELS` (Task 12).
- Produces: provider type `"Codex"` usable everywhere text generation is.

- [ ] **Step 1: Modal** — add preset `{ id: "codex", type: "Codex", baseUrl: "" }`. Add `function isCodexType(type: string): boolean { return type === "Codex"; }`. Hide Base URL and API key fields for Codex (extend the existing conditions). Add a Codex section when `isCodexType(this.provider.type ?? "")`:

```typescript
    if (isCodexType(this.provider.type ?? "")) {
      const detected = findCodexBinary(this.provider.binaryPath);
      new Setting(contentEl)
        .setName("Codex binary")
        .setDesc(
          detected
            ? `Detected: ${detected}`
            : "Not found — install with `npm i -g @openai/codex` or set the path below."
        )
        .addText((text) => {
          text
            .setPlaceholder("/path/to/codex (optional override)")
            .setValue(this.provider.binaryPath ?? "")
            .onChange((val) => (this.provider.binaryPath = val || undefined));
        });
    }
```

In `save()`, exempt Codex from the Base URL requirement (add `!isCodexType(p.type)` to the condition) and persist `binaryPath: p.binaryPath` in the provider object. In the "Test & fetch models" click handler, special-case Codex: skip the HTTP fetch and set `this.fetchedModelIds = [...CODEX_MODELS];` + status text `Codex detected: <path>` or a warning when not found.

- [ ] **Step 2: Routing** — at the top of `streamResponse` in `ai.ts` (before `getLlm` is called):

```typescript
	if (provider.type === "Codex") {
		return streamCodexResponse(provider, messages, { max_tokens, model, temperature, providerParams, timeoutMs, onComplete }, cb);
	}
```

and at the top of `getResponse`:

```typescript
	if (provider.type === "Codex") {
		let text = "";
		await streamCodexResponse(provider, messages, { model, providerParams, timeoutMs, onComplete }, (chunk) => {
			if (chunk) text += chunk;
		});
		return isJSON ? (() => { try { return JSON.parse(text); } catch { return {}; } })() : text;
	}
```

Import `streamCodexResponse` in `ai.ts`; import `findCodexBinary, CODEX_MODELS` in the modal.

- [ ] **Step 3:** `pnpm test && pnpm run build` → PASS.
- [ ] **Step 4: Manual E2E** — in a test vault: add Codex provider (should auto-detect `~/.local/share/pnpm/codex`), select `default` model, ask a canvas card a question → streamed/complete answer appears; check console for `[Codex] spawning`.
- [ ] **Step 5: Commit** — `git commit -am "Let canvas cards talk to a locally installed Codex CLI with auto-detection"`

### Task 14: Release 0.2.5

- [ ] **Step 1:** Bump versions to 0.2.5 (three files).
- [ ] **Step 2:** `pnpm run build && git add -A && git commit -m "0.2.5: local Codex CLI as a text provider" && git push && git tag 0.2.5 && git push origin 0.2.5 && gh release create 0.2.5 main.js manifest.json --title "0.2.5" --notes "New Codex provider: runs your locally installed OpenAI Codex CLI non-interactively (read-only sandbox), auto-detected with a path override. Models: config default, gpt-5.6 sol/terra/luna, gpt-5.3-codex."`
