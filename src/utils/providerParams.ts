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
