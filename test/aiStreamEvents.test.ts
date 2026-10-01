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

describe("usage reporting", () => {
	it("reports the cached part of the prompt the provider served from its own cache", async () => {
		vi.mocked(streamText).mockReturnValue({
			fullStream: (async function* () { yield { type: "text-delta", text: "hi" }; })(),
			text: Promise.resolve("hi"),
			totalUsage: Promise.resolve({ inputTokens: 6036, outputTokens: 1, cachedInputTokens: 4071 }),
		} as any);
		const onComplete = vi.fn();
		await streamResponse(
			{ id: "custom", type: "Custom", apiKey: "test", enabled: true },
			[{ role: "user", content: "hello" }],
			{ model: "test-model", onComplete }, vi.fn(),
		);
		expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 6036, cachedInputTokens: 4071 }));
	});
});

describe("timeout is a limit on silence", () => {
	const provider = { id: "custom", type: "Custom", apiKey: "test", enabled: true } as const;
	const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

	// A stream that waits `gapMs` before each part and, like the SDK, ends with
	// an 'abort' part when the request signal fires while it waits.
	const mockSlowStream = (gaps: number[]) => {
		vi.mocked(streamText).mockImplementation(((config: any) => {
			const signal: AbortSignal = config.abortSignal;
			const aborted = new Promise<"aborted">((resolve) => signal.addEventListener("abort", () => resolve("aborted")));
			return {
				fullStream: (async function* () {
					for (const [index, gap] of gaps.entries()) {
						if (await Promise.race([sleep(gap).then(() => "ok" as const), aborted]) === "aborted") {
							yield { type: "abort" };
							return;
						}
						yield { type: "text-delta", text: `part${index} ` };
					}
				})(),
				text: Promise.resolve(gaps.map((_, index) => `part${index} `).join("")),
			} as any;
		}) as any);
	};

	it("lets a stream that keeps producing run past the limit", async () => {
		vi.useFakeTimers();
		try {
			mockSlowStream([30_000, 30_000, 30_000, 30_000, 30_000]);
			const callback = vi.fn();
			const run = streamResponse(provider, [{ role: "user", content: "hello" }], { model: "test-model" }, callback);
			await vi.advanceTimersByTimeAsync(150_000);
			await run;
			const text = callback.mock.calls.map((call) => call[0]).filter(Boolean).join("");
			expect(text).toBe("part0 part1 part2 part3 part4 ");
		} finally {
			vi.useRealTimers();
		}
	});

	it("aborts a stream that goes silent for longer than the limit", async () => {
		vi.useFakeTimers();
		try {
			mockSlowStream([10_000, 70_000]);
			const callback = vi.fn();
			const run = streamResponse(provider, [{ role: "user", content: "hello" }], { model: "test-model" }, callback);
			const outcome = expect(run).rejects.toThrow("Generation timed out");
			await vi.advanceTimersByTimeAsync(80_000);
			await outcome;
			expect(callback).toHaveBeenCalledWith("part0 ", null, null, null);
		} finally {
			vi.useRealTimers();
		}
	});

	it("uses an explicit timeoutMs as the silence limit", async () => {
		vi.useFakeTimers();
		try {
			mockSlowStream([4_000, 4_000, 4_000, 20_000]);
			const callback = vi.fn();
			const run = streamResponse(provider, [{ role: "user", content: "hello" }], { model: "test-model", timeoutMs: 5_000 }, callback);
			const outcome = expect(run).rejects.toThrow("Generation timed out");
			await vi.advanceTimersByTimeAsync(40_000);
			await outcome;
			// 12 s of output went through, so the 5 s limit counts silence, not the total.
			expect(callback).toHaveBeenCalledWith("part2 ", null, null, null);
		} finally {
			vi.useRealTimers();
		}
	});
});
