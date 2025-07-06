import {
	App,
	Canvas,
	CanvasCoords,
	ItemView,
	Menu,
	MenuItem,
	TFile,
	CanvasGroupNode,
} from "obsidian";
import { CanvasView, createNode } from "./obsidian/canvas-patches";
import { readFileContent, readNodeContent } from "./obsidian/fileUtil";
import { CanvasNode } from "./obsidian/canvas-internal";
import { AugmentedCanvasSettings } from "./settings/AugmentedCanvasSettings";
// from obsidian-chat-stream

/**
 * Generate a string of random hexadecimal chars
 */
export const randomHexString = (len: number) => {
	const t = [];
	for (let n = 0; n < len; n++) {
		t.push(((16 * Math.random()) | 0).toString(16));
	}
	return t.join("");
};

export const getActiveCanvas = (app: App) => {
	const maybeCanvasView = app.workspace.getActiveViewOfType(
		ItemView
	) as CanvasView | null;
	return maybeCanvasView ? maybeCanvasView["canvas"] : null;
};

export const createCanvasGroup = (
	app: App,
	groupName: string,
	notesContents: string[]
) => {
	const canvas = getActiveCanvas(app);
	if (!canvas) return;

	const NOTE_WIDTH = 500;
	const NOTE_HEIGHT = 150;
	const NOTE_GAP = 20;

	const NOTES_BY_ROW = 3;

	let startPos = {
		// @ts-expect-error
		x: canvas.x - ((NOTE_WIDTH + NOTE_GAP) * NOTES_BY_ROW) / 2,
		// @ts-expect-error
		y: canvas.y - ((NOTE_HEIGHT + NOTE_GAP) * 2) / 2,
	};

	// @ts-expect-error
	const newGroup: CanvasGroupNode = canvas.createGroupNode({
		// TODO : does not work
		label: groupName,
		pos: {
			x: startPos.x - NOTE_GAP,
			y: startPos.y - NOTE_GAP,
		},
		size: {
			width: NOTES_BY_ROW * (NOTE_WIDTH + NOTE_GAP) + NOTE_GAP,
			height: (NOTE_HEIGHT + NOTE_GAP) * 2 + NOTE_GAP,
		},
	});
	newGroup.label = groupName;
	newGroup.labelEl.setText(groupName);

	let countRow = 0;
	let countColumn = 0;
	for (const noteContent of notesContents) {
		const newNode = canvas.createTextNode({
			text: noteContent,
			pos: {
				x: startPos.x + countRow * (NOTE_WIDTH + NOTE_GAP),
				y: startPos.y + countColumn * (NOTE_HEIGHT + NOTE_GAP),
			},
			size: {
				width: NOTE_WIDTH,
				height: NOTE_HEIGHT,
			},
		});
		canvas.addNode(newNode);
		countColumn =
			countRow + 1 > NOTES_BY_ROW - 1 ? countColumn + 1 : countColumn;
		countRow = countRow + 1 > NOTES_BY_ROW - 1 ? 0 : countRow + 1;
	}

	// @ts-expect-error
	canvas.addGroup(newGroup);
};

export const canvasNodeIsNote = (canvasNode: CanvasNode) => {
	// @ts-expect-error
	return !canvasNode.from;
};

export const getActiveCanvasNodes = (app: App) => {
	const canvas = getActiveCanvas(app);
	if (!canvas) return;

	return <CanvasNode[]>Array.from(canvas.selection)!;
};

export const getCanvasActiveNoteText = (app: App) => {
	const canvasNodes = getActiveCanvasNodes(app);
	if (!canvasNodes || canvasNodes.length !== 1) return;

	const canvasNode = canvasNodes.first()!;
	if (!canvasNodeIsNote(canvasNode)) return;

	return readNodeContent(canvasNode);
};

/**
 * Adds an image node to the canvas
 */
