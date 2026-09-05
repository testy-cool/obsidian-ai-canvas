import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type LLMProvider } from "../src/settings/AugmentedCanvasSettings";
import { buildTools, createScopedGeminiFetch, getBifrostGeminiBaseUrl, getResponse, streamResponse } from "../src/utils/ai";
import { probeProviderCapabilities } from "../src/utils/capabilityProbe";
import * as debug from "../src/logDebug";

const originalFetch = globalThis.fetch;

const chatCompletionBody = {
	id: "chatcmpl-test",
	object: "chat.completion",
	created: 0,
	model: "test-model",
	choices: [
		{
			index: 0,
			message: { role: "assistant", content: "ok" },
			finish_reason: "stop",
		},
	],
	usage: {
		prompt_tokens: 1,
		completion_tokens: 1,
		total_tokens: 2,
	},
};

const installFetchStub = () => {
	const requests: Request[] = [];
	globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		requests.push(new Request(input, init));
		return new Response(JSON.stringify(chatCompletionBody), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	});
	return requests;
};

const installErrorFetchStub = () => {
	globalThis.fetch = vi.fn(async () =>
		new Response(
			JSON.stringify({
				error: {
					message: "Provider 'gemini' is not allowed for this virtual key",
				},
			}),
			{
				status: 403,
				headers: { "Content-Type": "application/json" },
			}
		)
	);
};

const makeProvider = (overrides: Partial<LLMProvider> = {}): LLMProvider => ({
	id: "bifrost",
	type: "bifrost",
	baseUrl: "https://example.test/v1",
	apiKey: "test-api-key",
	enabled: true,
	...overrides,
});

const generate = async (
	provider: LLMProvider,
	providerParams?: Record<string, unknown>
) => {
	await getResponse(
		provider,
		[{ role: "user", content: "hello" }] as any,
		{ model: "test-model", providerParams }
	);
};

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

describe("OpenAI-compatible request wiring", () => {
	it("sends custom providers to chat completions with bearer authorization", async () => {
		const requests = installFetchStub();

		await generate(makeProvider());

		expect(requests).toHaveLength(1);
		expect(requests[0].method).toBe("POST");
		expect(requests[0].url).toBe("https://example.test/v1/chat/completions");
		expect(requests[0].url).not.toContain("/responses");
		expect(requests[0].headers.get("authorization")).toBe("Bearer test-api-key");
	});

	it.each([
		{
			name: "flex service tier",
			params: { serviceTier: "flex" },
			expected: { service_tier: "flex" },
		},
		{
			name: "reasoning effort",
			params: { reasoningEffort: "high" },
			expected: { reasoning_effort: "high" },
		},
	])("injects $name into the chat body", async ({ params, expected }) => {
		const requests = installFetchStub();

		await generate(makeProvider(), params);

		const body = await requests[0].json();
		expect(body).toMatchObject(expected);
	});

	it.each([
		{ name: "standard service tier", params: { serviceTier: "standard" } },
		{ name: "no provider params", params: undefined },
	])("does not inject provider fields for $name", async ({ params }) => {
		const requests = installFetchStub();

		await generate(makeProvider(), params);

		const body = await requests[0].json();
		expect(body).not.toHaveProperty("service_tier");
		expect(body).not.toHaveProperty("reasoning_effort");
	});

	it("uses Azure's OpenAI chat path and api-key header", async () => {
		const requests = installFetchStub();
		const provider = makeProvider({
			id: "azure",
			type: "Azure",
			baseUrl: "https://azure.example.test",
			apiKey: "azure-test-key",
		});

		await generate(provider);

		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe(
			"https://azure.example.test/openai/v1/chat/completions"
		);
		expect(requests[0].headers.get("api-key")).toBe("azure-test-key");
	});
});

describe("provider HTTP errors", () => {
	it("surfaces the gateway message from non-streaming calls", async () => {
		installErrorFetchStub();
		const onComplete = vi.fn();
		const expected =
			"HTTP 403: Provider 'gemini' is not allowed for this virtual key";

		await expect(
			getResponse(
				makeProvider(),
				[{ role: "user", content: "hello" }] as any,
				{ model: "test-model", onComplete }
			)
		).rejects.toThrow(expected);
		expect(onComplete).toHaveBeenCalledWith(
			expect.objectContaining({ error: expected })
		);
	});

	it("surfaces the gateway message from streaming calls", async () => {
		installErrorFetchStub();
		const onComplete = vi.fn();
		const expected =
			"HTTP 403: Provider 'gemini' is not allowed for this virtual key";

		await expect(
			streamResponse(
				makeProvider(),
				[{ role: "user", content: "hello" }] as any,
				{ model: "test-model", onComplete },
				vi.fn()
			)
		).rejects.toThrow(expected);
		expect(onComplete).toHaveBeenCalledWith(
			expect.objectContaining({ error: expected })
		);
	});
});

