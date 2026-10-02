import { describe, expect, it } from "vitest";
import { clearStaleImageSelection, isUntouchedLegacyDefaults, type LLMModel, type LLMProvider } from "../src/settings/AugmentedCanvasSettings";

const provider = (id: string): LLMProvider => ({ id, type: "Custom", baseUrl: "https://example.test/v1", apiKey: "k", enabled: true });
const model = (providerId: string, id: string, enabled = true): LLMModel => ({ id, providerId, model: id, enabled });

const settings = (imageProviderId: string, imageModelId: string) => ({
	providers: [provider("one"), provider("two")],
	models: [model("one", "one-on"), model("one", "one-off", false), model("two", "two-on")],
	activeProvider: "one",
	imageProviderId,
	imageModelId,
});

describe("clearStaleImageSelection", () => {
	it("keeps an image model that is enabled on the image provider", () => {
		const s = settings("two", "two-on");
		clearStaleImageSelection(s);
		expect([s.imageProviderId, s.imageModelId]).toEqual(["two", "two-on"]);
	});

	it("clears an image model that is switched off", () => {
		const s = settings("", "one-off");
		clearStaleImageSelection(s);
		expect(s.imageModelId).toBe("");
	});

	it("clears an image provider that no longer exists, and the model chosen under it", () => {
		const s = settings("gone", "two-on");
		clearStaleImageSelection(s);
		expect([s.imageProviderId, s.imageModelId]).toEqual(["", ""]);
	});

	it("reads an empty image provider as the active provider", () => {
		const own = settings("", "one-on");
		clearStaleImageSelection(own);
		expect(own.imageModelId).toBe("one-on");
		const foreign = settings("", "two-on");
		clearStaleImageSelection(foreign);
		expect(foreign.imageModelId).toBe("");
	});

	it("leaves an empty selection alone", () => {
		const s = settings("", "");
		clearStaleImageSelection(s);
		expect([s.imageProviderId, s.imageModelId]).toEqual(["", ""]);
	});
});

describe("isUntouchedLegacyDefaults", () => {
	const legacy = (id: string, extra: Partial<LLMProvider> = {}): LLMProvider => ({
		id,
		type: { openai: "OpenAI", anthropic: "Anthropic", groq: "Groq", openrouter: "OpenRouter", gemini: "Gemini", ollama: "Ollama" }[id]!,
		baseUrl: "https://example.test/v1",
		apiKey: "",
		enabled: true,
		...extra,
	});
	const six = () => ["openai", "anthropic", "groq", "openrouter", "gemini", "ollama"].map(id => legacy(id));

	it("is true for the old six built-in providers with no key", () => {
		expect(isUntouchedLegacyDefaults(six())).toBe(true);
		expect(isUntouchedLegacyDefaults([legacy("gemini"), legacy("openai")])).toBe(true);
	});

	it("is false for a single provider or none", () => {
		expect(isUntouchedLegacyDefaults([legacy("gemini")])).toBe(false);
		expect(isUntouchedLegacyDefaults([])).toBe(false);
	});

	it("is false when any provider has an API key", () => {
		const providers = six();
		providers[3].apiKey = "sk-set";
		expect(isUntouchedLegacyDefaults(providers)).toBe(false);
	});

	it("is false for a Codex provider that took the id openai", () => {
		const providers = six();
		providers[0] = { ...legacy("openai"), type: "Codex", baseUrl: "" };
		expect(isUntouchedLegacyDefaults(providers)).toBe(false);
	});

	it("is false for a renamed provider", () => {
		const providers = six();
		providers[1] = legacy("anthropic", { name: "Work Claude" });
		expect(isUntouchedLegacyDefaults(providers)).toBe(false);
	});

	it("is false when a provider is not on the old list", () => {
		expect(isUntouchedLegacyDefaults([legacy("gemini"), { id: "mine", type: "Custom", baseUrl: "https://x.test", apiKey: "", enabled: true }])).toBe(false);
	});
});
