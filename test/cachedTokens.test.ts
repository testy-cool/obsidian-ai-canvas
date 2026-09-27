import { describe, it, expect } from "vitest";
import { matchModelPricing, type OpenRouterModel } from "../src/utils/pricingFetch";
import { createTracePayload, formatLangfuseBatch } from "../src/utils/observability";

const catalog: OpenRouterModel[] = [
	{ id: "google/gemini-3-flash-preview", pricing: { prompt: "0.000001", completion: "0.000004", input_cache_read: "0.00000025" } },
	{ id: "openai/gpt-4o", pricing: { prompt: "0.0000025", completion: "0.00001" } },
];

describe("cached input pricing", () => {
	it("picks up the published cache-read rate", () => {
		const result = matchModelPricing("google/gemini-3-flash-preview", catalog);
		expect(result!.cachedInputCostPerMillion).toBeCloseTo(0.25);
	});

	it("leaves the cache-read rate unset when the model does not publish one", () => {
		const result = matchModelPricing("openai/gpt-4o", catalog);
		expect(result!.cachedInputCostPerMillion).toBeUndefined();
	});
});

const base = {
	name: "chat",
	model: "gemini-3-flash-preview",
	provider: "gemini",
	input: "hello",
	output: "world",
	startTime: "2026-09-27T00:00:00Z",
	endTime: "2026-09-27T00:00:01Z",
	pluginVersion: "0.3.17",
	inputCostPerMillion: 1,
	outputCostPerMillion: 4,
};

describe("cost with cached input tokens", () => {
	it("charges the cached part at the cache-read rate", () => {
		const payload = createTracePayload({
			...base, inputTokens: 1000, cachedInputTokens: 800, outputTokens: 100,
			cachedInputCostPerMillion: 0.25,
		});
		// 200 fresh at $1/M plus 800 cached at $0.25/M.
		expect(payload.cost!.input).toBeCloseTo(0.0004, 10);
		expect(payload.tokens.cachedInput).toBe(800);
	});

	it("charges the full input rate when no cache-read rate is known", () => {
		const payload = createTracePayload({
			...base, inputTokens: 1000, cachedInputTokens: 800, outputTokens: 100,
		});
		expect(payload.cost!.input).toBeCloseTo(0.001, 10);
	});

	it("reports cached tokens to Langfuse so a warm run is recognisable", () => {
		const payload = createTracePayload({ ...base, inputTokens: 1000, cachedInputTokens: 800, outputTokens: 100 });
		const attributes = formatLangfuseBatch([payload]).resourceSpans[0].scopeSpans[0].spans[0].attributes;
		const cached = attributes.find((a: any) => a.key === "gen_ai.usage.cached_input_tokens");
		expect(cached?.value).toEqual({ intValue: "800" });
	});
});
