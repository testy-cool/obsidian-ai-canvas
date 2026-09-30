import { describe, it, expect } from "vitest";
import { buildIndicatorText, buildUsageDetail } from "../src/utils";

describe("the card badge", () => {
	it("shows provider and model when nothing was costed", () => {
		expect(buildIndicatorText({ provider: "Bifrost", model: "gemini-3.1-flash-lite" }))
			.toEqual({ label: "Bifrost • gemini-3.1-flash-lite", sizing: "Bifrost • gemini-3.1-flash-lite" });
	});

	it("adds what the card cost", () => {
		expect(buildIndicatorText({ provider: "Bifrost", model: "flash", cost: 0.0004 }).label)
			.toBe("Bifrost • flash • $0.0004");
	});

	it("leads with the number of cards used as context", () => {
		expect(buildIndicatorText({ provider: "Bifrost", model: "flash", contextCount: 3 }).label)
			.toBe("3 cards • Bifrost • flash");
		expect(buildIndicatorText({ provider: "Bifrost", model: "flash", contextCount: 1 }).label)
			.toBe("1 card • Bifrost • flash");
	});

	it("reserves the finished width while generating, so the card does not shift", () => {
		const text = buildIndicatorText({ provider: "Bifrost", model: "flash", cost: 0.0004, generating: true });
		expect(text.label).toBe("generating");
		expect(text.sizing).toBe("Bifrost • flash • $0.0004");
	});

	it("leaves out a cost of zero rather than claiming a card was free", () => {
		expect(buildIndicatorText({ provider: "Bifrost", model: "flash", cost: undefined }).label)
			.toBe("Bifrost • flash");
	});

	it("says how much of the prompt came from the cache when some did", () => {
		expect(buildIndicatorText({
			provider: "Bifrost", model: "flash", cost: 0.0004,
			usage: { inputTokens: 1842, outputTokens: 96, cachedInputTokens: 1440 },
		}).label).toBe("Bifrost • flash • $0.0004 • cache 78%");
	});

	it("stays quiet when nothing was cached, which is the usual case", () => {
		expect(buildIndicatorText({
			provider: "Bifrost", model: "flash",
			usage: { inputTokens: 1842, outputTokens: 96, cachedInputTokens: 0 },
		}).label).toBe("Bifrost • flash");
		expect(buildIndicatorText({
			provider: "Bifrost", model: "flash",
			usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
		}).label).toBe("Bifrost • flash");
	});

	it("never claims more than all of the prompt was cached", () => {
		expect(buildIndicatorText({
			provider: "Bifrost", model: "flash",
			usage: { inputTokens: 100, outputTokens: 1, cachedInputTokens: 500 },
		}).label).toBe("Bifrost • flash • cache 100%");
	});
});

describe("the detail line shown on a selected card", () => {
	it("gives the token counts and how long the answer took", () => {
		expect(buildUsageDetail({ inputTokens: 1842, outputTokens: 96, cachedInputTokens: 1440 }, 6400))
			.toBe("1,842 in (1,440 cached) · 96 out · 6.4s");
	});

	it("leaves out the cached part when nothing was cached", () => {
		expect(buildUsageDetail({ inputTokens: 1842, outputTokens: 96, cachedInputTokens: 0 }, 6400))
			.toBe("1,842 in · 96 out · 6.4s");
	});

	it("writes long runs in minutes and seconds", () => {
		expect(buildUsageDetail({ inputTokens: 10, outputTokens: 5 }, 125_000)).toBe("10 in · 5 out · 2m 5s");
	});

	it("shows nothing for a run that reported no tokens", () => {
		expect(buildUsageDetail({ inputTokens: 0, outputTokens: 0 }, 3000)).toBe("");
		expect(buildUsageDetail(undefined, 3000)).toBe("");
	});

	it("drops the time when it was not recorded", () => {
		expect(buildUsageDetail({ inputTokens: 10, outputTokens: 5 })).toBe("10 in · 5 out");
	});
});