describe("Google provider tools", () => {
	it.each(["Gemini", "Google", "Vertex"])("enables search and URL context for %s without MCP tools", (type) => {
		const tools = buildTools(makeProvider({ type }), "gemini-3-flash-preview");
		expect(tools).toMatchObject({
			google_search: { id: "google.google_search" },
			url_context: { id: "google.url_context" },
		});
	});

	it("does not send Google tools through Bifrost, even for a Gemini model", () => {
		expect(buildTools(makeProvider(), "gemini-3-flash-preview")).toBeUndefined();
	});

	it("keeps MCP tools without mixing in either Google built-in tool", () => {
		const mcpTools = { lookup: { description: "Test function tool" } };
		expect(buildTools(makeProvider({ type: "Gemini" }), "gemini-3-flash-preview", mcpTools)).toEqual(mcpTools);
	});

	it.each(["gemini-2.5-flash", "gemini-3-flash-preview", "models/gemini-3.1-pro-preview"])("uses the same search and URL context gate for %s", (model) => {
		expect(Object.keys(buildTools(makeProvider({ type: "Gemini" }), model)!)).toEqual(["google_search", "url_context"]);
	});

	it("omits both built-in tools for older models and for the fallback", () => {
		const provider = makeProvider({ type: "Gemini" });
		expect(buildTools(provider, "gemini-2.0-flash")).toBeUndefined();
		expect(buildTools(provider, "gemini-3-flash-preview", undefined, {
			useSearchGrounding: false, useUrlContext: false,
		})).toBeUndefined();
	});

	const googleResponse = {
		candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }],
		usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
	};

	it("serializes both tools through the real SDK for streaming requests", async () => {
		const requests: Request[] = [];
		globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			requests.push(new Request(input, init));
			return new Response(`data: ${JSON.stringify(googleResponse)}\n\n`, {
				headers: { "Content-Type": "text/event-stream" },
			});
		});
		const callback = vi.fn();
		await streamResponse(makeProvider({ type: "Gemini" }), [{ role: "user", content: "hello" }], { model: "gemini-3-flash-preview" }, callback);
		expect(requests).toHaveLength(1);
		expect((await requests[0].json()).tools).toEqual([{ googleSearch: {} }, { urlContext: {} }]);
		expect(callback).toHaveBeenCalledWith("ok", null, null, null);
	});

	it("retries non-streaming requests without either tool when Google rejects them", async () => {
		const requests: Request[] = [];
		globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			requests.push(new Request(input, init));
			return new Response(JSON.stringify(requests.length === 1
				? { error: { message: "Unsupported tools", code: 400 } }
				: googleResponse), {
				status: requests.length === 1 ? 400 : 200,
				headers: { "Content-Type": "application/json" },
			});
		});
		expect(await getResponse(makeProvider({ type: "Gemini" }), [{ role: "user", content: "hello" }], { model: "gemini-3-flash-preview" })).toBe("ok");
		expect(requests).toHaveLength(2);
		expect((await requests[0].json()).tools).toEqual([{ googleSearch: {} }, { urlContext: {} }]);
		expect((await requests[1].json()).tools).toBeUndefined();
	});
});

describe("OpenAI-compatible media serialization", () => {
	it("sends images and PDFs through Bifrost chat completions", async () => {
		const requests = installFetchStub();
		await getResponse(makeProvider(), [{
			role: "user",
			content: [
				{ type: "image", image: new Uint8Array([1, 2, 3, 4]), mediaType: "image/png" },
				{ type: "file", data: "AQIDBA==", mediaType: "application/pdf", filename: "attachment.pdf" },
			],
		}], { model: "test-model" });
		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe("https://example.test/v1/chat/completions");
		expect((await requests[0].json()).messages[0].content).toEqual([
			{ type: "image_url", image_url: { url: "data:image/png;base64,AQIDBA==" } },
			{ type: "file", file: { filename: "attachment.pdf", file_data: "data:application/pdf;base64,AQIDBA==" } },
		]);
	});
});

