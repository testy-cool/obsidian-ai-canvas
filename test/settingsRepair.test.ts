import { describe, expect, it } from "vitest";
import { clearStaleImageSelection, type LLMModel, type LLMProvider } from "../src/settings/AugmentedCanvasSettings";

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
