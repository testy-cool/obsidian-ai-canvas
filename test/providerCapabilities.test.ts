import { describe, expect, it } from "vitest";
import { getProviderCapabilities } from "../src/utils/providerCapabilities";

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
