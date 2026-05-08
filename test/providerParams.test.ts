import { describe, it, expect } from "vitest";
import {
  PROVIDER_PARAM_DEFS,
  getParamsForProvider,
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
});
