import { describe, it, expect } from "vitest";
import {
	buildVertexImageUrl,
	buildAzureImageRequest,
	buildAzureImageEditBody,
} from "../src/utils/llm";

describe("buildAzureImageEditBody", () => {
	const png = Buffer.from("fakepngbytes").toString("base64");

	it("builds a multipart body with fidelity fields and image parts", () => {
		const body = buildAzureImageEditBody(
			undefined,
			"dress him sharply",
			"medium",
			[{ data: png, mimeType: "image/png" }],
			"BOUNDARY"
		);
		const text = Buffer.from(body).toString("latin1");
		expect(text).toContain('name="model"\r\n\r\ngpt-image-2');
		expect(text).toContain('name="prompt"\r\n\r\ndress him sharply');
		expect(text).toContain('name="quality"\r\n\r\nmedium');
		expect(text).toContain('name="input_fidelity"\r\n\r\nhigh');
		expect(text).toContain('name="output_format"\r\n\r\npng');
		expect(text).toContain('name="image[]"; filename="reference-0.png"');
		expect(text).toContain("Content-Type: image/png");
		expect(text).toContain("fakepngbytes");
		expect(text.endsWith("--BOUNDARY--\r\n")).toBe(true);
	});

	it("names jpeg references with a jpg extension", () => {
		const body = buildAzureImageEditBody(
			"gpt-image-2",
			"p",
			"low",
			[{ data: png, mimeType: "image/jpeg" }],
			"B"
		);
		const text = Buffer.from(body).toString("latin1");
		expect(text).toContain('filename="reference-0.jpg"');
		expect(text).toContain("Content-Type: image/jpeg");
	});
});

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
