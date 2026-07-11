import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock only the three "ai" package exports ai.ts actually imports.
// createGoogleGenerativeAI()/generateText's model argument construction is
// lazy and never hits the network, so nothing else needs mocking here.
vi.mock("ai", () => ({
	generateText: vi.fn(),
	streamText: vi.fn(),
	stepCountIs: vi.fn(),
}));

import { generateText } from "ai";
import { getResponse } from "../src/utils/ai";
import type { LLMProvider } from "../src/settings/AugmentedCanvasSettings";

const mockedGenerateText = generateText as unknown as ReturnType<typeof vi.fn>;

describe("getResponse flex fallback (native Gemini provider)", () => {
	beforeEach(() => {
		mockedGenerateText.mockReset();
	});

	it("falls back to standard tier when both the featured and bare flex attempts fail", async () => {
		const provider: LLMProvider = {
			id: "gemini",
			type: "Gemini",
			apiKey: "test-key",
			baseUrl: "",
			enabled: true,
		};

		// gemini-3-flash-preview supports url_context (canUseUrlContext=true),
		// so the pre-fix code path retried once with runGenerate(false, false)
		// bare and never considered flexFallback if that retry also failed.
		mockedGenerateText
			.mockRejectedValueOnce(new Error("flex attempt with features failed"))
			.mockRejectedValueOnce(new Error("flex attempt without features failed"))
			.mockResolvedValueOnce({
				text: "fallback text",
				usage: { inputTokens: 1, outputTokens: 2 },
			});

		const result = await getResponse(
			provider,
			[{ role: "user", content: "hi" }] as any,
			{
				model: "gemini-3-flash-preview",
				providerParams: { serviceTier: "flex", flexFallback: true },
			}
		);

		expect(result).toBe("fallback text");
		expect(mockedGenerateText).toHaveBeenCalledTimes(3);
	});
});
