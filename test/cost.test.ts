import { describe, it, expect } from "vitest";
import { computeGenerationCost, costForModel, formatCost } from "../src/utils/cost";

describe("computeGenerationCost", () => {
	const prices = { inputCostPerMillion: 1, outputCostPerMillion: 4 };

	it("adds input and output at their own rates", () => {
		expect(computeGenerationCost({ inputTokens: 1000, outputTokens: 100 }, prices))
			.toBeCloseTo(0.001 + 0.0004, 10);
	});

	it("charges the cached part at the cache-read rate", () => {
		expect(computeGenerationCost({ inputTokens: 1000, cachedInputTokens: 800, outputTokens: 0 },
			{ ...prices, cachedInputCostPerMillion: 0.25 })).toBeCloseTo(0.0004, 10);
	});

	it("falls back to the full input rate when no cache-read rate is known", () => {
		expect(computeGenerationCost({ inputTokens: 1000, cachedInputTokens: 800, outputTokens: 0 }, prices))
			.toBeCloseTo(0.001, 10);
	});

	it("never counts more cached tokens than input tokens", () => {
		expect(computeGenerationCost({ inputTokens: 100, cachedInputTokens: 9999, outputTokens: 0 },
			{ ...prices, cachedInputCostPerMillion: 0 })).toBe(0);
	});

	it("returns nothing when the model has no published prices", () => {
		expect(computeGenerationCost({ inputTokens: 1000, outputTokens: 10 }, {})).toBeUndefined();
		expect(computeGenerationCost({ inputTokens: 1000, outputTokens: 10 }, { inputCostPerMillion: 1 })).toBeUndefined();
	});
});

describe("formatCost", () => {
	it("keeps small amounts readable", () => {
		expect(formatCost(0.0004)).toBe("$0.0004");
		expect(formatCost(0.0014)).toBe("$0.0014");
	});

	it("shortens amounts over a dollar", () => {
		expect(formatCost(1.2345)).toBe("$1.23");
		expect(formatCost(12)).toBe("$12.00");
	});

	it("says when an amount rounds away to nothing", () => {
		expect(formatCost(0.00004)).toBe("<$0.0001");
		expect(formatCost(0)).toBe("$0");
	});
});

describe("costForModel", () => {
	const models = [
		{ id: "a", providerId: "bifrost", model: "flash", enabled: true, inputCostPerMillion: 1, outputCostPerMillion: 4, cachedInputCostPerMillion: 0.25 },
		{ id: "b", providerId: "other", model: "flash", enabled: true, inputCostPerMillion: 99, outputCostPerMillion: 99 },
	] as any;

	it("uses the prices stored for that provider's copy of the model", () => {
		expect(costForModel(models, "bifrost", "flash", { inputTokens: 1000, cachedInputTokens: 800, outputTokens: 0 }))
			.toBeCloseTo(0.0004, 10);
	});

	it("returns nothing when the model is not configured", () => {
		expect(costForModel(models, "bifrost", "unknown", { inputTokens: 10, outputTokens: 10 })).toBeUndefined();
	});
});
