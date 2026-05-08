import { describe, it, expect } from "vitest";
import {
  PROVIDER_PARAM_DEFS,
  getParamsForProvider,
  getParamsForModel,
  getDefaultProviderParams,
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
    const defaults = getDefaultProviderParams("Gemini");
    expect(defaults.serviceTier).toBe("standard");
    expect(defaults.flexFallback).toBe(false);
  });

  it("returns empty object for providers with no params", () => {
    const defaults = getDefaultProviderParams("Ollama");
    expect(defaults).toEqual({});
  });

  describe("getParamsForModel", () => {
    it("detects Gemini params from model ID when provider is Custom", () => {
      const params = getParamsForModel("gemini-3-flash", "Custom");
      expect(params.length).toBeGreaterThan(0);
      expect(params.find((p) => p.key === "serviceTier")).toBeDefined();
    });

    it("detects Gemini params from prefixed model ID", () => {
      const params = getParamsForModel("gemini/gemini-3-flash-preview", "Custom");
      expect(params.find((p) => p.key === "serviceTier")).toBeDefined();
    });

    it("detects Anthropic params from model ID when provider is Custom", () => {
      const params = getParamsForModel("claude-sonnet-4-6", "Custom");
      expect(params.length).toBeGreaterThan(0);
      expect(params.find((p) => p.key === "thinking")).toBeDefined();
    });

    it("detects OpenAI params from o3 model ID", () => {
      const params = getParamsForModel("o3", "Custom");
      expect(params.length).toBeGreaterThan(0);
      expect(params.find((p) => p.key === "reasoningEffort")).toBeDefined();
    });

    it("detects OpenAI params from o1 model ID", () => {
      const params = getParamsForModel("o1-mini", "Custom");
      expect(params.find((p) => p.key === "reasoningEffort")).toBeDefined();
    });

    it("detects OpenAI params from o4-mini model ID", () => {
      const params = getParamsForModel("o4-mini", "Custom");
      expect(params.find((p) => p.key === "reasoningEffort")).toBeDefined();
    });

    it("prefers provider type params over model ID detection", () => {
      const params = getParamsForModel("gemini-3-flash", "Gemini");
      expect(params.length).toBeGreaterThan(0);
      expect(params.find((p) => p.key === "serviceTier")).toBeDefined();
    });

    it("returns empty for unrecognized model on Custom provider", () => {
      const params = getParamsForModel("some-random-model", "Custom");
      expect(params).toEqual([]);
    });
  });
});
