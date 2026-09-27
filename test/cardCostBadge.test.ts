import { describe, it, expect } from "vitest";
import { buildIndicatorText } from "../src/utils";

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
});
