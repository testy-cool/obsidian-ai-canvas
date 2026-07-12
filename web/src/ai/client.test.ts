import { describe, expect, it, vi } from "vitest";
import { buildImageRequest, buildTextRequest, requestAiImage, requestAiText } from "./client";
import type { BrowserAiSettings } from "./settings";

const openAi: BrowserAiSettings = {
	protocol: "openai-compatible",
	baseUrl: "https://provider.example/v1/",
	apiKey: "secret",
	model: "provider-model-id",
	imageModel: "provider-image-id",
	systemPrompt: "Be precise.",
	temperature: 0.4,
};

describe("browser AI client", () => {
	it("builds an OpenAI-compatible chat request without AI SDK model wrapping", () => {
		expect(buildTextRequest(openAi, "Canvas context")).toEqual({
			url: "https://provider.example/v1/chat/completions",
			init: {
				method: "POST",
				headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
				body: JSON.stringify({
					model: "provider-model-id",
					messages: [
						{ role: "system", content: "Be precise." },
						{ role: "user", content: "Canvas context" },
					],
					temperature: 0.4,
					stream: false,
				}),
			},
		});
	});

	it("builds a native Gemini generateContent request", () => {
		const request = buildTextRequest({
			...openAi,
			protocol: "gemini",
			baseUrl: "https://generativelanguage.googleapis.com/v1beta",
			model: "models/gemini-current-id",
		}, "Canvas context");
		expect(request.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-current-id:generateContent?key=secret");
		expect(JSON.parse(String(request.init.body))).toMatchObject({
			systemInstruction: { parts: [{ text: "Be precise." }] },
			contents: [{ role: "user", parts: [{ text: "Canvas context" }] }],
		});
	});

	it("extracts text from a successful compatible response", async () => {
		const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
			choices: [{ message: { content: "Generated answer" } }],
		}), { status: 200, headers: { "Content-Type": "application/json" } }));
		await expect(requestAiText(openAi, "Prompt", fetcher)).resolves.toBe("Generated answer");
	});

	it("surfaces provider error messages", async () => {
		const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
			error: { message: "Unsupported model" },
		}), { status: 400, headers: { "Content-Type": "application/json" } }));
		await expect(requestAiText(openAi, "Prompt", fetcher)).rejects.toThrow("Unsupported model");
	});

	it("builds an OpenAI-compatible image request with the configured image model", () => {
		const request = buildImageRequest(openAi, "Exact image prompt");
		expect(request.url).toBe("https://provider.example/v1/images/generations");
		expect(JSON.parse(String(request.init.body))).toEqual({
			model: "provider-image-id",
			prompt: "Exact image prompt",
			size: "1536x1024",
		});
	});

	it("extracts base64 images from compatible and Gemini responses", async () => {
		const compatibleFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: "aW1hZ2U=" }] }), { status: 200 }));
		await expect(requestAiImage(openAi, "Prompt", compatibleFetch)).resolves.toEqual({
			src: "data:image/png;base64,aW1hZ2U=",
			mimeType: "image/png",
		});

		const geminiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
			candidates: [{ content: { parts: [{ inlineData: { data: "d2VicA==", mimeType: "image/webp" } }] } }],
		}), { status: 200 }));
		await expect(requestAiImage({ ...openAi, protocol: "gemini" }, "Prompt", geminiFetch)).resolves.toEqual({
			src: "data:image/webp;base64,d2VicA==",
			mimeType: "image/webp",
		});
	});
});
