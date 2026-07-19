import { setIcon } from "obsidian";
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
	// More lenient regex - optional newline after ```html
	const regex = /```html\s*([\s\S]*?)```/gi;
	let match;

	while ((match = regex.exec(text)) !== null) {
		const content = match[1].trim();
		if (content) {
			blocks.push({
				content,
				startIndex: match.index,
				endIndex: match.index + match[0].length,
			});
		}
	}

	return blocks;
}

/**
 * Create a sandboxed iframe with HTML content
 */
export function createHtmlPreviewIframe(htmlContent: string): HTMLIFrameElement {
	const iframe = document.createElement("iframe");

	iframe.style.width = "100%";
	iframe.style.height = "100%";
	iframe.style.border = "0";
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

type HtmlPreviewMode = "render" | "code";

const htmlPreviewModes = new Map<string, HtmlPreviewMode>();

interface HtmlPreviewWindow {
	setMenuBarVisibility(visible: boolean): void;
	setTitle(title: string): void;
	loadURL(url: string): Promise<void>;
	show(): void;
	close(): void;
	isDestroyed(): boolean;
	on(event: "closed", listener: () => void): void;
}

const htmlPreviewWindows = new Set<HtmlPreviewWindow>();

function setClass(element: HTMLElement, className: string, enabled: boolean): void {
	if (enabled) element.addClass(className);
	else element.removeClass(className);
}

/**
 * Add HTML preview UI to a canvas node
 */
export function addHtmlPreviewToNode(
	node: CanvasNode,
	htmlBlocks: HtmlCodeBlock[],
	defaultRender?: boolean
): HTMLElement | null {
	if (!htmlBlocks.length || !node.contentEl) {
		return null;
	}

	node.contentEl.removeClass("html-preview-host");
	node.contentEl.parentElement?.removeClass("html-preview-node-container");
	node.contentEl.addClass("html-preview-card");

	// Remove existing preview if present
	const existing = node.contentEl.querySelector(".html-preview-container");
	if (existing) {
		existing.remove();
	}

	const container = node.contentEl.createEl("div", {
		cls: "html-preview-container html-preview-card-ui",
	});
	const toolbar = container.createEl("div", { cls: "html-preview-toolbar" });
	const modeToggle = toolbar.createEl("div", { cls: "html-preview-mode-toggle" });
	const renderBtn = modeToggle.createEl("button", {
		cls: "clickable-icon html-preview-mode-btn",
	});
	renderBtn.setAttribute("aria-label", "Render HTML");
	setIcon(renderBtn, "eye");
	const codeBtn = modeToggle.createEl("button", {
		cls: "clickable-icon html-preview-mode-btn",
	});
	codeBtn.setAttribute("aria-label", "Show code");
	setIcon(codeBtn, "code-2");
	const openBtn = toolbar.createEl("button", {
		cls: "clickable-icon html-preview-open-btn",
	});
	openBtn.setAttribute("aria-label", "Open in new window");
	setIcon(openBtn, "external-link");
	const renderSurface = container.createEl("div", { cls: "html-preview-render-surface" });
	const iframe = createHtmlPreviewIframe(htmlBlocks[0].content);
	renderSurface.appendChild(iframe);

	const markdownHosts = Array.from(
		node.contentEl.querySelectorAll<HTMLElement>(".markdown-embed-content")
	);
	markdownHosts.forEach(host => host.addClass("html-preview-code-pane"));
	const applyMode = (mode: HtmlPreviewMode, remember: boolean) => {
		const isRender = mode === "render";
		if (remember) htmlPreviewModes.set(node.id, mode);
		markdownHosts.forEach(host => setClass(host, "html-preview-code-hidden", isRender));
		setClass(renderSurface, "html-preview-render-hidden", !isRender);
		setClass(renderBtn, "is-active", isRender);
		setClass(codeBtn, "is-active", !isRender);
		renderBtn.setAttribute("aria-pressed", String(isRender));
		codeBtn.setAttribute("aria-pressed", String(!isRender));
	};

	const bindMode = (button: HTMLButtonElement, mode: HtmlPreviewMode) => {
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			applyMode(mode, true);
		});
	};
	bindMode(renderBtn, "render");
	bindMode(codeBtn, "code");

	openBtn.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		void openHtmlInNewWindow(htmlBlocks[0].content).catch(error => {
			console.error("[HTML Preview] Failed to open preview window", error);
		});
	});

	const initialMode = htmlPreviewModes.get(node.id) ?? (defaultRender ? "render" : "code");
	applyMode(initialMode, false);

	return container;
}

