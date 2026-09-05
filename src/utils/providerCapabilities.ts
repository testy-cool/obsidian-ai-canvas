import type { LLMProvider } from "../settings/AugmentedCanvasSettings";

export interface ProviderCapabilities {
	image: boolean;
	pdf: boolean;
	video: boolean;
	youtube: boolean;
	search: boolean;
	urlContext: boolean;
}

const openAICompatible: ProviderCapabilities = {
	image: true,
	pdf: true,
	video: false,
	youtube: false,
	search: false,
	urlContext: false,
};

const google: ProviderCapabilities = {
	image: true,
	pdf: true,
	video: true,
	youtube: true,
	search: true,
	urlContext: true,
};

const capabilitiesByProvider: Record<string, ProviderCapabilities> = {
	Gemini: google,
	Google: google,
	Vertex: google,
	Azure: openAICompatible,
};

export const getProviderCapabilities = (
	provider?: Pick<LLMProvider, "type">
): ProviderCapabilities => ({
	...(capabilitiesByProvider[provider?.type ?? ""] ?? openAICompatible),
});
