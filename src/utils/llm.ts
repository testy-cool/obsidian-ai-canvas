import OpenAI from "openai";
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
export const createImage = async (
	apiKey: string,
	prompt: string,
	{
		isVertical = false,
		model,
		baseUrl,
	}: {
		isVertical?: boolean;
		model?: string;
		baseUrl?: string;
	}
) => {
	logDebug("Calling AI (image):", {
		prompt,
		model,
		baseUrl,
	});
	const openai = new OpenAI({
		apiKey: apiKey,
		dangerouslyAllowBrowser: true,
		baseURL: baseUrl,
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
	if (response.data && response.data[0] && response.data[0].b64_json) {
		return response.data[0].b64_json;
	} else {
		logDebug("Image data not found in response.");
		return null;
	}
};

