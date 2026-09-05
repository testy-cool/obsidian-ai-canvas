import { afterEach, describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "../src/settings/AugmentedCanvasSettings";
import { buildTools, getResponse, streamResponse } from "../src/utils/ai";

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
