import OpenAI from "openai";
import { requestUrl } from "obsidian";
import { logDebug } from "src/logDebug";
import { getResponse as getResponseFromAI, streamResponse as streamResponseFromAI } from "./ai";
import { LLMProvider } from "src/settings/AugmentedCanvasSettings";
import { CoreMessage } from "ai";

export type Message = CoreMessage;

export const streamResponse = async (
	provider: LLMProvider,
	messages: Message[],
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
	return streamResponseFromAI(provider, messages, { max_tokens, model, temperature }, cb);
};

export const getResponse = async (
	provider: LLMProvider,
	messages: Message[],
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
	return getResponseFromAI(provider, messages, { model, max_tokens, temperature, isJSON });
};

let count = 0;
export type ImageGenerationResult = {
	base64: string;
	mimeType: string;
};

export type ImageGenerationOutput = {
	image: ImageGenerationResult | null;
	raw: string | null;
};

const DEFAULT_IMAGE_MIME = "image/png";
const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const normalizeGeminiBaseUrl = (value?: string) => {
	const normalized = (value && value.trim().length > 0 ? value : GEMINI_DEFAULT_BASE_URL)
		.replace(/\/+$/, "");
	return normalized.endsWith("/openai")
		? normalized.slice(0, -"/openai".length)
		: normalized;
};

const normalizeGeminiModelId = (model?: string) =>
	model ? model.replace(/^models\//i, "").trim() : "";

const extractOpenAIImage = (response: any): ImageGenerationResult | null => {
	const base64 = response?.data?.[0]?.b64_json;
	if (!base64) return null;
	return {
		base64,
		mimeType: DEFAULT_IMAGE_MIME,
	};
};

const safeStringify = (value: unknown) => {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		try {
			return JSON.stringify(JSON.parse(String(value)), null, 2);
		} catch {
			return String(value);
		}
	}
};

const extractGeminiInlineImage = (
	response: any
): ImageGenerationResult | null => {
	const payload = response?.candidates
		? response
		: response?.data?.candidates
			? response?.data
			: response;
	const candidates = payload?.candidates;
	if (!Array.isArray(candidates) || !candidates.length) return null;
	const parts = candidates[0]?.content?.parts;
	if (!Array.isArray(parts)) return null;
	const inlineData = parts.find(
		(part: any) => part?.inlineData?.data
	)?.inlineData;
	if (!inlineData?.data) return null;
	return {
		base64: inlineData.data,
		mimeType: inlineData.mimeType || DEFAULT_IMAGE_MIME,
	};
};

export const createGeminiImage = async (
	apiKey: string,
	prompt: string,
	{
		model,
		baseUrl,
	}: {
		model?: string;
		baseUrl?: string;
	} = {}
): Promise<ImageGenerationOutput> => {
	if (!apiKey) {
		throw new Error("Gemini API key is required for image generation.");
	}

	const modelId = normalizeGeminiModelId(model);
	if (!modelId) {
		throw new Error("Gemini image model is required.");
	}

	const geminiBaseUrl = normalizeGeminiBaseUrl(baseUrl);
	const url = `${geminiBaseUrl}/models/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;

	const body = {
		contents: [
			{
				role: "user",
				parts: [{ text: prompt }],
			},
		],
		generationConfig: {
			responseModalities: ["IMAGE"],
		},
	};

	const response = await requestUrl({
		url,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
	const raw = typeof response.text === "string" ? response.text : null;
	const payload = response.json ?? (raw ? JSON.parse(raw) : null);
	const imageResult = extractGeminiInlineImage(payload);
	if (!imageResult) {
		logDebug("Image data not found in Gemini response.");
	}

	return {
		image: imageResult,
		raw: raw ?? (payload ? safeStringify(payload) : null),
	};
};

export const createImage = async (
	apiKey: string,
	prompt: string,
	{
		isVertical = false,
		model,
		baseUrl,
		headers,
	}: {
		isVertical?: boolean;
		model?: string;
		baseUrl?: string;
		headers?: Record<string, string>;
	}
): Promise<ImageGenerationOutput> => {
	logDebug("Calling AI (image):", {
		prompt,
		model,
		baseUrl,
	});
	const openai = new OpenAI({
		apiKey: apiKey,
		dangerouslyAllowBrowser: true,
		baseURL: baseUrl,
		defaultHeaders: headers,
	});

	count++;
	const response = await openai.images.generate({
		model: model || "dall-e-3",
		prompt,
		n: 1,
		size: isVertical ? "1024x1792" : "1792x1024",
		response_format: "b64_json",
	});
	logDebug("AI response", { response });
	const imageResult =
		extractOpenAIImage(response) ?? extractGeminiInlineImage(response);
	if (!imageResult) {
		logDebug("Image data not found in response.");
	}

	return {
		image: imageResult,
		raw: safeStringify(response),
	};
};

