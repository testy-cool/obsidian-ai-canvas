import { describe, expect, it } from "vitest";
import { getProviderCapabilities, getCapabilityReportKey, getCapabilityRoute, isBifrostProvider, isGoogleProvider, providerCapabilityKeys, type ProviderCapabilityReport } from "../src/utils/providerCapabilities";

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

describe("model-scoped capability reports", () => {
	const provider = { type: "Bifrost", baseUrl: "https://example.test/v1", geminiNative: true };
	const model = "vertex/gemini-3.1-pro-preview";
	const report: ProviderCapabilityReport = { schemaVersion: 2, route: getCapabilityRoute(provider), model,
		image: "yes", pdf: "yes", video: "untested", youtube: "no", search: "error", urlContext: "inconclusive" };
	it("ignores legacy gateway-wide failures", () => {
		expect(getProviderCapabilities({...provider, capabilityReport: {...report, schemaVersion: undefined}}, model).youtube).toBe(true);
	});
	it("applies only the tested model and route, leaving errors and inconclusive results enabled", () => {
		const saved = {...provider, capabilityReports: {[getCapabilityReportKey(provider, model)]: report}};
		expect(getProviderCapabilities(saved, model)).toMatchObject({youtube:false,search:true,urlContext:true});
		expect(getProviderCapabilities(saved, "vertex/gemini-other").youtube).toBe(true);
		expect(getProviderCapabilities({...saved, baseUrl:"https://new.example/v1"}, model).youtube).toBe(true);
		expect(getProviderCapabilities({...saved, geminiNative:false}, model).youtube).toBe(false);
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


describe("Bifrost identity", () => {
	it.each([
		{ id: "bifrost" },
		{ type: "bifrost" },
		{ type: "Bifrost gateway" },
		{ name: "My Bifrost" },
		{ baseUrl: "https://bifrost.example/v1" },
	])("recognizes $id $type $name $baseUrl consistently for native capabilities", identity => {
		expect(isBifrostProvider(identity)).toBe(true);
		expect(isGoogleProvider({ type: "Custom", ...identity, geminiNative: true })).toBe(true);
		expect(isGoogleProvider({ type: "Custom", ...identity, geminiNative: false })).toBe(false);
	});

	it.each([
		undefined,
		{ type: "OpenRouter", id: "openrouter", baseUrl: "https://openrouter.ai/api/v1" },
		{ type: "Custom", baseUrl: "https://example.test/bifrost?host=bifrost" },
		{ type: "Custom", baseUrl: "invalid URL" },
	])("does not classify other endpoints as Bifrost: %s", provider => {
		expect(isBifrostProvider(provider)).toBe(false);
		expect(isGoogleProvider({ type: "Custom", ...provider, geminiNative: true })).toBe(false);
	});
});