describe("Bifrost Gemini-native requests", () => {
	it.each([
		"https://bifrost.voidxd.cloud/v1",
		"https://bifrost.voidxd.cloud/v1/",
		"https://bifrost.voidxd.cloud/",
		"https://bifrost.voidxd.cloud",
	])("derives the native base URL from %s", (baseUrl) => {
		expect(getBifrostGeminiBaseUrl(baseUrl)).toBe("https://bifrost.voidxd.cloud/genai/v1beta");
	});

	it("enables both Google tools for an unchanged Vertex-prefixed model ID", () => {
		const provider = makeProvider({ type: "Bifrost", geminiNative: true });
		expect(buildTools(provider, "vertex/gemini-3.1-pro-preview")).toMatchObject({
			google_search: { id: "google.google_search" },
			url_context: { id: "google.url_context" },
		});
		const mcpTools = { lookup: { description: "Test function" } };
		expect(buildTools(provider, "vertex/gemini-3.1-pro-preview", mcpTools)).toEqual(mcpTools);
	});

	it("keeps the OpenAI-compatible route when the flag is false", async () => {
		const provider = makeProvider({ type: "Bifrost", geminiNative: false });
		expect(buildTools(provider, "vertex/gemini-3.1-pro-preview")).toBeUndefined();
		const requests = installFetchStub();
		await getResponse(provider, [{ role: "user", content: "hello" }], { model: "vertex/gemini-3.1-pro-preview" });
		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe("https://example.test/v1/chat/completions");
		expect((await requests[0].json()).model).toBe("vertex/gemini-3.1-pro-preview");
	});

	it.each([false, true])("sends the native URL, auth, Google tools and YouTube URI through the real SDK (streaming: %s)", async (streaming) => {
		const requests: Request[] = [];
		globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			requests.push(new Request(input, init));
			const response = {
				candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }],
				usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
			};
			return new Response(streaming ? `data: ${JSON.stringify(response)}\n\n` : JSON.stringify(response), {
				headers: { "Content-Type": streaming ? "text/event-stream" : "application/json" },
			});
		});
		const provider = makeProvider({ type: "Bifrost", geminiNative: true });
		const messages: any = [{ role: "user", content: [
			{ type: "text", text: "Summarize this video" },
			{ type: "file", data: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", mediaType: "video/mp4" },
		] }];
		const options = { model: "vertex/gemini-3.1-pro-preview", providerParams: { serviceTier: "priority" } };
		if (streaming) {
			const callback = vi.fn();
			await streamResponse(provider, messages, options, callback);
			expect(callback).toHaveBeenCalledWith("ok", null, null, null);
		} else {
			expect(await getResponse(provider, messages, options)).toBe("ok");
		}
		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe(`https://example.test/genai/v1beta/models/vertex/gemini-3.1-pro-preview:${streaming ? "streamGenerateContent?alt=sse" : "generateContent"}`);
		expect(requests[0].headers.get("authorization")).toBe("Bearer test-api-key");
		expect(requests[0].headers.get("x-goog-api-key")).toBe("test-api-key");
		const body = await requests[0].json();
		expect(body.tools).toEqual([{ googleSearch: {} }, { urlContext: {} }]);
		expect(body.contents[0].parts).toContainEqual({ fileData: {
			fileUri: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		} });
		expect(body.generationConfig.service_tier).toBe("priority");
	});
});

describe("capability probe production routing", () => {
	it("probes native Bifrost through the real SDK and reads grounding metadata and sources", async () => {
		const requests: any[] = [];
		globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = new Request(input, init);
			expect(request.url).toBe("https://example.test/genai/v1beta/models/vertex/gemini-3.1-pro-preview:generateContent");
			const body = await request.json();
			requests.push(body);
			const text = ["red", "7431", "A man at the zoo with elephants.", `${new Date().getFullYear()} news`, "Example Domain"][requests.length - 1];
			return new Response(JSON.stringify({ candidates: [{
				content: { role: "model", parts: [{ text }] }, finishReason: "STOP",
				...(body.tools?.[0]?.googleSearch ? { groundingMetadata: {
					groundingChunks: [{ web: { uri: "https://example.test/news", title: "Today's news" } }],
					webSearchQueries: ["today news"],
				} } : {}),
			}] }), { headers: { "Content-Type": "application/json" } });
		});
		const provider = makeProvider({ type: "Bifrost", geminiNative: true, capabilityReport: {
			image: "no", pdf: "no", video: "untested", youtube: "no", search: "no", urlContext: "no",
		} });
		const report = await probeProviderCapabilities(provider, "vertex/gemini-3.1-pro-preview", { ...DEFAULT_SETTINGS, models: [] });
		expect(report).toMatchObject({ image: "yes", pdf: "yes", video: "untested", youtube: "yes", search: "yes", urlContext: "yes" });
		expect(requests).toHaveLength(5);
		expect(requests.slice(0, 3).every(body => body.tools === undefined)).toBe(true);
		expect(requests[0].contents[0].parts).toContainEqual(expect.objectContaining({ inlineData: expect.objectContaining({ mimeType: "image/png" }) }));
		expect(requests[1].contents[0].parts).toContainEqual(expect.objectContaining({ inlineData: expect.objectContaining({ mimeType: "application/pdf" }) }));
		expect(requests[2].contents[0].parts).toContainEqual({ fileData: { fileUri: "https://www.youtube.com/watch?v=jNQXAC9IVRw" } });
		expect(requests[3].tools).toEqual([{ googleSearch: {} }]);
		expect(requests[4].tools).toEqual([{ urlContext: {} }]);
	});

	it.each([false, true])("omits Google tools disabled by a saved report (streaming: %s)", async (streaming) => {
		const requests: any[] = [];
		globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			requests.push(await new Request(input, init).json());
			const response = { candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }] };
			return new Response(streaming ? `data: ${JSON.stringify(response)}\n\n` : JSON.stringify(response), {
				headers: { "Content-Type": streaming ? "text/event-stream" : "application/json" },
			});
		});
		const provider = makeProvider({ type: "Bifrost", geminiNative: true, capabilityReport: {
			image: "yes", pdf: "yes", video: "untested", youtube: "yes", search: "no", urlContext: "no",
		} });
		const messages = [{ role: "user" as const, content: "hello" }];
		const options = { model: "vertex/gemini-3.1-pro-preview" };
		if (streaming) await streamResponse(provider, messages, options, vi.fn());
		else expect(await getResponse(provider, messages, options)).toBe("ok");
		expect(requests).toHaveLength(1);
		expect(requests[0].tools).toBeUndefined();
	});
});

