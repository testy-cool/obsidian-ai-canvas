import type { BrowserAiSettings } from "./settings";

export interface AiHttpRequest {
	url: string;
	init: RequestInit;
}

const normalizeBaseUrl = (value: string): string => value.trim().replace(/\/+$/, "");

const validateSettings = (settings: BrowserAiSettings) => {
	if (!settings.baseUrl.trim()) throw new Error("AI provider base URL is required");
	if (!settings.model.trim()) throw new Error("AI model ID is required");
	if (!settings.apiKey.trim()) throw new Error("AI provider API key is required");
};

export const buildTextRequest = (settings: BrowserAiSettings, prompt: string): AiHttpRequest => {
	validateSettings(settings);
	const baseUrl = normalizeBaseUrl(settings.baseUrl);
	if (settings.protocol === "gemini") {
		const model = settings.model.trim().replace(/^models\//i, "");
		return {
			url: `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.apiKey)}`,
			init: {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					...(settings.systemPrompt.trim() ? {
						systemInstruction: { parts: [{ text: settings.systemPrompt.trim() }] },
					} : {}),
					contents: [{ role: "user", parts: [{ text: prompt }] }],
					generationConfig: { temperature: settings.temperature },
				}),
			},
		};
	}

	return {
		url: baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`,
		init: {
			method: "POST",
			headers: {
				Authorization: `Bearer ${settings.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: settings.model.trim(),
				messages: [
					...(settings.systemPrompt.trim() ? [{ role: "system", content: settings.systemPrompt.trim() }] : []),
					{ role: "user", content: prompt },
				],
				temperature: settings.temperature,
				stream: false,
			}),
		},
	};
};

const responseText = (settings: BrowserAiSettings, payload: any): string | null => {
	if (settings.protocol === "gemini") {
		const parts = payload?.candidates?.[0]?.content?.parts;
		if (!Array.isArray(parts)) return null;
		const text = parts.map((part: any) => typeof part?.text === "string" ? part.text : "").join("").trim();
		return text || null;
	}
	const content = payload?.choices?.[0]?.message?.content;
	if (typeof content === "string") return content.trim() || null;
	if (Array.isArray(content)) {
		const text = content.map((part: any) => typeof part?.text === "string" ? part.text : "").join("").trim();
		return text || null;
	}
	return null;
};

export const requestAiText = async (
	settings: BrowserAiSettings,
	prompt: string,
	fetcher: typeof fetch = fetch
): Promise<string> => {
	const request = buildTextRequest(settings, prompt);
	let response: Response;
	try {
		response = await fetcher(request.url, request.init);
	} catch (error) {
		throw new Error(`Could not reach the AI provider. The provider must allow browser CORS requests. ${error instanceof Error ? error.message : String(error)}`);
	}
	const raw = await response.text();
	let payload: any;
	try {
		payload = raw ? JSON.parse(raw) : {};
	} catch {
		payload = { raw };
	}
	if (!response.ok) {
		throw new Error(payload?.error?.message || payload?.message || raw || `AI request failed with status ${response.status}`);
	}
	const text = responseText(settings, payload);
	if (!text) throw new Error("The AI provider returned no text");
	return text;
};

const validateImageSettings = (settings: BrowserAiSettings) => {
	if (!settings.baseUrl.trim()) throw new Error("AI provider base URL is required");
	if (!settings.imageModel.trim()) throw new Error("Image model ID is required");
	if (!settings.apiKey.trim()) throw new Error("AI provider API key is required");
};

export const buildImageRequest = (settings: BrowserAiSettings, prompt: string): AiHttpRequest => {
	validateImageSettings(settings);
	const baseUrl = normalizeBaseUrl(settings.baseUrl);
	if (settings.protocol === "gemini") {
		const model = settings.imageModel.trim().replace(/^models\//i, "");
		return {
			url: `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.apiKey)}`,
			init: {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contents: [{ role: "user", parts: [{ text: prompt }] }],
					generationConfig: {
						responseModalities: ["IMAGE"],
						temperature: settings.temperature,
					},
				}),
			},
		};
	}

	return {
		url: baseUrl.endsWith("/images/generations") ? baseUrl : `${baseUrl}/images/generations`,
		init: {
			method: "POST",
			headers: {
				Authorization: `Bearer ${settings.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: settings.imageModel.trim(),
				prompt,
				size: "1536x1024",
			}),
		},
	};
};

export interface AiImageResult {
	src: string;
	mimeType: string;
}

export const requestAiImage = async (
	settings: BrowserAiSettings,
	prompt: string,
	fetcher: typeof fetch = fetch
): Promise<AiImageResult> => {
	const request = buildImageRequest(settings, prompt);
	let response: Response;
	try {
		response = await fetcher(request.url, request.init);
	} catch (error) {
		throw new Error(`Could not reach the image provider. The provider must allow browser CORS requests. ${error instanceof Error ? error.message : String(error)}`);
	}
	const raw = await response.text();
	let payload: any;
	try {
		payload = raw ? JSON.parse(raw) : {};
	} catch {
		payload = { raw };
	}
	if (!response.ok) {
		throw new Error(payload?.error?.message || payload?.message || raw || `Image request failed with status ${response.status}`);
	}
	if (settings.protocol === "gemini") {
		const parts = payload?.candidates?.[0]?.content?.parts;
		const inlineData = Array.isArray(parts)
			? parts.find((part: any) => typeof part?.inlineData?.data === "string")?.inlineData
			: null;
		if (inlineData?.data) {
			const mimeType = inlineData.mimeType || "image/png";
			return { src: `data:${mimeType};base64,${inlineData.data}`, mimeType };
		}
	} else {
		const image = payload?.data?.[0];
		if (typeof image?.b64_json === "string") {
			return { src: `data:image/png;base64,${image.b64_json}`, mimeType: "image/png" };
		}
		if (typeof image?.url === "string") return { src: image.url, mimeType: "image/png" };
	}
	throw new Error("The AI provider returned no image");
};
