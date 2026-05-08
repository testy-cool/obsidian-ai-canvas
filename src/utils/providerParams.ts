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
