import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { fetchProviderModels } from "../src/utils/modelFetch";

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

const provider = { id: "gateway", type: "Bifrost", baseUrl: "https://example.test/v1", apiKey: "saved-key", enabled: true };

beforeEach(() => {
	vi.mocked(requestUrl).mockReset();
	vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: { data: [{ id: "test-model" }] } } as any);
});

describe("model listing authentication", () => {
	it("uses the provider's key when called by the provider modal", async () => {
		expect(await fetchProviderModels(provider)).toEqual(["test-model"]);
		expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
			url: "https://example.test/v1/models", headers: { Authorization: "Bearer saved-key" },
		}));
	});

	it("uses an explicit key override", async () => {
		await fetchProviderModels(provider, "override-key");
		expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({ headers: { Authorization: "Bearer override-key" } }));
	});

	it("also uses the stored key for Google model listing", async () => {
		await fetchProviderModels({ ...provider, type: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta" });
		expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({ url: "https://generativelanguage.googleapis.com/v1beta/models?key=saved-key" }));
	});
});

describe("model listing for a provider that is not saved yet", () => {
	// The Add Provider box fetches before Save, when the provider has no id.
	it.each([
		["OpenAI", "https://example.test/v1", "https://example.test/v1/models"],
		["Ollama", "http://localhost:11434/v1", "http://localhost:11434/v1/models"],
		["Azure", "https://resource.example", "https://resource.example/openai/v1/models"],
		["Gemini", "https://generativelanguage.googleapis.com/v1beta", "https://generativelanguage.googleapis.com/v1beta/models?key=saved-key"],
	])("lists %s models", async (type, baseUrl, url) => {
		const unsaved: any = { type, baseUrl, apiKey: "saved-key", enabled: true };
		expect(await fetchProviderModels(unsaved)).toEqual(["test-model"]);
		expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({ url }));
	});
});
