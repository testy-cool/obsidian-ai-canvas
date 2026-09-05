import { describe, expect, it } from "vitest";
import { getProviderCapabilities, providerCapabilityKeys, type ProviderCapabilityReport } from "../src/utils/providerCapabilities";

describe("provider capabilities", () => {
	it.each(["Gemini", "Google", "Vertex"])("enables all listed capabilities for %s", (type) => {
		expect(getProviderCapabilities({ type })).toEqual({
			image: true, pdf: true, video: true, youtube: true, search: true, urlContext: true,
		});
	});

	it.each(["Azure", "Bifrost", "bifrost", "OpenAI", "Custom", "OpenRouter", "Other"])("limits %s to images and PDFs", (type) => {
		expect(getProviderCapabilities({ type })).toEqual({
			image: true, pdf: true, video: false, youtube: false, search: false, urlContext: false,
		});
	});
});

describe("saved capability reports", () => {
	it.each(["yes", "no", "untested"] as const)("folds %s over every static capability", (verdict) => {
		const report = Object.fromEntries(providerCapabilityKeys.map(key => [key, verdict])) as ProviderCapabilityReport;
		for (const type of ["Bifrost", "Gemini"]) {
			const defaults = getProviderCapabilities({ type });
			const folded = getProviderCapabilities({ type, capabilityReport: report });
			for (const key of providerCapabilityKeys) {
				expect(folded[key]).toBe(verdict === "untested" ? defaults[key] : verdict === "yes");
			}
		}
	});

	it("keeps native defaults for untested entries and applies mixed results without changing defaults", () => {
		const provider = { type: "Bifrost", geminiNative: true };
		expect(getProviderCapabilities({ ...provider, capabilityReport: {
			image: "no", pdf: "yes", video: "untested", youtube: "no", search: "no", urlContext: "untested",
		} })).toEqual({ image: false, pdf: true, video: true, youtube: false, search: false, urlContext: true });
		expect(getProviderCapabilities(provider).search).toBe(true);
	});
});

describe("Bifrost Gemini-native capabilities", () => {
	it("returns Google capabilities when the flag is enabled", () => {
		expect(getProviderCapabilities({ type: "Bifrost", geminiNative: true })).toEqual({
			image: true, pdf: true, video: true, youtube: true, search: true, urlContext: true,
		});
	});

	it.each([false, undefined])("keeps compatible capabilities when geminiNative is %s", (geminiNative) => {
		expect(getProviderCapabilities({ type: "Bifrost", geminiNative })).toEqual({
			image: true, pdf: true, video: false, youtube: false, search: false, urlContext: false,
		});
	});
});
