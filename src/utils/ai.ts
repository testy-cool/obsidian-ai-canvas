import { createOpenAI } from "@ai-sdk/openai";
import { GoogleGenerativeAILanguageModel } from "@ai-sdk/google/internal";
import { streamText, generateText, CoreMessage } from "ai";
import { logDebug } from "src/logDebug";
import { LLMProvider } from "src/settings/AugmentedCanvasSettings";

const isSupportedGoogleFileUrl = (url: URL) =>
	url.toString().startsWith("https://generativelanguage.googleapis.com/v1beta/files/");

const isSupportedYouTubeUrl = (url: URL) => {
	const value = url.toString();
	return (
		value.startsWith("https://www.youtube.com/") ||
		value.startsWith("https://youtube.com/") ||
		value.startsWith("https://youtu.be/")
	);
};

const generateId = (size = 16) => {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	let result = "";
	for (let i = 0; i < size; i += 1) {
		result += chars[Math.floor(Math.random() * chars.length)];
	}
	return result;
};

const withoutTrailingSlash = (value?: string) =>
	value ? value.replace(/\/+$/, "") : value;

const loadApiKey = (apiKey?: string) => {
	if (!apiKey) {
		throw new Error("Google Generative AI API key is missing.");
	}
	return apiKey;
};

const createGoogleGenerativeAI = (options: {
	apiKey?: string;
	baseURL?: string;
	headers?: Record<string, string | undefined>;
	generateId?: () => string;
	fetch?: typeof fetch;
} = {}) => {
	const baseURL =
		withoutTrailingSlash(options.baseURL) ??
		"https://generativelanguage.googleapis.com/v1beta";
	const getHeaders = () => ({
		"x-goog-api-key": loadApiKey(options.apiKey),
		...options.headers,
	});
	const createChatModel = (modelId: string, settings: Record<string, any> = {}) =>
		new GoogleGenerativeAILanguageModel(modelId as any, settings, {
			provider: "google.generative-ai",
			baseURL,
			headers: getHeaders,
			generateId: options.generateId ?? generateId,
			isSupportedUrl: (url: URL) =>
				isSupportedGoogleFileUrl(url) || isSupportedYouTubeUrl(url),
			fetch: options.fetch,
		});

	const provider = function (modelId: string, settings?: Record<string, any>) {
		if (new.target) {
			throw new Error(
				"The Google Generative AI model function cannot be called with the new keyword."
			);
		}
		return createChatModel(modelId, settings);
	} as any;

	provider.languageModel = createChatModel;
	provider.chat = createChatModel;
	provider.generativeAI = createChatModel;

	return provider;
};

const getLlm = (provider: LLMProvider) => {
	switch (provider.type) {
		case "Gemini":
		case "Google":
			return createGoogleGenerativeAI({
				apiKey: provider.apiKey,
			});
		case "OpenAI":
		case "OpenRouter":
		case "Groq":
		case "Anthropic":
		case "Ollama":
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

const isGoogleProvider = (provider: LLMProvider) =>
	provider.type === "Gemini" || provider.type === "Google";

const supportsSearchGrounding = (modelId: string) =>
	/^(?:models\/)?gemini-2\.5-/.test(modelId);

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

	const llm = getLlm(provider) as any;
	const modelId = model || "gemini-3-flash-preview";
	const canUseSearch = isGoogleProvider(provider) && supportsSearchGrounding(modelId);

	const runStream = (useSearchGrounding: boolean) =>
		streamText({
			model: useSearchGrounding ? llm(modelId, { useSearchGrounding: true }) : llm(modelId),
			messages,
			maxTokens: max_tokens,
			temperature,
		});

	let result;
	try {
		result = await runStream(canUseSearch);
	} catch (error) {
		if (!canUseSearch) {
			throw error;
		}
		logDebug("Search grounding failed, retrying without it.", { error });
		result = await runStream(false);
	}

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

	const llm = getLlm(provider) as any;
	const modelId = model || "gemini-3-flash-preview";
	const canUseSearch = isGoogleProvider(provider) && supportsSearchGrounding(modelId);

	const runGenerate = (useSearchGrounding: boolean) =>
		generateText({
			model: useSearchGrounding ? llm(modelId, { useSearchGrounding: true }) : llm(modelId),
			messages,
			maxTokens: max_tokens,
			temperature,
			// TODO: Add JSON mode with schema for better type safety
		});

	let textResult;
	try {
		textResult = await runGenerate(canUseSearch);
	} catch (error) {
		if (!canUseSearch) {
			throw error;
		}
		logDebug("Search grounding failed, retrying without it.", { error });
		textResult = await runGenerate(false);
	}

	const { text } = textResult;

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
