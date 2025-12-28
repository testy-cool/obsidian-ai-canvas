import { requestUrl } from "obsidian";
import { GEMINI_BASE_URL, LLMProvider } from "../settings/AugmentedCanvasSettings";

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, "");

const normalizeModelId = (id: string) =>
	id.startsWith("models/") ? id.slice("models/".length) : id;

const getModelsUrl = (baseUrl: string) => {
	const normalized = normalizeBaseUrl(baseUrl);

	if (/\/models$/i.test(normalized)) {
		return normalized;
	}

	if (/\/v1$/i.test(normalized)) {
		return `${normalized}/models`;
	}

	return `${normalized}/v1/models`;
};

const parseModelIds = (payload: unknown): string[] => {
	if (!payload) return [];

	const data =
		// OpenAI-compatible list response
		(payload as { data?: unknown }).data ??
		// Ollama tags response
		(payload as { models?: unknown }).models ??
		payload;

	if (!Array.isArray(data)) return [];

	const ids = data
		.map((item: any) => item?.id ?? item?.model ?? item?.name)
		.filter((id: unknown) => typeof id === "string" && id.trim().length > 0)
		.map((id: string) => normalizeModelId(id.trim()));

	return Array.from(new Set(ids));
};

export const fetchProviderModels = async (
	provider: LLMProvider,
	apiKey?: string
): Promise<string[]> => {
	const isOllama =
		provider.type === "Ollama" || provider.id.toLowerCase() === "ollama";
	const isGoogle =
		provider.type === "Gemini" ||
		provider.type === "Google" ||
		["gemini", "google"].includes(provider.id.toLowerCase());

	const headers: Record<string, string> = {};
	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}

	if (isGoogle) {
		if (!apiKey) {
			throw new Error("Gemini API key is required to fetch models.");
		}

		const googleBase =
			provider.baseUrl?.length > 0
				? normalizeBaseUrl(provider.baseUrl)
				: GEMINI_BASE_URL;
		const baseWithModels = /\/models$/i.test(googleBase)
			? googleBase
			: `${googleBase}/models`;
		const modelsUrl = `${baseWithModels}?key=${encodeURIComponent(apiKey)}`;
		const response = await requestUrl({
			url: modelsUrl,
			method: "GET",
		});
		const payload = response.json ?? JSON.parse(response.text);
		return parseModelIds(payload);
	}

	if (!provider.baseUrl) {
		throw new Error("Provider base URL is not set.");
	}

	const modelsUrl = getModelsUrl(provider.baseUrl);

	try {
		const response = await requestUrl({
			url: modelsUrl,
			method: "GET",
			headers,
		});

		const payload = response.json ?? JSON.parse(response.text);
		const ids = parseModelIds(payload);
		if (ids.length) return ids;
	} catch (error) {
		if (!isOllama) {
			throw error;
		}
	}

	if (isOllama) {
		const ollamaBase = normalizeBaseUrl(provider.baseUrl).replace(
			/\/v1$/i,
			""
		);
		const tagsUrl = `${ollamaBase}/api/tags`;
		const response = await requestUrl({
			url: tagsUrl,
			method: "GET",
			headers,
		});
		const payload = response.json ?? JSON.parse(response.text);
		return parseModelIds(payload);
	}

	return [];
};
