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

type ProviderKind = Pick<LLMProvider, "type" | "geminiNative">;

export const isGoogleProvider = (provider?: ProviderKind): boolean =>
	provider?.geminiNative === true || ["Gemini", "Google", "Vertex"].includes(provider?.type ?? "");

export const supportsGoogleTools = (modelId: string): boolean =>
	/^gemini-(?:2\.5|3(?:\.\d+)?)-/.test(modelId.split("/").pop() ?? "");

export const getProviderCapabilities = (
	provider?: ProviderKind
): ProviderCapabilities => ({
	...(isGoogleProvider(provider) ? google : openAICompatible),
});
