import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inflateSync } from "node:zlib";
import { probeProviderCapabilities } from "../src/utils/capabilityProbe";
import { getResponse } from "../src/utils/llm";
import { DEFAULT_SETTINGS, type LLMProvider } from "../src/settings/AugmentedCanvasSettings";
import { providerCapabilityKeys, type ProviderCapabilityReport } from "../src/utils/providerCapabilities";

vi.mock("../src/utils/llm", () => ({ getResponse: vi.fn() }));

const provider: LLMProvider = {
	id: "test", type: "Bifrost", geminiNative: true, baseUrl: "https://example.test/v1", apiKey: "test", enabled: true,
};
const model = { id: "selected", providerId: provider.id, model: "vertex/gemini-3.1-pro-preview", enabled: true, providerParams: { serviceTier: "priority" } };
const settings = { ...DEFAULT_SETTINGS, models: [model], temperature: 0.2, maxResponseTokens: 100 };
const answers = () => [
	{ text: "RED" },
	{ text: "7431" },
	{ text: "A man stands in front of elephants at a zoo." },
	{ text: "2026: A headline from today.", sources: [{ type: "source", url: "https://example.test/news" }] },
	{ text: "Example Domain" },
];
const installAnswers = (responses = answers()) => {
	for (const response of responses) vi.mocked(getResponse).mockResolvedValueOnce(response);
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
	vi.mocked(getResponse).mockReset();
});
afterEach(() => { vi.useRealTimers(); });

describe("provider capability probes", () => {
	it("uses the production router sequentially with valid embedded media and isolated Google tools", async () => {
		installAnswers();
		const result = await probeProviderCapabilities(provider, model.model, settings);
		expect(result).toMatchObject({
			image: "yes", pdf: "yes", video: "untested", youtube: "yes", search: "yes", urlContext: "yes",
			testedAt: "2026-09-05T12:00:00.000Z", model: model.model,
		});
		expect(Object.keys(result.notes!)).toHaveLength(6);
		const calls = vi.mocked(getResponse).mock.calls;
		expect(calls).toHaveLength(5);
		for (const [index, call] of calls.entries()) {
			expect(call[2]).toMatchObject({
				model: model.model, timeoutMs: 30_000, includeMetadata: true,
				temperature: 0.2, max_tokens: 100, providerParams: model.providerParams,
				useSearchGrounding: index === 3, useUrlContext: index === 4,
			});
		}
		const content = (index: number) => calls[index][1][0].content as any[];
		const png = Buffer.from(content(0)[1].image, "base64");
		expect(png.subarray(1, 4).toString()).toBe("PNG");
		expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1, 1]);
		expect([...inflateSync(png.subarray(41, 41 + png.readUInt32BE(33))) ]).toEqual([0, 255, 0, 0]);
		const pdf = Buffer.from(content(1)[1].data, "base64").toString();
		expect(pdf).toMatch(/^%PDF-1.4/);
		expect(pdf).toContain("(CANVAS PROBE 7431)");
		expect(pdf.slice(Number(pdf.match(/startxref\n(\d+)/)![1]))).toMatch(/^xref/);
		expect(content(2)[1]).toEqual({ type: "file", data: "https://www.youtube.com/watch?v=jNQXAC9IVRw", mediaType: "video/mp4" });
		expect(vi.getTimerCount()).toBe(0);
	});

	it("records failed answer checks as no", async () => {
		installAnswers(Array(5).fill({ text: "No information." }));
		const result = await probeProviderCapabilities(provider, model.model, settings);
		for (const key of providerCapabilityKeys.filter(key => key !== "video")) {
			expect(result[key]).toBe("no");
			expect(result.notes![key]).toBeTruthy();
		}
	});

	it.each([
		"I cannot access the video of elephants at the zoo.",
		"I can't see YouTube videos, including Me at the zoo.",
		"I'm unable to view the zoo video.",
	])("rejects a YouTube refusal even if it repeats the expected subject: %s", async (text) => {
		const responses = answers();
		responses[2] = { text };
		installAnswers(responses);
		expect((await probeProviderCapabilities(provider, model.model, settings)).youtube).toBe("no");
	});

	it.each([
		{ text: "2026 news", sources: [{ url: "https://example.test" }], expected: "yes" },
		{ text: "2026 news", providerMetadata: { google: { groundingMetadata: { webSearchQueries: ["today"] } } }, expected: "yes" },
		{ text: "2026 news", providerMetadata: { google: { groundingMetadata: {} } }, sources: [], expected: "no" },
		{ text: "2026 news", expected: "no" },
		{ text: "2025 news", sources: [{ url: "https://example.test" }], expected: "no" },
	])("requires the current year and grounding evidence: $expected", async ({ expected, ...response }) => {
		const responses: any[] = answers();
		responses[3] = response;
		installAnswers(responses);
		expect((await probeProviderCapabilities(provider, model.model, settings)).search).toBe(expected);
	});

	it.each([new Error("Gateway rejected the input"), "Request failed"])("catches every failed check and continues: %s", async (error) => {
		vi.mocked(getResponse).mockRejectedValue(error);
		const result = await probeProviderCapabilities(provider, model.model, settings);
		expect(getResponse).toHaveBeenCalledTimes(5);
		for (const key of providerCapabilityKeys.filter(key => key !== "video")) {
			expect(result[key]).toBe("no");
			expect(result.notes![key]).toBe(error instanceof Error ? error.message : error);
		}
		expect(vi.getTimerCount()).toBe(0);
	});

	it("times out each check after 30 seconds and starts the next only after it settles", async () => {
		vi.mocked(getResponse).mockImplementation(() => new Promise(() => {}));
		const pending = probeProviderCapabilities(provider, model.model, settings);
		for (let index = 1; index <= 5; index++) {
			expect(getResponse).toHaveBeenCalledTimes(index);
			await vi.advanceTimersByTimeAsync(30_000);
		}
		const result = await pending;
		for (const key of providerCapabilityKeys.filter(key => key !== "video")) {
			expect(result[key]).toBe("no");
			expect(result.notes![key]).toBe("Timed out after 30 seconds.");
		}
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([
		{ type: "Bifrost", geminiNative: false, expected: "no" },
		{ type: "OpenAI", geminiNative: false, expected: "no" },
		{ type: "Azure", geminiNative: false, expected: "no" },
		{ type: "Gemini", geminiNative: false, expected: "untested" },
		{ type: "Vertex", geminiNative: false, expected: "untested" },
		{ type: "Bifrost", geminiNative: true, expected: "untested" },
	])("skips video upload for $type (native: $geminiNative)", async ({ expected, ...config }) => {
		installAnswers();
		expect((await probeProviderCapabilities({ ...provider, ...config }, model.model, settings)).video).toBe(expected);
		expect(getResponse).toHaveBeenCalledTimes(5);
	});

	it("re-tests previously failed capabilities without mutating the saved report", async () => {
		const capabilityReport = Object.fromEntries(providerCapabilityKeys.map(key => [key, "no"])) as ProviderCapabilityReport;
		installAnswers();
		const result = await probeProviderCapabilities({ ...provider, capabilityReport }, model.model, settings);
		expect(result.search).toBe("yes");
		for (const [testedProvider] of vi.mocked(getResponse).mock.calls) expect(testedProvider.capabilityReport).toBeUndefined();
		expect(capabilityReport.search).toBe("no");
	});
});
