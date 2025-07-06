import { App, ItemView, Notice, TFile, TFolder } from "obsidian";
import { AugmentedCanvasSettings } from "src/settings/AugmentedCanvasSettings";
import { createImage } from "src/utils/llm";
import { Canvas, CanvasNode } from "src/obsidian/canvas-internal";
import { addImageNode } from "src/utils";
import { getImageBuffer, saveImageToFile } from "src/obsidian/fileUtil";

export async function handleGenerateImage(
	app: App,
	settings: AugmentedCanvasSettings,
	node?: CanvasNode
) {
	// Get API key
	const apiKey = settings.activeProvider 
		? settings.providers.find(p => p.id === settings.activeProvider)?.apiKey || settings.apiKey
		: settings.apiKey;
	
	const baseUrl = settings.activeProvider
		? settings.providers.find(p => p.id === settings.activeProvider)?.baseUrl
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
	const nodeContent = node.text;
	// console.log({ canvasView, nodeContent });

	// Generate image from the selected node
	new Notice("Generating image...");
	try {
		const imageData = await createImage(
			apiKey,
			nodeContent,
			{
				isVertical: false,
				model: "dall-e-3",
				baseUrl: baseUrl
			}
		);

		if (!imageData) {
			new Notice("Failed to generate image");
			return;
		}

		// Convert base64 to buffer
		const buffer = getImageBuffer(imageData);

		// Check if we have a path to save the image
		if (!settings.imagesPath) {
			// Add image directly to the canvas
			addImageNode(app, activeItem, buffer, "", node);
			return;
		}

		// Save image to file
		const imageFile = await saveImageToFile(
			app,
			buffer,
			settings.imagesPath
		);

		if (!imageFile) {
			// Add image directly to the canvas
			addImageNode(app, activeItem, buffer, "", node);
			return;
		}

		// Add image node to canvas
		addImageNode(app, activeItem, null, imageFile.path, node);
	} catch (error) {
		console.error("Error generating image:", error);
		new Notice(`Failed to generate image: ${error.message}`);
	}
}
