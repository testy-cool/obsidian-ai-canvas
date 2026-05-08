import { requestUrl } from "obsidian";

export interface OpenRouterModel {
  id: string;
  pricing: { prompt: string; completion: string };
}

export interface ModelPricing {
  inputCostPerMillion: number;
  outputCostPerMillion: number;
}

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

let cachedCatalog: OpenRouterModel[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function matchModelPricing(
  modelId: string,
  catalog: OpenRouterModel[]
): ModelPricing | null {
  const lower = modelId.toLowerCase();

  let match = catalog.find((m) => m.id.toLowerCase() === lower);

  if (!match) {
    match = catalog.find((m) => m.id.toLowerCase().endsWith("/" + lower));
  }

  if (!match) {
    match = catalog.find((m) => {
      const catalogModel = m.id.split("/").pop()?.toLowerCase();
      return catalogModel === lower;
    });
  }

  if (!match) return null;

  const promptPerToken = parseFloat(match.pricing.prompt);
  const completionPerToken = parseFloat(match.pricing.completion);

  if (isNaN(promptPerToken) || isNaN(completionPerToken)) return null;

  return {
    inputCostPerMillion: promptPerToken * 1_000_000,
    outputCostPerMillion: completionPerToken * 1_000_000,
  };
}

export async function fetchOpenRouterCatalog(): Promise<OpenRouterModel[]> {
  const now = Date.now();
  if (cachedCatalog && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedCatalog;
  }

  try {
    const response = await requestUrl({ url: OPENROUTER_MODELS_URL });
    const data = response.json;
    cachedCatalog = (data.data || []).filter(
      (m: OpenRouterModel) => m.pricing?.prompt != null
    );
    cacheTimestamp = now;
    return cachedCatalog!;
  } catch {
    return cachedCatalog ?? [];
  }
}

export async function fetchPricingForModels(
  modelIds: string[]
): Promise<Map<string, ModelPricing>> {
  const catalog = await fetchOpenRouterCatalog();
  const result = new Map<string, ModelPricing>();

  for (const id of modelIds) {
    const pricing = matchModelPricing(id, catalog);
    if (pricing) {
      result.set(id, pricing);
    }
  }

  return result;
}

export function clearPricingCache(): void {
  cachedCatalog = null;
  cacheTimestamp = 0;
}
