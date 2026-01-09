import { App, ItemView, Notice, TFile, TFolder } from "obsidian";
import { AugmentedCanvasSettings, LLMProvider } from "src/settings/AugmentedCanvasSettings";
import { createGeminiImage, createImage } from "src/utils/llm";
import { Canvas, CanvasNode } from "src/obsidian/canvas-internal";
import { addImageNode } from "src/utils";
import {
	buildImageFileName,
	buildResponseFileName,
	getImageBuffer,
	saveImageToAttachment,
	saveImageToFile,
	saveTextToAttachment,
	saveTextToFile,
} from "src/obsidian/fileUtil";
import { logDebug } from "src/logDebug";

const normalizeBaseUrl = (value?: string) => value ? value.replace(/\/+$/, "") : value;

const isGeminiProvider = (provider?: LLMProvider) => {
	if (!provider) return false;
	const id = provider.id.trim().toLowerCase();
	const type = provider.type.trim().toLowerCase();
	return id === "gemini" || type === "gemini" || type === "google";
};

const getImageBaseUrl = (provider?: LLMProvider) => {
	const baseUrl = normalizeBaseUrl(provider?.baseUrl);
	if (!baseUrl) return undefined;
	if (!isGeminiProvider(provider)) return baseUrl;
	return baseUrl.endsWith("/openai") ? baseUrl : `${baseUrl}/openai`;
};

export async function handleGenerateImage(
	app: App,
	settings: AugmentedCanvasSettings,
	node?: CanvasNode,
	options?: {
		provider?: LLMProvider;
		model?: string;
		prompt?: string;
		parts?: { text?: string; inlineData?: { data: string; mimeType: string } }[];
	}
) {
	const imageProviderId = settings.imageProviderId || settings.activeProvider;
	const imageProvider =
		options?.provider ||
		settings.providers.find(provider => provider.id === imageProviderId) ||
		settings.providers.find(provider => provider.id === settings.activeProvider);
	const apiKey = imageProvider?.apiKey || settings.apiKey;
	const baseUrl = getImageBaseUrl(imageProvider);
	const model = options?.model || settings.imageModelId || undefined;
	const headers = isGeminiProvider(imageProvider) && apiKey
		? { "x-goog-api-key": apiKey }
		: undefined;

	if (!apiKey) {
		new Notice("Please set your API key in the plugin settings");
		return;
	}

	// Get active canvas
	const canvasView = app.workspace.getActiveViewOfType(ItemView) as any;
	if (!canvasView || !canvasView.canvas) {
		new Notice("Active view is not a canvas");
		return;
	}

	const activeItem = canvasView.canvas;

	// Get selected node or clicked node
	if (!node) {
		const selectedNodes = Array.from(activeItem.selection.values());
		if (selectedNodes.length !== 1) {
			new Notice("Please select a single card");
			return;
		}

		node = selectedNodes[0] as CanvasNode;
	}

	// Get the text from the selected node
	const nodeContent = options?.prompt || node.text;
	// console.log({ canvasView, nodeContent });

	// Generate image from the selected node
	new Notice("Generating image...");
	try {
		if (isGeminiProvider(imageProvider) && !model) {
			new Notice("Select an image model for Gemini in the Image Generation settings.");
			return;
		}

		const imageOutput = isGeminiProvider(imageProvider)
			? await createGeminiImage(apiKey, nodeContent, {
					model: model,
					baseUrl: imageProvider?.baseUrl,
					parts: options?.parts,
			  })
			: await createImage(
					apiKey,
					nodeContent,
					{
						isVertical: false,
						model: model,
						baseUrl: baseUrl,
						headers: headers,
					}
			  );

		const modelForFile = model?.replace(/^models\//i, "").trim();
		const fileNamePrefix = modelForFile
			? modelForFile.toLowerCase().includes("nano-banana")
				? "nanobanana-image"
				: `${modelForFile}-image`
			: "image";
		const responseFilePrefix = fileNamePrefix.endsWith("-image")
			? fileNamePrefix.replace(/-image$/, "-response")
			: `${fileNamePrefix}-response`;
		const responseFileName = buildResponseFileName(responseFilePrefix);

		if (imageOutput.raw) {
			let responsePlannedPath: string | null = null;
			try {
				if (settings.imagesPath) {
					const normalizedFolderPath = settings.imagesPath.replace(/\/+$/, "");
					responsePlannedPath = normalizedFolderPath
						? `${normalizedFolderPath}/${responseFileName}`
						: responseFileName;
					await saveTextToFile(
						app,
						imageOutput.raw,
						settings.imagesPath,
						responseFileName
					);
				} else {
					responsePlannedPath = await app.fileManager.getAvailablePathForAttachment(
						responseFileName,
						canvasView.file?.path
					);
					await saveTextToAttachment(
						app,
						imageOutput.raw,
						canvasView.file?.path,
						responseFileName,
						responsePlannedPath
					);
				}
				if (responsePlannedPath) {
					new Notice(`Saved raw response to ${responsePlannedPath}`);
				}
			} catch (responseError) {
				const message =
					responseError instanceof Error
						? responseError.message
						: String(responseError);
				const pathInfo = responsePlannedPath ? ` (${responsePlannedPath})` : "";
				new Notice(`Raw response save failed${pathInfo}: ${message}`);
			}
		}

		const imageResult = imageOutput.image;
		if (!imageResult?.base64) {
			new Notice("Failed to generate image");
			return;
		}

		// Convert base64 to buffer
		const buffer = getImageBuffer(imageResult.base64);
		const mimeType = imageResult.mimeType;
		const fileName = buildImageFileName(fileNamePrefix, mimeType);

		let imageFile: TFile | null = null;
		let plannedPath: string | null = null;

		try {
			if (settings.imagesPath) {
				const normalizedFolderPath = settings.imagesPath.replace(/\/+$/, "");
				plannedPath = normalizedFolderPath
					? `${normalizedFolderPath}/${fileName}`
					: fileName;
				new Notice(`Saving image to ${plannedPath}`);
				imageFile = await saveImageToFile(
					app,
					buffer,
					settings.imagesPath,
					mimeType,
					fileName
				);
			} else {
				plannedPath = await app.fileManager.getAvailablePathForAttachment(
					fileName,
					canvasView.file?.path
				);
				new Notice(`Saving image to ${plannedPath}`);
				imageFile = await saveImageToAttachment(
					app,
					buffer,
					mimeType,
					canvasView.file?.path,
					fileName,
					plannedPath
				);
			}
		} catch (saveError) {
			const message =
				saveError instanceof Error ? saveError.message : String(saveError);
			const pathInfo = plannedPath ? ` (${plannedPath})` : "";
			new Notice(`Image save failed${pathInfo}: ${message}`);
		}

		if (imageFile) {
			logDebug("Saved image file", { path: imageFile.path });
			new Notice(`Saved image to ${imageFile.path}`);
			addImageNode(app, activeItem, null, imageFile, node);
			return;
		}

		// Fallback to embedding when file save fails.
		addImageNode(app, activeItem, buffer, "", node, mimeType);
	} catch (error) {
		console.error("Error generating image:", error);
		const apiError = error as { status?: number; error?: { message?: string } };
		const fallback =
			error instanceof Error ? error.message : "Unknown error";
		const detail = apiError?.error?.message || fallback;
		const status = apiError?.status ? ` (${apiError.status})` : "";
		new Notice(`Failed to generate image${status}: ${detail}`);
	}
}