describe("YouTube MIME hints on Google routes", () => {
	it.each([
		{ route: "Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta" },
		{ route: "Vertex", baseURL: "https://us-central1-aiplatform.googleapis.com/v1/projects/test/locations/us-central1/publishers/google" },
		{ route: "native Bifrost", baseURL: "https://example.test/genai/v1beta" },
	])("strips only YouTube fileData MIME hints on $route and logs once per request", async ({ route, baseURL }) => {
		const requests = installFetchStub();
		const log = vi.spyOn(debug, "logDebug");
		const youtubeUrls = [
			"https://www.youtube.com/watch?v=jNQXAC9IVRw",
			"https://youtube.com/shorts/jNQXAC9IVRw",
			"https://youtu.be/jNQXAC9IVRw",
			"https://m.youtube.com/watch?v=jNQXAC9IVRw",
		];
		const unchangedParts = [
			{ inlineData: { data: "AQIDBA==", mimeType: "image/png" } },
			{ fileData: { fileUri: "https://example.test/video.mp4", mimeType: "video/mp4" } },
			{ fileData: { fileUri: "https://www.youtube.com.evil.test/watch?v=test", mimeType: "video/mp4" } },
			{ fileData: { fileUri: "https://youtube.com/watchlist", mimeType: "video/mp4" } },
			{ fileData: { fileUri: youtubeUrls[0] } },
			{ text: "Describe this media." },
		];
		const contents = [
			{ role: "user", parts: youtubeUrls.slice(0, 2).map(fileUri => ({ fileData: { fileUri, mimeType: "video/mp4" } })) },
			{ role: "user", parts: [...youtubeUrls.slice(2).map(fileUri => ({ fileData: { fileUri, mimeType: "video/mp4" } })), ...unchangedParts] },
		];
		const body = { contents, generationConfig: { temperature: 0.2 } };
		const native = route === "native Bifrost";
		const scopedFetch = createScopedGeminiFetch(undefined, native ? baseURL : undefined);
		await scopedFetch(`${baseURL}/${native ? "vertex" : "models"}/gemini-3.1-pro-preview:streamGenerateContent?alt=sse`, {
			method: "POST", body: JSON.stringify(body),
		});
		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe(`${baseURL}/models/${native ? "vertex/" : ""}gemini-3.1-pro-preview:streamGenerateContent?alt=sse`);
		expect(await requests[0].json()).toEqual({
			contents: [
				{ role: "user", parts: youtubeUrls.slice(0, 2).map(fileUri => ({ fileData: { fileUri } })) },
				{ role: "user", parts: [...youtubeUrls.slice(2).map(fileUri => ({ fileData: { fileUri } })), ...unchangedParts] },
			],
			generationConfig: body.generationConfig,
		});
		expect(log).toHaveBeenCalledExactlyOnceWith("[AI] Removed MIME hints from YouTube fileData parts");

		log.mockClear();
		const unchangedBody = JSON.stringify({ contents: [{ role: "user", parts: unchangedParts }] });
		await scopedFetch(requests[0].url, { method: "POST", body: unchangedBody });
		expect(await requests[1].text()).toBe(unchangedBody);
		expect(log).not.toHaveBeenCalled();
	});
});
