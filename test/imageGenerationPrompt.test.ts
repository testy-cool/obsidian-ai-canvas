import { describe, expect, it } from "vitest";
import {
	getImageGenerationPrompt,
	setImageGenerationPrompt,
	withImageGenerationPrompt,
} from "../src/utils/imageGenerationPrompt";

describe("image generation prompt metadata", () => {
	it("stores the exact API prompt without changing the existing node data", () => {
		const original = {
			id: "image-card",
			type: "file",
			file: "generated.png",
		};
		const prompt = "  Keep this exact spacing\nand line break.  ";

		const updated = withImageGenerationPrompt(original, prompt);

		expect(updated).toEqual({
			...original,
			ai_image_prompt: prompt,
		});
		expect(original).not.toHaveProperty("ai_image_prompt");
	});

	it("returns only non-empty string prompt metadata verbatim", () => {
		expect(
			getImageGenerationPrompt({
				ai_image_prompt: "  A cinematic red fox.\nUse soft light.  ",
			})
		).toBe("  A cinematic red fox.\nUse soft light.  ");
		expect(getImageGenerationPrompt({ ai_image_prompt: "   " })).toBeNull();
		expect(getImageGenerationPrompt({ ai_image_prompt: 42 })).toBeNull();
		expect(getImageGenerationPrompt({})).toBeNull();
	});

	it("applies prompt metadata through the Canvas node data API", () => {
		const written: Record<string, unknown>[] = [];
		const node = {
			getData: () => ({ id: "generated-image", type: "file" }),
			setData: (data: Record<string, unknown>) => written.push(data),
		};

		setImageGenerationPrompt(node, "A fox in a forest");

		expect(written).toEqual([
			{
				id: "generated-image",
				type: "file",
				ai_image_prompt: "A fox in a forest",
			},
		]);
	});
});
