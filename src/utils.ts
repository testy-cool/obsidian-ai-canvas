import { logDebug } from "src/logDebug";
import { formatCost } from "./utils/cost";
import {
	App,
	ItemView,
	TFile,
	CanvasGroupNode,
} from "obsidian";
import { CanvasView, addEdge, getIncomingEdgeDirection } from "./obsidian/canvas-patches";
import { readNodeContent } from "./obsidian/fileUtil";
import { CanvasNode } from "./obsidian/canvas-internal";
import { AugmentedCanvasSettings } from "./settings/AugmentedCanvasSettings";
import { setImageGenerationPrompt } from "./utils/imageGenerationPrompt";
// from obsidian-chat-stream

interface AddImageNodeOptions {
	placementNode?: CanvasNode;
	imagePrompt?: string;
}

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

	const startPos = {
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
export function addImageNode(
	app: App,
	canvas: any,
	buffer: ArrayBuffer | null,
	filePathOrFile: string | TFile,
	parentNode: any,
	mimeType?: string,
	edgeLabel?: string,
	options: AddImageNodeOptions = {}
) {
	const { placementNode, imagePrompt } = options;
	const referenceNode = placementNode || parentNode;
	const IMAGE_WIDTH = referenceNode?.width || parentNode.width || 300;
	const IMAGE_HEIGHT = referenceNode?.height || IMAGE_WIDTH * (1024 / 1792) + 20;
	const placementX = placementNode ? placementNode.x : parentNode.x;
	const placementY = placementNode
		? placementNode.y
		: parentNode.y + parentNode.height + 30;
	
	const directionBias = getIncomingEdgeDirection(parentNode);
	const edgeFromSide =
		directionBias === "left"
			? "left"
			: directionBias === "right"
				? "right"
				: directionBias === "up"
					? "top"
					: "bottom";
	const edgeToSide =
		directionBias === "left"
			? "right"
			: directionBias === "right"
				? "left"
				: directionBias === "up"
					? "bottom"
					: "top";

	if (filePathOrFile) {
		const file =
			typeof filePathOrFile === "string"
				? app.vault.getAbstractFileByPath(filePathOrFile)
				: filePathOrFile;
		if (!(file instanceof TFile)) {
			return null;
		}

		// Create a file node with the saved image
		const node = canvas.createFileNode({
			file,
			pos: {
				x: placementX,
				y: placementY
			},
			size: {
				width: IMAGE_WIDTH,
				height: IMAGE_HEIGHT
			}
		});
		if (imagePrompt?.trim()) {
			setImageGenerationPrompt(node, imagePrompt);
		}
		
		canvas.addNode(node);
		addEdge(
			canvas,
			randomHexString(16),
			{
				fromOrTo: "from",
				side: edgeFromSide,
				node: parentNode,
			},
			{
				fromOrTo: "to",
				side: edgeToSide,
				node: node,
			},
			edgeLabel,
			{
				isGenerated: true,
			}
		);
		void canvas.requestSave?.();
		return node;
	} else if (buffer) {
		const blob = new Blob([buffer], { type: mimeType || "image/png" });
		const url = URL.createObjectURL(blob);
		const markdown = `![Generated Image](${url})`;

		// Create a text node with embedded image
		const node = canvas.createTextNode({
			text: markdown,
			pos: {
				x: placementX,
				y: placementY
			},
			size: {
				width: IMAGE_WIDTH,
				height: IMAGE_HEIGHT
			}
		});
		if (imagePrompt?.trim()) {
			setImageGenerationPrompt(node, imagePrompt);
		}
		
		canvas.addNode(node);
		addEdge(
			canvas,
			randomHexString(16),
			{
				fromOrTo: "from",
				side: edgeFromSide,
				node: parentNode,
			},
			{
				fromOrTo: "to",
				side: edgeToSide,
				node: node,
			},
			edgeLabel,
			{
				isGenerated: true,
			}
		);
		void canvas.requestSave?.();
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
	logDebug({ attachments });

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
		/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i;
	const match = url.match(pattern);
	return match ? match[1] : null;
}

const generatingNodes = new WeakSet<object>();
const modelIndicators = new WeakMap<object, HTMLElement>();
const modelIndicatorHost = (node: any): HTMLElement => node.nodeEl ?? node.contentEl;

/**
 * Compose the badge text. `sizing` always describes the finished state so the
 * card reserves its final width and nothing moves when generation ends.
 */
export type CardUsage = { inputTokens: number; outputTokens: number; cachedInputTokens?: number };

/** Share of the prompt read from the provider's cache, or 0 when none was. */
const cachedPercent = (usage?: CardUsage): number => {
	if (!usage || !(usage.inputTokens > 0) || !(usage.cachedInputTokens! > 0)) return 0;
	return Math.min(100, Math.round((usage.cachedInputTokens! / usage.inputTokens) * 100));
};

const formatDuration = (ms: number): string => {
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const seconds = Math.round(ms / 1000);
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

/** The line a selected card shows under its badge: tokens and time taken. */
export const buildUsageDetail = (usage?: CardUsage, durationMs?: number): string => {
	if (!usage || !(usage.inputTokens > 0 || usage.outputTokens > 0)) return "";
	const count = (n: number) => n.toLocaleString("en-US");
	const cached = usage.cachedInputTokens! > 0 ? ` (${count(usage.cachedInputTokens!)} cached)` : "";
	const parts = [`${count(usage.inputTokens)} in${cached}`, `${count(usage.outputTokens)} out`];
	if (typeof durationMs === "number" && durationMs > 0) parts.push(formatDuration(durationMs));
	return parts.join(" · ");
};

export const buildIndicatorText = ({ provider, model, contextCount, cost, usage, generating }: {
	provider: string;
	model: string;
	contextCount?: number;
	cost?: number;
	usage?: CardUsage;
	generating?: boolean;
}): { label: string; sizing: string } => {
	const context = typeof contextCount === "number" ? `${contextCount} ${contextCount === 1 ? "card" : "cards"} • ` : "";
	const price = typeof cost === "number" ? ` • ${formatCost(cost)}` : "";
	const percent = cachedPercent(usage);
	const cache = percent > 0 ? ` • cache ${percent}%` : "";
	const finished = `${context}${provider} • ${model}${price}${cache}`;
	return { label: generating ? `${context}generating` : finished, sizing: finished };
};

/**
 * Add a persistent context and model indicator to a canvas node
 */
export const setModelIndicatorText = (node: any, provider: string, model: string, generating = false) => {
	if (generating) generatingNodes.add(node);
	else generatingNodes.delete(node);
	const existing = modelIndicatorHost(node).querySelector(".ai-model-indicator");
	const indicator = existing ?? modelIndicators.get(node);
	if (!indicator) return;
	if (indicator.parentElement !== modelIndicatorHost(node)) modelIndicatorHost(node).appendChild(indicator);
	const data = node.getData();
	const contextCount = data.ai_context_count;
	const { label: text, sizing: finalText } = buildIndicatorText({
		provider,
		model,
		contextCount,
		cost: typeof data.ai_cost === "number" ? data.ai_cost : undefined,
		usage: data.ai_usage,
		generating,
	});
	const sizing = indicator.querySelector(".ai-model-indicator-size")!;
	if (sizing.textContent !== finalText) sizing.textContent = finalText;
	indicator.querySelector(".ai-model-indicator-loading-size")!.textContent =
		buildIndicatorText({ provider, model, contextCount, generating: true }).label;
	const label = indicator.querySelector(".ai-model-indicator-label")!;
	if (label.textContent !== text) label.textContent = text;
	const detail = generating ? "" : buildUsageDetail(data.ai_usage, data.ai_duration_ms);
	let detailEl = indicator.querySelector(".ai-card-usage");
	if (detail) {
		detailEl ??= indicator.createEl("div", { cls: "ai-card-usage" });
		if (detailEl.textContent !== detail) detailEl.textContent = detail;
	} else {
		detailEl?.remove();
	}
	indicator.setAttribute("data-state", generating ? "generating" : "complete");
};

export const addModelIndicator = (node: any, provider: string, model: string, generating = false) => {
	modelIndicatorHost(node).addClass("ai-card-ui-host");
	const indicator = modelIndicatorHost(node).querySelector<HTMLElement>(".ai-model-indicator") ?? modelIndicators.get(node) ??
		modelIndicatorHost(node).createEl("div", { cls: "ai-model-indicator" });
	modelIndicators.set(node, indicator);
	indicator.className = "ai-model-indicator";
	if (!indicator.querySelector(".ai-model-indicator-size")) {
		indicator.createEl("span", { cls: "ai-model-indicator-size" }).setAttribute("aria-hidden", "true");
		indicator.createEl("span", { cls: "ai-model-indicator-loading-size" }).setAttribute("aria-hidden", "true");
		indicator.createEl("span", { cls: "ai-model-indicator-label" });
	}
	const notes = node.getData().ai_notes;
	let notesEl = indicator.querySelector(".ai-card-notes");
	if (Array.isArray(notes) && notes.length) {
		notesEl ??= indicator.createEl("div", { cls: "ai-card-notes" });
		notesEl.empty();
		for (const note of notes) notesEl.createEl("div", { text: note });
	} else {
		notesEl?.remove();
	}
	setModelIndicatorText(node, provider, model, generating);

};

/**
 * Restore AI model indicators for all nodes on a canvas that have AI model data
 */
export const restoreModelIndicators = (canvas: any) => {
	if (!canvas || !canvas.nodes) return;

	// Iterate through all nodes in the canvas
	canvas.nodes.forEach((node: any) => {
		if (!node?.contentEl || node.isContentMounted === false || node.initialized === false) return;
		const nodeData = node.getData();
		
		// Check if this node has AI model information
		if (nodeData.ai_model && nodeData.ai_provider) {
			// Add the indicator if it doesn't already exist
			if (modelIndicatorHost(node).querySelector(".ai-model-indicator")?.parentElement !== modelIndicatorHost(node)) {
				addModelIndicator(node, nodeData.ai_provider, nodeData.ai_model, generatingNodes.has(node));
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
