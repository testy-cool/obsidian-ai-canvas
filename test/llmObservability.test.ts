import { afterEach, describe, expect, it, vi } from "vitest";
import { getResponse, streamResponse } from "../src/utils/llm";
import * as ai from "../src/utils/ai";
import { configureLLMObservability } from "../src/utils/llmObservability";
import { ObservabilityClient } from "../src/utils/observability";
import type { LLMProvider } from "../src/settings/AugmentedCanvasSettings";

vi.mock("../src/utils/ai", () => ({ getResponse: vi.fn(), streamResponse: vi.fn() }));

const provider = { id: "test", type: "Test provider", apiKey: "private-key" } as LLMProvider;
const messages = [{ role: "user" as const, content: "Test prompt" }];
const completion = { inputTokens: 5, outputTokens: 10, totalText: "Test answer" };
let client: ObservabilityClient;

function setup() {
	client = new ObservabilityClient({ enabled: true, provider: "langfuse", host: "", publicKey: "", secretKey: "" });
	const track = vi.spyOn(client, "track").mockImplementation(() => {});
	configureLLMObservability(client, () => ({ pluginVersion: "test", canvasName: "test.canvas", inputCostPerMillion: 2, outputCostPerMillion: 4 }));
	return track;
}

afterEach(async () => {
	configureLLMObservability(null);
	await client?.shutdown();
	vi.resetAllMocks();
});

describe("text request tracing", () => {
	it("traces the shared streaming path and preserves completion callbacks", async () => {
		const track = setup();
		const onComplete = vi.fn();
		vi.mocked(ai.streamResponse).mockImplementation(async (_provider, _messages, options) => { options?.onComplete?.(completion); });
		await streamResponse(provider, messages, { model: "test-model", onComplete }, vi.fn());
		expect(onComplete).toHaveBeenCalledWith(completion);
		expect(track).toHaveBeenCalledOnce();
		expect(track.mock.calls[0][0]).toMatchObject({
			model: "test-model", provider: "Test provider", input: JSON.stringify(messages), output: "Test answer",
			tokens: { input: 5, output: 10, total: 15 }, cost: { total: 0.00005 }, status: "success",
			metadata: { pluginVersion: "test", canvasName: "test.canvas" },
		});
		expect(JSON.stringify(track.mock.calls)).not.toContain("private-key");
	});

	it("traces non-streaming requests without changing their return value", async () => {
		const track = setup();
		vi.mocked(ai.getResponse).mockImplementation(async (_provider, _messages, options) => {
			options?.onComplete?.(completion);
			return { answer: "Test answer" };
		});
		await expect(getResponse(provider, messages, { model: "test-model", isJSON: true })).resolves.toEqual({ answer: "Test answer" });
		expect(track).toHaveBeenCalledOnce();
		expect(track.mock.calls[0][0].output).toBe("Test answer");
	});

	it("records errors raised before completion and rethrows the original error", async () => {
		const track = setup();
		const error = new Error("Provider unavailable");
		vi.mocked(ai.streamResponse).mockRejectedValue(error);
		await expect(streamResponse(provider, messages, { model: "test-model" }, vi.fn())).rejects.toBe(error);
		expect(track).toHaveBeenCalledOnce();
		expect(track.mock.calls[0][0]).toMatchObject({ status: "error", error: "Provider unavailable" });
	});

	it("does not interrupt a response if trace creation fails", async () => {
		const track = setup().mockImplementation(() => { throw new Error("Tracing failed"); });
		vi.mocked(ai.getResponse).mockResolvedValue("Answer");
		await expect(getResponse(provider, messages)).resolves.toBe("Answer");
		expect(track).toHaveBeenCalledOnce();
	});

	it("does not collect traces when disabled", async () => {
		const track = setup();
		vi.spyOn(client, "enabled", "get").mockReturnValue(false);
		vi.mocked(ai.getResponse).mockResolvedValue("Answer");
		await getResponse(provider, messages);
		expect(track).not.toHaveBeenCalled();
	});
});
