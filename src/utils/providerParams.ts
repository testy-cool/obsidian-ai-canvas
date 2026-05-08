export interface ProviderParamDef {
  key: string;
  label: string;
  description: string;
  type: "select" | "boolean" | "number";
  options?: string[];
  default?: unknown;
  providerTypes: string[];
}

export const PROVIDER_PARAM_DEFS: ProviderParamDef[] = [
  {
    key: "serviceTier",
    label: "Service Tier",
    description: "Inference priority. Flex is 50% cheaper, 1-15 min latency.",
    type: "select",
    options: ["standard", "flex", "priority"],
    default: "standard",
    providerTypes: ["Gemini", "Google", "Vertex"],
  },
  {
    key: "flexFallback",
    label: "Flex Fallback",
    description: "Retry with standard tier if flex times out.",
    type: "boolean",
    default: false,
    providerTypes: ["Gemini", "Google", "Vertex"],
  },
  {
    key: "reasoningEffort",
    label: "Reasoning Effort",
    description: "Controls thinking budget for o-series models.",
    type: "select",
    options: ["low", "medium", "high"],
    default: undefined,
    providerTypes: ["OpenAI"],
  },
  {
    key: "thinking",
    label: "Extended Thinking",
    description: "Enable extended thinking for Claude models.",
    type: "boolean",
    default: false,
    providerTypes: ["Anthropic"],
  },
];

export function getParamsForProvider(providerType: string): ProviderParamDef[] {
  return PROVIDER_PARAM_DEFS.filter((p) =>
    p.providerTypes.includes(providerType)
  );
}

/**
 * Detect provider params from model ID when provider type has no specific params.
 * Useful for proxy providers (Bifrost, LiteLLM) where type is "Custom" but
 * the model is actually a Gemini/OpenAI/Anthropic model.
 */
export function getParamsForModel(
  modelId: string,
  providerType: string
): ProviderParamDef[] {
  const byProvider = getParamsForProvider(providerType);
  if (byProvider.length) return byProvider;

  const lower = modelId.toLowerCase();
  if (lower.includes("gemini")) return getParamsForProvider("Gemini");
  if (lower.includes("claude")) return getParamsForProvider("Anthropic");
  if (/(?:^|[\/-])o[134]\b/.test(lower)) return getParamsForProvider("OpenAI");

  return [];
}

/**
 * Returns the detected provider type label for display purposes.
 */
export function detectProviderLabel(
  modelId: string,
  providerType: string
): string {
  const byProvider = getParamsForProvider(providerType);
  if (byProvider.length) return providerType;

  const lower = modelId.toLowerCase();
  if (lower.includes("gemini")) return "Gemini";
  if (lower.includes("claude")) return "Anthropic";
  if (/(?:^|[\/-])o[134]\b/.test(lower)) return "OpenAI";

  return providerType;
}

export function getDefaultProviderParams(
  providerType: string
): Record<string, unknown> {
  const defs = getParamsForProvider(providerType);
  const defaults: Record<string, unknown> = {};
  for (const def of defs) {
    if (def.default !== undefined) {
      defaults[def.key] = def.default;
    }
  }
  return defaults;
}
