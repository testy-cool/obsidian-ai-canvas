import { afterEach, describe, expect, it, vi } from "vitest";
import { streamText } from "ai";
import { streamResponse } from "../src/utils/ai";

vi.mock("ai", () => ({ streamText: vi.fn(), generateText: vi.fn(), stepCountIs: vi.fn() }));
afterEach(() => vi.clearAllMocks());

describe("stream tool events", () => {
	it.each([
		{ type: "tool-result", output: { isError: true, content: [] }, expected: { isError: true, content: [] }, failed: false },
		{ type: "tool-error", error: new Error("Lookup failed"), expected: "Lookup failed", failed: true },
	])("forwards SDK input and $type to the card callback", async ({ expected, failed, ...part }) => {
		vi.mocked(streamText).mockReturnValue({
			fullStream: (async function* () {
				yield { type: "tool-call", toolName: "lookup", toolCallId: "call", input: { q: "test" } };
				yield { ...part, toolName: "lookup", toolCallId: "call" };
			})(),
			text: Promise.resolve("answer"),
		} as any);
		const callback = vi.fn();
		await streamResponse(
			{ id: "custom", type: "Custom", apiKey: "test", enabled: true },
			[{ role: "user", content: "hello" }],
			{ model: "test-model" }, callback,
		);
		expect(callback).toHaveBeenCalledWith(null, null, {
			type: "tool-call", toolName: "lookup", toolCallId: "call", args: { q: "test" },
		}, null);
		expect(callback).toHaveBeenCalledWith(null, null, {
			type: "tool-result", toolName: "lookup", toolCallId: "call", result: expected, isError: failed,
		}, null);
	});
});
