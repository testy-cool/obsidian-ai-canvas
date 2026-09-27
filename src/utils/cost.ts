export type GenerationUsage = {
	inputTokens: number;
	outputTokens: number;
	/** Part of inputTokens the provider served from its own prefix cache. */
	cachedInputTokens?: number;
};

export type ModelPrices = {
	inputCostPerMillion?: number;
	outputCostPerMillion?: number;
	cachedInputCostPerMillion?: number;
};

/**
 * What one generation cost, in dollars. Undefined when the model has no known
 * prices, so a caller can tell "free" apart from "unknown". Cached input is
 * charged at the cache-read rate when the model publishes one, and at the full
 * input rate otherwise, never at an invented discount.
 */
export const computeGenerationCost = (
	usage: GenerationUsage,
	{ inputCostPerMillion, outputCostPerMillion, cachedInputCostPerMillion }: ModelPrices
): number | undefined => {
	if (inputCostPerMillion == null || outputCostPerMillion == null) return undefined;
	const cached = Math.min(Math.max(usage.cachedInputTokens ?? 0, 0), usage.inputTokens);
	const cachedRate = cachedInputCostPerMillion ?? inputCostPerMillion;
	const input = (usage.inputTokens - cached) * inputCostPerMillion + cached * cachedRate;
	return (input + usage.outputTokens * outputCostPerMillion) / 1_000_000;
};

/** Money as a canvas card should show it: short, and never rounded to a misleading zero. */
export const formatCost = (usd: number): string => {
	if (usd === 0) return "$0";
	if (usd < 0.0001) return "<$0.0001";
	if (usd < 1) return `$${usd.toFixed(4)}`;
	return `$${usd.toFixed(2)}`;
};

/** Cost for a generation, looked up from the model entry the provider uses. */
export const costForModel = (
	models: { providerId: string; model: string; inputCostPerMillion?: number; outputCostPerMillion?: number; cachedInputCostPerMillion?: number }[],
	providerId: string,
	model: string | undefined,
	usage: GenerationUsage
): number | undefined => {
	const entry = models.find(candidate => candidate.providerId === providerId && candidate.model === model);
	return entry ? computeGenerationCost(usage, entry) : undefined;
};
