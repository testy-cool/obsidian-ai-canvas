import { afterEach, describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "../src/settings/AugmentedCanvasSettings";
import { getResponse } from "../src/utils/ai";

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
