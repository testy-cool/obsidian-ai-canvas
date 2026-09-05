import type { ModelMessage } from "@ai-sdk/provider-utils";
import type { LLMProvider } from "../settings/AugmentedCanvasSettings";
import type { StreamOptions } from "./ai";
import { createTracePayload, ObservabilityClient, TraceInput } from "./observability";

type TraceContext = Pick<TraceInput, "pluginVersion" | "vaultName" | "canvasName" | "inputCostPerMillion" | "outputCostPerMillion">;
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
				error: completion.error,
			}));
		} catch {
			// A response remains usable even if tracing cannot serialize or queue it.
		}
	}
}
