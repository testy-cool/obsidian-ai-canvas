import { CanvasNode } from "../obsidian/canvas-internal";

export interface HtmlCodeBlock {
	content: string;
	startIndex: number;
	endIndex: number;
}

/**
 * Extract ```html code blocks from text
 */
export function extractHtmlCodeBlocks(text: string): HtmlCodeBlock[] {
	const blocks: HtmlCodeBlock[] = [];
	const regex = /```html\s*\n([\s\S]*?)```/gi;
	let match;

	while ((match = regex.exec(text)) !== null) {
		blocks.push({
			content: match[1].trim(),
			startIndex: match.index,
			endIndex: match.index + match[0].length,
		});
	}

	return blocks;
}

/**
 * Create a sandboxed iframe with HTML content
 */
export function createHtmlPreviewIframe(
	htmlContent: string,
	options?: { width?: number; height?: number }
): HTMLIFrameElement {
	const iframe = document.createElement("iframe");
	const width = options?.width ?? 480;
	const height = options?.height ?? 360;

	iframe.style.width = `${width}px`;
	iframe.style.height = `${height}px`;
	iframe.style.border = "1px solid var(--background-modifier-border)";
	iframe.style.borderRadius = "var(--radius-s)";
	iframe.style.background = "white";

	// Sandbox attributes for security
	// allow-scripts: Allow JS execution
	// NO allow-same-origin: Prevents access to Obsidian
	// NO allow-forms: Prevents form submission
	iframe.sandbox.add("allow-scripts");

	// Use srcdoc for best isolation
	iframe.srcdoc = htmlContent;

	return iframe;
}

type SizePreset = "S" | "M" | "L";

const SIZE_PRESETS: Record<SizePreset, { width: number; height: number }> = {
	S: { width: 320, height: 240 },
	M: { width: 480, height: 360 },
	L: { width: 640, height: 480 },
};

/**
 * Add HTML preview UI to a canvas node
 */
export function addHtmlPreviewToNode(
	node: CanvasNode,
	htmlBlocks: HtmlCodeBlock[],
	autoExpand?: boolean
): HTMLElement | null {
	if (!htmlBlocks.length || !node.contentEl) return null;

	const container = node.contentEl.createEl("div", { cls: "html-preview-container" });

	htmlBlocks.forEach((block, index) => {
		const details = container.createEl("details", { cls: "html-preview-details" });
		if (autoExpand) {
			details.setAttribute("open", "");
		}

		const summary = details.createEl("summary", { cls: "html-preview-summary" });
		const label = htmlBlocks.length > 1 ? `Preview HTML (${index + 1})` : "Preview HTML";
		summary.createEl("span", { text: label });

		const controlsRow = details.createEl("div", { cls: "html-preview-controls" });

		// Size buttons
		const sizeContainer = controlsRow.createEl("div", { cls: "html-preview-sizes" });
		let currentSize: SizePreset = "M";
		let iframe: HTMLIFrameElement | null = null;

		const updateSize = (size: SizePreset) => {
			currentSize = size;
			if (iframe) {
				iframe.style.width = `${SIZE_PRESETS[size].width}px`;
				iframe.style.height = `${SIZE_PRESETS[size].height}px`;
			}
			// Update button states
			sizeContainer.querySelectorAll("button").forEach((btn) => {
				btn.removeClass("html-preview-size-active");
				if (btn.getText() === size) {
					btn.addClass("html-preview-size-active");
				}
			});
		};

		(["S", "M", "L"] as SizePreset[]).forEach((size) => {
			const btn = sizeContainer.createEl("button", {
				text: size,
				cls: "html-preview-size-btn",
			});
			if (size === currentSize) {
				btn.addClass("html-preview-size-active");
			}
			btn.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				updateSize(size);
			});
		});

		// Open in new window button
		const openBtn = controlsRow.createEl("button", {
			text: "Open in new window",
			cls: "html-preview-open-btn",
		});
		openBtn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			openHtmlInNewWindow(block.content);
		});

		// Iframe container
		const iframeContainer = details.createEl("div", { cls: "html-preview-iframe-container" });
		iframe = createHtmlPreviewIframe(block.content, SIZE_PRESETS[currentSize]);
		iframeContainer.appendChild(iframe);
	});

	return container;
}

/**
 * Open HTML content in a new browser window
 */
function openHtmlInNewWindow(htmlContent: string): void {
	const newWindow = window.open("", "_blank");
	if (newWindow) {
		newWindow.document.write(htmlContent);
		newWindow.document.close();
	}
}
