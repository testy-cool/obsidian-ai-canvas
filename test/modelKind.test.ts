import { describe, it, expect } from "vitest";
import { guessImageModel, isImageModel } from "../src/utils/modelKind";

describe("deciding whether a model makes images", () => {
	it("keeps today's guess from the model name when the model is left on Auto", () => {
		expect(isImageModel("Azure", { model: "gpt-image-2.5-sunburst" })).toBe(true);
		expect(isImageModel("Azure", { model: "gpt-5.6-sol" })).toBe(false);
		expect(isImageModel("Gemini", { model: "nano-banana-pro-preview" })).toBe(true);
		expect(isImageModel("Gemini", { model: "gemini-3.1-flash-image" })).toBe(true);
		expect(isImageModel("Gemini", { model: "gemini-3.1-pro-preview" })).toBe(false);
	});

	it("does not guess image for other provider types, as before", () => {
		expect(guessImageModel("Bifrost", "gpt-image-2.5-sunburst")).toBe(false);
		expect(guessImageModel("OpenAI", "vertex/gemini-3.1-flash-image")).toBe(false);
	});

	it("lets a model marked Image make images on any provider", () => {
		expect(isImageModel("Bifrost", { model: "gpt-image-2.5-sunburst", kind: "image" })).toBe(true);
		expect(isImageModel("Custom", { model: "some-new-painter", kind: "image" })).toBe(true);
	});

	it("lets a model marked Text answer in text even when its name looks like an image model", () => {
		expect(isImageModel("Gemini", { model: "gemini-3.1-flash-image", kind: "text" })).toBe(false);
	});
});
