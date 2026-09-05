import type { LLMProvider } from "../settings/AugmentedCanvasSettings";

export interface ProviderCapabilities {
	image: boolean;
	pdf: boolean;
	video: boolean;
	youtube: boolean;
	search: boolean;
	urlContext: boolean;
}

export type ProviderCapability = keyof ProviderCapabilities;
export type CapabilityVerdict = "yes" | "no" | "untested" | "error" | "inconclusive";
export type ProviderCapabilityReport = Record<ProviderCapability, CapabilityVerdict> & {
	schemaVersion?: 2;
	route?: string;
	testing?: ProviderCapability;
	testedAt?: string;
	model?: string;
	notes?: Record<string, string>;
};

export const providerCapabilityKeys: ProviderCapability[] = ["image", "pdf", "video", "youtube", "search", "urlContext"];

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

type ProviderIdentity = Partial<Pick<LLMProvider, "id" | "type" | "baseUrl">> & { name?: string };

export const isBifrostProvider = (provider?: ProviderIdentity): boolean => {
	if (provider?.id?.toLowerCase() === "bifrost" || /bifrost/i.test(provider?.type ?? "") || /bifrost/i.test(provider?.name ?? "")) return true;
	try {
		return /bifrost/i.test(new URL(provider?.baseUrl ?? "").hostname);
	} catch {
		return false;
	}
};

type ProviderKind = Pick<LLMProvider, "type" | "geminiNative"> & ProviderIdentity;
type TestedProvider = ProviderKind & Pick<LLMProvider, "capabilityReport" | "capabilityReports">;

export const isGoogleProvider = (provider?: ProviderKind): boolean =>
	(isBifrostProvider(provider) && provider?.geminiNative === true) || ["Gemini", "Google", "Vertex"].includes(provider?.type ?? "");

export const supportsGoogleTools = (modelId: string): boolean =>
	/^gemini-(?:2\.5|3(?:\.\d+)?)-/.test(modelId.split("/").pop() ?? "");

export const getCapabilityRoute = (provider?: ProviderKind): string => {
	const route: unknown[] = [provider?.type, provider?.baseUrl?.replace(/\/+$/, ""), isGoogleProvider(provider)];
	if (isBifrostProvider(provider) && provider?.geminiNative) route.push("vertex-passthrough-v1");
	return JSON.stringify(route);
};

export const getCapabilityReportKey = (provider: ProviderKind, model: string): string =>
	JSON.stringify([getCapabilityRoute(provider), model]);

export const getModelCapabilityReport = (provider: TestedProvider, model: string): ProviderCapabilityReport | undefined => {
	const report = provider.capabilityReports?.[getCapabilityReportKey(provider, model)];
	return report?.schemaVersion === 2 && report.model === model && report.route === getCapabilityRoute(provider) ? report : undefined;
};

export const getProviderCapabilities = (
	provider?: TestedProvider,
	model?: string
): ProviderCapabilities => {
	const capabilities = { ...(isGoogleProvider(provider) ? google : openAICompatible) };
	const report = provider && model ? getModelCapabilityReport(provider, model) : undefined;
	for (const key of providerCapabilityKeys) {
		const verdict = report?.[key];
		if (verdict === "yes" || verdict === "no") capabilities[key] = verdict === "yes";
	}
	return capabilities;
};
