import { describe, it, expect } from "vitest";
import { buildVertexImageUrl, buildAzureImageRequest } from "../src/utils/llm";

describe("buildAzureImageRequest", () => {
	it("builds the v1 generations request", () => {
		const { url, body } = buildAzureImageRequest(
			"https://sfera-2425-resource.services.ai.azure.com/",
			undefined,
			"a red fox",
			"medium"
		);
		expect(url).toBe("https://sfera-2425-resource.services.ai.azure.com/openai/v1/images/generations");
		expect(body).toEqual({
			model: "gpt-image-2",
			prompt: "a red fox",
			size: "1536x1024",
			quality: "medium",
			output_format: "png",
		});
	});
});

describe("buildVertexImageUrl", () => {
	it("builds the aiplatform generateContent URL", () => {
		const provider: any = { projectId: "my-proj", location: "europe-west4" };
		expect(buildVertexImageUrl(provider, "gemini-3-pro-image-preview")).toBe(
			"https://europe-west4-aiplatform.googleapis.com/v1/projects/my-proj/locations/europe-west4/publishers/google/models/gemini-3-pro-image-preview:generateContent"
		);
	});
	it("defaults location to us-central1 and strips models/ prefix", () => {
		const provider: any = { projectId: "p" };
		expect(buildVertexImageUrl(provider, "models/nano-banana")).toBe(
			"https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/publishers/google/models/nano-banana:generateContent"
		);
	});
});