export function addImageNode(app: App, canvas: any, buffer: ArrayBuffer | null, filePath: string, parentNode: any) {
	const IMAGE_WIDTH = parentNode.width || 300;
	const IMAGE_HEIGHT = IMAGE_WIDTH * (1024 / 1792) + 20;
	
	if (filePath) {
		// Create a file node with the saved image
		const node = canvas.createFileNode({
			file: app.vault.getAbstractFileByPath(filePath),
			pos: {
				x: parentNode.x,
				y: parentNode.y + parentNode.height + 30
			},
			size: {
				width: IMAGE_WIDTH,
				height: IMAGE_HEIGHT
			}
		});
		
		return node;
	} else if (buffer) {
		// Create a text node with embedded image
		const node = canvas.createTextNode({
			text: "Image",
			pos: {
				x: parentNode.x,
				y: parentNode.y + parentNode.height + 30
			},
			size: {
				width: IMAGE_WIDTH,
				height: IMAGE_HEIGHT
			}
		});
		
		// Add the image data to the node
		// This is a simplified version, you might need to adapt this to how your canvas handles embedded images
		const blob = new Blob([buffer], { type: "image/png" });
		const url = URL.createObjectURL(blob);
		
		// Update the node text to show the image (using markdown image syntax)
		node.setText(`![Generated Image](${url})`);
		
		return node;
	}
	
	return null;
}

export const getImageSaveFolderPath = async (
	app: App,
	settings: AugmentedCanvasSettings
) => {
	// @ts-expect-error
	const attachments = (await app.vault.getAvailablePathForAttachments())
		.split("/")
		.slice(0, -1)
		.join("/");
	console.log({ attachments });

	return attachments;
	// // @ts-expect-error
	// return settings.imagesPath || app.vault.config.attachmentFolderPath;
};

export function getYouTubeVideoId(url: string): string | null {
	// This pattern will match the following types of YouTube URLs:
	// - http://www.youtube.com/watch?v=VIDEO_ID
	// - http://www.youtube.com/watch?v=VIDEO_ID&...
	// - http://www.youtube.com/embed/VIDEO_ID
	// - http://youtu.be/VIDEO_ID
	// The capture group (VIDEO_ID) is the YouTube video ID
	const pattern =
		/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
	const match = url.match(pattern);
	return match ? match[1] : null;
}

/**
 * Add a persistent model indicator to a canvas node
 */
export const addModelIndicator = (node: any, provider: string, model: string) => {
	// Remove existing indicator if present
	const existingIndicator = node.contentEl.querySelector(".ai-model-indicator");
	if (existingIndicator) {
		existingIndicator.remove();
	}

	// Create a subtle indicator at the bottom of the note
	const indicator = node.contentEl.createEl("div", { 
		cls: "ai-model-indicator",
		text: `${provider} • ${model}`
	});
	
	// Style the indicator to be subtle
	indicator.style.cssText = `
		position: absolute;
		bottom: 4px;
		right: 8px;
		font-size: 10px;
		color: var(--text-faint);
		opacity: 0.6;
		pointer-events: none;
		background: var(--background-primary);
		padding: 2px 6px;
		border-radius: 4px;
		font-family: var(--font-monospace);
		z-index: 1;
		backdrop-filter: blur(2px);
	`;
};

/**
 * Restore AI model indicators for all nodes on a canvas that have AI model data
 */
export const restoreModelIndicators = (canvas: any) => {
	if (!canvas || !canvas.nodes) return;

	// Iterate through all nodes in the canvas
	canvas.nodes.forEach((node: any) => {
		const nodeData = node.getData();
		
		// Check if this node has AI model information
		if (nodeData.ai_model && nodeData.ai_provider) {
			// Add the indicator if it doesn't already exist
			if (!node.contentEl.querySelector(".ai-model-indicator")) {
				addModelIndicator(node, nodeData.ai_provider, nodeData.ai_model);
			}
		}
	});
};

/**
 * Set up canvas event listeners to restore indicators
 */
export const setupCanvasIndicatorPersistence = (app: any) => {
	const restoreIndicatorsForActiveCanvas = () => {
		const canvas = getActiveCanvas(app);
		if (canvas) {
			// Use a small delay to ensure DOM is ready
			setTimeout(() => {
				restoreModelIndicators(canvas);
			}, 100);
		}
	};

	// Restore indicators when switching to canvas view
	app.workspace.on("active-leaf-change", restoreIndicatorsForActiveCanvas);
	
	// Restore indicators when canvas is loaded
	app.workspace.on("layout-change", restoreIndicatorsForActiveCanvas);
	
	// Return cleanup function
	return () => {
		app.workspace.off("active-leaf-change", restoreIndicatorsForActiveCanvas);
		app.workspace.off("layout-change", restoreIndicatorsForActiveCanvas);
	};
};