/**
 * Open HTML content in a new browser window
 */
async function openHtmlInNewWindow(htmlContent: string): Promise<void> {
	const electronRequire = (globalThis as typeof globalThis & {
		require(moduleName: string): {
			BrowserWindow: new (options: Record<string, unknown>) => HtmlPreviewWindow;
		};
	}).require;
	const { BrowserWindow } = electronRequire("@electron/remote");
	const previewWindow = new BrowserWindow({
		width: 900,
		height: 700,
		show: false,
		title: "HTML Preview",
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
		},
	});

	htmlPreviewWindows.add(previewWindow);
	previewWindow.on("closed", () => htmlPreviewWindows.delete(previewWindow));
	previewWindow.setMenuBarVisibility(false);

	try {
		await previewWindow.loadURL(
			`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`
		);
		if (!previewWindow.isDestroyed()) {
			previewWindow.setTitle("HTML Preview");
			previewWindow.show();
		}
	} catch (error) {
		htmlPreviewWindows.delete(previewWindow);
		if (!previewWindow.isDestroyed()) previewWindow.close();
		throw error;
	}
}

function closeHtmlPreviewWindows(): void {
	htmlPreviewWindows.forEach(previewWindow => {
		if (!previewWindow.isDestroyed()) previewWindow.close();
	});
	htmlPreviewWindows.clear();
}

/**
 * Restore HTML previews for all nodes in a canvas
 */
export function restoreHtmlPreviews(canvas: any, defaultRender: boolean = false): void {
	if (!canvas?.nodes) return;

	canvas.nodes.forEach((node: CanvasNode) => {
		const nodeData = node.getData?.();
		if (nodeData?.type === "text") {
			const text = node.text || "";
			const htmlBlocks = extractHtmlCodeBlocks(text);
			if (htmlBlocks.length > 0 && !node.contentEl?.querySelector(".html-preview-card-ui")) {
				addHtmlPreviewToNode(node, htmlBlocks, defaultRender);
			}
		}
	});
}

/**
 * Set up canvas event listeners to restore HTML previews
 */
export function setupHtmlPreviewPersistence(app: any, getDefaultRender: () => boolean): () => void {
	let restoreTimer: ReturnType<typeof setTimeout> | undefined;
	let observer: MutationObserver | undefined;
	let observedRoot: HTMLElement | null = null;

	const getActiveCanvas = () => {
		const view = app.workspace.activeLeaf?.view;
		return view?.getViewType?.() === "canvas" ? view.canvas : null;
	};

	const runRestore = () => {
		restoreTimer = undefined;
		const canvas = getActiveCanvas();
		if (!canvas) return;

		if (canvas.wrapperEl && canvas.wrapperEl !== observedRoot) {
			observer?.disconnect();
			observer = new MutationObserver(() => scheduleRestore());
			observer.observe(canvas.wrapperEl, { childList: true, subtree: true });
			observedRoot = canvas.wrapperEl;
		}

		restoreHtmlPreviews(canvas, getDefaultRender());
	};

	const scheduleRestore = () => {
		if (restoreTimer) clearTimeout(restoreTimer);
		restoreTimer = setTimeout(runRestore, 100);
	};

	const restoreForActiveCanvas = () => {
		observer?.disconnect();
		observedRoot = null;
		scheduleRestore();
	};

	// Restore previews when switching to canvas view
	app.workspace.on("active-leaf-change", restoreForActiveCanvas);

	// Restore previews when canvas is loaded
	app.workspace.on("layout-change", scheduleRestore);
	scheduleRestore();

	// Return cleanup function
	return () => {
		if (restoreTimer) clearTimeout(restoreTimer);
		observer?.disconnect();
		closeHtmlPreviewWindows();
		app.workspace.off("active-leaf-change", restoreForActiveCanvas);
		app.workspace.off("layout-change", scheduleRestore);
	};
}
