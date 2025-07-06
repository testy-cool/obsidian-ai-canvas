import { createOpenAI } from "@ai-sdk/openai";
import { streamText, generateText, CoreMessage } from "ai";
import { logDebug } from "src/logDebug";
import { LLMProvider } from "src/settings/AugmentedCanvasSettings";

const getLlm = (provider: LLMProvider) => {
	switch (provider.type) {
		case "OpenAI":
		case "OpenRouter":
		case "Groq":
		case "Anthropic":
		case "Ollama":
		case "Gemini":
		case "Google":
		case "Custom":
		case "LiteLLM":
		case "Azure":
		case "Together":
		case "Perplexity":
		case "Claude":
		case "Mistral":
		case "Cohere":
		case "Replicate":
		case "HuggingFace":
		case "Fireworks":
		case "DeepSeek":
		case "xAI":
		case "Other":
			return createOpenAI({
				apiKey: provider.apiKey,
				baseURL: provider.baseUrl,
			});
		default:
			throw new Error(`Unsupported provider: ${provider.type}`);
	}
};

export const streamResponse = async (
	provider: LLMProvider,
	messages: CoreMessage[],
	{
		max_tokens,
		model,
		temperature,
	}: {
		max_tokens?: number;
		model?: string;
		temperature?: number;
	} = {},
	cb: (chunk: string | null, final: any, tool: any, reasoningDelta: any) => void
) => {
	logDebug("Calling AI (stream):", {
		messages,
		model,
		max_tokens,
		temperature,
		provider,
	});

	const llm = getLlm(provider);

	const result = await streamText({
		model: llm(model || "claude-3-sonnet-latest"),
		messages,
		maxTokens: max_tokens,
		temperature,
	});

	for await (const part of result.fullStream) {
		switch (part.type) {
			case 'text-delta':
				cb(part.textDelta, null, null, null);
				break;
			case 'tool-call':
				cb(null, null, part, null);
				break;
			default:
				// Ignore other parts for now
				break;
		}
	}
	cb(null, await result, null, null);
};

export const getResponse = async (
	provider: LLMProvider,
	messages: CoreMessage[],
	{
		model,
		max_tokens,
		temperature,
		isJSON,
	}: {
		model?: string;
		max_tokens?: number;
		temperature?: number;
		isJSON?: boolean;
	} = {}
) => {
	logDebug("Calling AI (non-stream):", {
		messages,
		model,
		max_tokens,
		temperature,
		isJSON,
		provider,
	});

	const llm = getLlm(provider);

	const { text } = await generateText({
		model: llm(model || "claude-3-sonnet-latest"),
		messages,
		maxTokens: max_tokens,
		temperature,
		// TODO: Add JSON mode with schema for better type safety
	});

	logDebug("AI response", { text });
	if (isJSON) {
		try {
			return JSON.parse(text as string);
		} catch (e) {
			logDebug("Error parsing JSON response:", e);
			return {}; // Return empty object on parse error
		}
	} else {
		return text ?? ""; // Ensure it's always a string
	}
};
