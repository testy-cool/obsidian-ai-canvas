import type { AugmentedCanvasSettings, LLMProvider } from "../settings/AugmentedCanvasSettings";
import { getResponse, type Message } from "./llm";
import { getCapabilityRoute, getProviderCapabilities, supportsGoogleTools, type ProviderCapability, type ProviderCapabilityReport } from "./providerCapabilities";

import { CAPABILITY_PROBE_VIDEO } from "../data/capabilityVideo";

const RED_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const PROBE_PDF = "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA0MDAgMjAwXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNDkgPj4Kc3RyZWFtCkJUIC9GMSAyNCBUZiA0MCAxMDAgVGQgKENBTlZBUyBQUk9CRSA3NDMxKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwMzExIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDA5CiUlRU9GCg==";
const TIMEOUT_MS = 60_000;

export const probeProviderCapabilities = async (
	provider: LLMProvider,
	modelId: string,
	settings: AugmentedCanvasSettings,
	onProgress?: (report: ProviderCapabilityReport) => void
): Promise<ProviderCapabilityReport> => {
	const notes: Record<string, string> = {};
	const report: ProviderCapabilityReport = {
		image: "untested", pdf: "untested", video: "untested", youtube: "untested", search: "untested", urlContext: "untested",
		model: modelId, schemaVersion: 2, route: getCapabilityRoute(provider), notes,
	};
	const reportProgress = () => onProgress?.({ ...report, notes: { ...notes } });
	reportProgress();
	// A previous failed test must not disable the features being re-tested.
	const probeProvider = { ...provider, capabilityReport: undefined, capabilityReports: undefined };
	const available = getProviderCapabilities(probeProvider, modelId);
	let accessFailed = false;
	const model = settings.models.find(item => item.providerId === provider.id && item.model === modelId);
	const check = async (
		capability: ProviderCapability,
		content: Message["content"],
		accept: (result: { text: string; sources?: unknown[]; providerMetadata?: any; inputModalities?: string[] }) => boolean,
		failure: string
	) => {
		if (accessFailed) {
			notes[capability] = "Not run because access or budget checks failed. Resolve the error above, then retry.";
			reportProgress();
			return;
		}
		if (!available[capability] || (["search", "urlContext"].includes(capability) && !supportsGoogleTools(modelId))) {
			report[capability] = "no";
			notes[capability] = "Unavailable through this model's current API mode. No request was sent.";
			reportProgress();
			return;
		}
		report.testing = capability;
		reportProgress();
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const response = await Promise.race([
				getResponse(probeProvider, [{ role: "user", content } as Message], {
					model: modelId,
					temperature: settings.temperature,
					max_tokens: 2048,
					providerParams: model?.providerParams,
					timeoutMs: TIMEOUT_MS,
					includeMetadata: true,
					useSearchGrounding: capability === "search",
					useUrlContext: capability === "urlContext",
				}),
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => reject(new Error("Timed out after 60 seconds. Retry to check this capability.")), TIMEOUT_MS);
				}),
			]);
			const result = typeof response === "string" ? { text: response } : response;
			const passed = accept(result);
			report[capability] = passed ? "yes" : "inconclusive";
			notes[capability] = `${passed ? "Passed." : failure} ${result.text ?? ""}`.trim().slice(0, 500);
		} catch (error) {
			report[capability] = "error";
			const message = error instanceof Error ? error.message : String(error);
			notes[capability] = provider.apiKey ? message.split(provider.apiKey).join("[redacted]") : message;
			accessFailed = /\b(?:401|402|403)\b/.test(message) || [401, 402, 403].includes((error as any)?.statusCode);
		} finally {
			clearTimeout(timer);
			delete report.testing;
		}
		reportProgress();
	};

	await check("image", [
		{ type: "text", text: "Reply with the colour of this image in one word." },
		{ type: "image", image: RED_PNG, mediaType: "image/png" },
	], result => /red/i.test(result.text), "The reply did not identify red.");

	await check("pdf", [
		{ type: "text", text: "What number appears in this document? Reply with digits only." },
		{ type: "file", data: PROBE_PDF, mediaType: "application/pdf", filename: "canvas-probe.pdf" },
	], result => result.text.includes("7431"), "The reply did not contain 7431.");

	await check("youtube", [
		{ type: "text", text: "In one sentence, what is shown in this video?" },
		{ type: "file", data: "https://www.youtube.com/watch?v=jNQXAC9IVRw", mediaType: "video/mp4" },
	], result => result.inputModalities?.includes("VIDEO") === true && /zoo|elephant/i.test(result.text) &&
		!/(?:cannot|can['’]t|unable to|do not|don['’]t).{0,60}(?:see|access|watch|view)/i.test(result.text),
	"Video processing was not verified. A description alone is insufficient; the response must also report video input usage.");

	await check("video", [
		{ type: "text", text: "What are the three solid screen colours in this clip, in chronological order? Reply with only the colours." },
		{ type: "file", data: CAPABILITY_PROBE_VIDEO, mediaType: "video/mp4", filename: "canvas-probe.mp4" },
	], result => result.inputModalities?.includes("VIDEO") === true && /red[\s\S]*green[\s\S]*blue/i.test(result.text),
	"Video upload was not verified. The reply must identify all three colours in order and report video input usage.");

	await check("search", "What is today's date and one news headline from today? Include the four-digit year.", result => {
		const grounding = result.providerMetadata?.google?.groundingMetadata;
		const grounded = Boolean(result.sources?.length || (grounding && Object.keys(grounding).length));
		return result.text.includes(String(new Date().getFullYear())) && grounded;
	}, "The reply lacked the current year or grounding evidence in sources/provider metadata.");

	await check("urlContext", "Read https://example.com and quote its first heading verbatim.",
		result => /Example Domain/i.test(result.text) && result.providerMetadata?.google?.urlContextMetadata?.urlMetadata?.some(
			(item: any) => /^https:\/\/example\.com\/?$/.test(item.retrievedUrl) && item.urlRetrievalStatus === "URL_RETRIEVAL_STATUS_SUCCESS"
		), "URL retrieval was not verified. The expected heading alone can come from memory.");

	report.testedAt = new Date().toISOString();
	return report;
};
