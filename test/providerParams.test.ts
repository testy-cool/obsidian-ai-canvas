import { describe, it, expect } from "vitest";
import {
  PROVIDER_PARAM_DEFS,
  getParamsForProvider,
  getParamsForModel,
  getDefaultProviderParams,
  detectProviderLabel,
  applyOpenAICompatParams,
  type ProviderParamDef,
} from "../src/utils/providerParams";

describe("providerParams", () => {
  it("returns Gemini params for Gemini provider type", () => {
    const params = getParamsForProvider("Gemini");
    expect(params.length).toBeGreaterThan(0);
    const tierParam = params.find((p) => p.key === "serviceTier");
    expect(tierParam).toBeDefined();
    expect(tierParam!.type).toBe("select");
    expect(tierParam!.options).toContain("flex");
  });

  it("returns Gemini params for Vertex provider type", () => {
    const params = getParamsForProvider("Vertex");
    const tierParam = params.find((p) => p.key === "serviceTier");
    expect(tierParam).toBeDefined();
  });

  it("returns OpenAI params for OpenAI provider type", () => {
    const params = getParamsForProvider("OpenAI");
    const reasoningParam = params.find((p) => p.key === "reasoningEffort");
    expect(reasoningParam).toBeDefined();
    expect(reasoningParam!.type).toBe("select");
  });

  it("returns empty array for unknown provider types", () => {
    const params = getParamsForProvider("SomeRandomProvider");
    expect(params).toEqual([]);
  });

  it("returns defaults for Gemini provider", () => {
    const defaults = getDefaultProviderParams("gemini-3-flash", "Gemini");
    expect(defaults.serviceTier).toBe("standard");
    expect(defaults.flexFallback).toBe(false);
  });

  it("returns empty object for providers with no params", () => {
    const defaults = getDefaultProviderParams("llama-3", "Ollama");
    expect(defaults).toEqual({});
  });
});

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
