import { describe, it, expect } from "vitest";
import { buildVertexImageUrl } from "../src/utils/llm";

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
