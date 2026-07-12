import { describe, expect, it } from "vitest";
import { DEFAULT_AI_SETTINGS, loadAiSettings, saveAiSettings, type BrowserStorage } from "./settings";

const memoryStorage = (): BrowserStorage & { value: string | null } => ({
	value: null,
	getItem() { return this.value; },
	setItem(_key, value) { this.value = value; },
});

describe("AI settings storage", () => {
	it("loads safe empty defaults when nothing is stored", () => {
		expect(loadAiSettings(memoryStorage())).toEqual(DEFAULT_AI_SETTINGS);
		expect(DEFAULT_AI_SETTINGS.apiKey).toBe("");
		expect(DEFAULT_AI_SETTINGS.model).toBe("");
		expect(DEFAULT_AI_SETTINGS.imageModel).toBe("");
	});

	it("round-trips local provider settings", () => {
		const storage = memoryStorage();
		const settings = { ...DEFAULT_AI_SETTINGS, baseUrl: "https://gateway.example/v1", apiKey: "local-key", model: "verified-id" };
		saveAiSettings(storage, settings);
		expect(loadAiSettings(storage)).toEqual(settings);
	});

	it("restores Azure OpenAI as the selected protocol", () => {
		const storage = memoryStorage();
		storage.value = JSON.stringify({
			...DEFAULT_AI_SETTINGS,
			protocol: "azure",
			baseUrl: "https://resource.openai.azure.com/openai/v1",
		});
		expect(loadAiSettings(storage).protocol).toBe("azure");
	});

	it("falls back to defaults for malformed stored values", () => {
		const storage = memoryStorage();
		storage.value = "not-json";
		expect(loadAiSettings(storage)).toEqual(DEFAULT_AI_SETTINGS);
	});
});
