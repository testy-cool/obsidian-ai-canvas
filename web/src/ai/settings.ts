export type AiProtocol = "openai-compatible" | "gemini";

export interface BrowserAiSettings {
	protocol: AiProtocol;
	baseUrl: string;
	apiKey: string;
	model: string;
	imageModel: string;
	systemPrompt: string;
	temperature: number;
}

export interface BrowserStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export const DEFAULT_AI_SETTINGS: BrowserAiSettings = {
	protocol: "openai-compatible",
	baseUrl: "https://api.openai.com/v1",
	apiKey: "",
	model: "",
	imageModel: "",
	systemPrompt: "You are a careful thinking partner. Use the supplied canvas context and follow the user's task.",
	temperature: 0.7,
};

const STORAGE_KEY = "obsidian-ai-canvas:web-ai-settings";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const loadAiSettings = (storage: BrowserStorage): BrowserAiSettings => {
	try {
		const raw = storage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULT_AI_SETTINGS };
		const value: unknown = JSON.parse(raw);
		if (!isRecord(value)) return { ...DEFAULT_AI_SETTINGS };
		const protocol = value.protocol === "gemini" || value.protocol === "openai-compatible"
			? value.protocol
			: DEFAULT_AI_SETTINGS.protocol;
		return {
			protocol,
			baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : DEFAULT_AI_SETTINGS.baseUrl,
			apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
			model: typeof value.model === "string" ? value.model : "",
			imageModel: typeof value.imageModel === "string" ? value.imageModel : "",
			systemPrompt: typeof value.systemPrompt === "string" ? value.systemPrompt : DEFAULT_AI_SETTINGS.systemPrompt,
			temperature: typeof value.temperature === "number" && Number.isFinite(value.temperature)
				? Math.min(2, Math.max(0, value.temperature))
				: DEFAULT_AI_SETTINGS.temperature,
		};
	} catch {
		return { ...DEFAULT_AI_SETTINGS };
	}
};

export const saveAiSettings = (storage: BrowserStorage, settings: BrowserAiSettings): void => {
	storage.setItem(STORAGE_KEY, JSON.stringify(settings));
};
