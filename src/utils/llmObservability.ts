import type { ModelMessage } from "@ai-sdk/provider-utils";
import type { LLMProvider } from "../settings/AugmentedCanvasSettings";
import type { StreamOptions } from "./ai";
import { createTracePayload, ObservabilityClient, TraceInput } from "./observability";

type TraceContext = Pick<TraceInput, "pluginVersion" | "vaultName" | "canvasName" | "inputCostPerMillion" | "outputCostPerMillion" | "cachedInputCostPerMillion">;
type ContextGetter = (provider: LLMProvider, model?: string) => TraceContext;
let configured: { client: ObservabilityClient; context: ContextGetter } | null = null;

export function configureLLMObservability(client: ObservabilityClient | null, context: ContextGetter = () => ({ pluginVersion: "unknown" })) {
	configured = client ? { client, context } : null;
}

/** Capture one completed text request, keeping tracing failures outside the generation path. */
export async function observeLLM<T, O extends StreamOptions>(
	provider: LLMProvider,
	messages: ModelMessage[],
	options: O,
	run: (options: O) => Promise<T>
): Promise<T> {
	const current = configured;
	if (!current?.client.enabled) return run(options);
	let context: TraceContext;
	let input: string;
	try {
		context = current.context(provider, options.model);
		input = JSON.stringify(messages, (_key, value) => value instanceof Uint8Array
			? { type: "binary", bytes: value.byteLength } : value);
	} catch {
		return run(options);
	}
	const startTime = new Date().toISOString();
	let completion: Parameters<NonNullable<StreamOptions["onComplete"]>>[0] = { inputTokens: 0, outputTokens: 0, totalText: "" };
	try {
		return await run({ ...options, onComplete: result => {
			completion = result;
			options.onComplete?.(result);
		} });
	} catch (error) {
		completion.error = error instanceof Error ? error.message : "Text generation failed";
		throw error;
	} finally {
		try {
			current.client.track(createTracePayload({
				...context,
				name: "AI Canvas generation",
				model: options.model ?? "provider default",
				provider: provider.type,
				providerParams: { ...options.providerParams, temperature: options.temperature, max_tokens: options.max_tokens },
				input,
				output: completion.totalText,
				startTime,
				endTime: new Date().toISOString(),
				inputTokens: completion.inputTokens,
				outputTokens: completion.outputTokens,
				cachedInputTokens: completion.cachedInputTokens,
				error: completion.error,
			}));
		} catch {
			// A response remains usable even if tracing cannot serialize or queue it.
		}
	}
}

/** Capture one image generation. Image APIs report no token counts, so the trace
 * carries the prompt, the model and what came back, without a cost. */
export async function observeImage<T>(
	{ provider, model, prompt }: { provider?: { id?: string; type?: string }; model?: string; prompt: string },
	run: () => Promise<T>
): Promise<T> {
	const current = configured;
	if (!current?.client.enabled) return run();

	let context: TraceContext;
	try {
		context = current.context(provider as LLMProvider, model);
	} catch {
		return run();
	}
	const startTime = new Date().toISOString();
	let output = "no image returned";
	let error: string | undefined;
	try {
		const result = await run();
		const mimeType = (result as any)?.image?.mimeType;
		if (typeof mimeType === "string" && mimeType) output = mimeType;
		return result;
	} catch (failure) {
		error = failure instanceof Error ? failure.message : "Image generation failed";
		throw failure;
	} finally {
		try {
			current.client.track(createTracePayload({
				...context,
				// Pricing is per image, not per token, so cost is left out rather than guessed.
				inputCostPerMillion: undefined,
				outputCostPerMillion: undefined,
				name: "AI Canvas image",
				model: model ?? "provider default",
				provider: provider?.type ?? "unknown",
				input: prompt,
				output,
				startTime,
				endTime: new Date().toISOString(),
				inputTokens: 0,
				outputTokens: 0,
				error,
			}));
		} catch {
			// An image stays usable even if its trace cannot be queued.
		}
	}
}
