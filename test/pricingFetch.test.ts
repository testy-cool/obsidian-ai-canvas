import { describe, it, expect } from "vitest";
import { matchModelPricing, type OpenRouterModel } from "../src/utils/pricingFetch";

const mockCatalog: OpenRouterModel[] = [
  {
    id: "google/gemini-3-flash-preview",
    pricing: { prompt: "0.0000001", completion: "0.0000004" },
  },
  {
    id: "openai/gpt-4o",
    pricing: { prompt: "0.0000025", completion: "0.00001" },
  },
  {
    id: "anthropic/claude-sonnet-4-6",
    pricing: { prompt: "0.000003", completion: "0.000015" },
  },
];

describe("matchModelPricing", () => {
  it("matches exact model ID with provider prefix", () => {
    const result = matchModelPricing("google/gemini-3-flash-preview", mockCatalog);
    expect(result).toBeDefined();
    expect(result!.inputCostPerMillion).toBeCloseTo(0.1);
    expect(result!.outputCostPerMillion).toBeCloseTo(0.4);
  });

  it("matches model ID without provider prefix via suffix", () => {
    const result = matchModelPricing("gemini-3-flash-preview", mockCatalog);
    expect(result).toBeDefined();
    expect(result!.inputCostPerMillion).toBeCloseTo(0.1);
  });

  it("matches model ID case-insensitively", () => {
    const result = matchModelPricing("GPT-4o", mockCatalog);
    expect(result).toBeDefined();
    expect(result!.inputCostPerMillion).toBeCloseTo(2.5);
  });

  it("returns null for unmatched model", () => {
    const result = matchModelPricing("some-unknown-model", mockCatalog);
    expect(result).toBeNull();
  });

  it("handles zero pricing gracefully", () => {
    const catalog: OpenRouterModel[] = [
      { id: "free/model", pricing: { prompt: "0", completion: "0" } },
    ];
    const result = matchModelPricing("free/model", catalog);
    expect(result).toBeDefined();
    expect(result!.inputCostPerMillion).toBe(0);
    expect(result!.outputCostPerMillion).toBe(0);
  });
});
