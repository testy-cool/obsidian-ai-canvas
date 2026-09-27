import { afterEach, describe, expect, it, vi } from "vitest";
import { configureLLMObservability, observeImage } from "../src/utils/llmObservability";
import { ObservabilityClient } from "../src/utils/observability";
import type { LLMProvider } from "../src/settings/AugmentedCanvasSettings";

const provider = { id: "azure", type: "Azure", apiKey: "private-key" } as LLMProvider;
let client: ObservabilityClient;

function setup() {
	client = new ObservabilityClient({ enabled: true, provider: "langfuse", host: "", publicKey: "", secretKey: "" });
	configureLLMObservability(client, () => ({ pluginVersion: "test", canvasName: "board.canvas" }));
	return vi.spyOn(client, "track").mockImplementation(() => {});
}

afterEach(async () => {
	configureLLMObservability(null);
	await client?.shutdown();
	vi.restoreAllMocks();
});

describe("image generation tracing", () => {
	it("traces one image run with its prompt and model", async () => {
		const track = setup();
		const output = { image: { base64: "AAAA", mimeType: "image/png" }, raw: "{}" };
		const result = await observeImage({ provider, model: "gpt-image-2", prompt: "a red bicycle" }, async () => output);
		expect(result).toBe(output);
		expect(track).toHaveBeenCalledOnce();
		expect(track.mock.calls[0][0]).toMatchObject({
			name: "AI Canvas image",
			model: "gpt-image-2",
			provider: "Azure",
			input: "a red bicycle",
			output: "image/png",
			status: "success",
			metadata: { canvasName: "board.canvas" },
		});
		expect(JSON.stringify(track.mock.calls)).not.toContain("private-key");
	});

	it("records why an image failed and still raises it", async () => {
		const track = setup();
		await expect(observeImage({ provider, model: "gpt-image-2", prompt: "x" }, async () => {
			throw new Error("content filter blocked the prompt");
		})).rejects.toThrow("content filter blocked the prompt");
		expect(track.mock.calls[0][0]).toMatchObject({ status: "error", error: "content filter blocked the prompt" });
	});

	it("says so when a provider returned no image", async () => {
		const track = setup();
		await observeImage({ provider, model: "gpt-image-2", prompt: "x" }, async () => ({ image: undefined, raw: "{}" }));
		expect(track.mock.calls[0][0]).toMatchObject({ output: "no image returned" });
	});

	it("returns the image even when tracing itself breaks", async () => {
		setup();
		vi.spyOn(client, "track").mockImplementation(() => { throw new Error("queue is broken"); });
		const output = { image: { base64: "AAAA", mimeType: "image/png" }, raw: "{}" };
		await expect(observeImage({ provider, model: "m", prompt: "x" }, async () => output)).resolves.toBe(output);
	});

	it("does nothing when tracing is not configured", async () => {
		configureLLMObservability(null);
		const output = { image: { base64: "A", mimeType: "image/png" }, raw: "{}" };
		await expect(observeImage({ provider, model: "m", prompt: "x" }, async () => output)).resolves.toBe(output);
	});
});
