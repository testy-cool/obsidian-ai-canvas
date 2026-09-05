import { setIcon } from "obsidian";
import { CanvasNode } from "../obsidian/canvas-internal";

import { extractHtmlCodeBlocks, type HtmlCodeBlock } from "./htmlCodeBlocks";
export { extractHtmlCodeBlocks, type HtmlCodeBlock } from "./htmlCodeBlocks";

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
const lastScannedText = new WeakMap<CanvasNode, string>();
const scannedHtmlBlocks = new WeakMap<CanvasNode, HtmlCodeBlock[]>();

interface PreviewState {
	node: CanvasNode;
	container: HTMLElement;
	surface: HTMLElement;
	html: string;
	root: HTMLElement;
	visible: boolean;
	timer?: ReturnType<typeof setTimeout>;
}

const previewsByNode = new WeakMap<CanvasNode, PreviewState>();
const previewsByContainer = new WeakMap<Element, PreviewState>();
const previewObservers = new Map<HTMLElement, { observer: IntersectionObserver; states: Set<PreviewState> }>();

function parkPreview(state: PreviewState): void {
	clearTimeout(state.timer);
	state.timer = undefined;
	const iframe = state.surface.querySelector("iframe");
	if (!iframe) return;
	const placeholder = state.surface.createEl("div", {
		cls: "html-preview-parked", text: "Preview parked, scroll to view",
	});
	// Match the iframe's full-size layout without forcing a geometry read.
	placeholder.style.width = iframe.style.width;
	placeholder.style.height = iframe.style.height;
	placeholder.style.fontSize = "12px";
	placeholder.style.color = "var(--text-muted)";
	placeholder.style.display = "flex";
	placeholder.style.alignItems = "center";
	placeholder.style.justifyContent = "center";
	iframe.remove();
}

function resumePreview(state: PreviewState): void {
	clearTimeout(state.timer);
	state.timer = undefined;
	if (state.node.isContentMounted === false || state.node.initialized === false) {
		parkPreview(state);
		return;
	}
	const placeholder = state.surface.querySelector(".html-preview-parked");
	if (!placeholder) return;
	placeholder.remove();
	state.surface.appendChild(createHtmlPreviewIframe(state.html));
}

function untrackPreview(node: CanvasNode): void {
	const state = previewsByNode.get(node);
	if (!state) return;
	clearTimeout(state.timer);
	const group = previewObservers.get(state.root);
	group?.observer.unobserve(state.container);
	group?.states.delete(state);
	previewsByNode.delete(node);
	previewsByContainer.delete(state.container);
}

function disconnectPreviewObserver(root: HTMLElement): void {
	const group = previewObservers.get(root);
	if (!group) return;
	group.observer.disconnect();
	for (const state of group.states) {
		parkPreview(state);
		untrackPreview(state.node);
	}
	previewObservers.delete(root);
}

function trackPreview(node: CanvasNode, container: HTMLElement, surface: HTMLElement, html: string): void {
	const root = node.canvas?.wrapperEl;
	if (!root || typeof IntersectionObserver === "undefined") return;
	let group = previewObservers.get(root);
	if (!group) {
		const observer = new IntersectionObserver(entries => {
			for (const entry of entries) {
				const state = previewsByContainer.get(entry.target);
				if (!state) continue;
				state.visible = entry.isIntersecting;
				if (state.node.isContentMounted === false || state.node.initialized === false) parkPreview(state);
				else if (state.visible) resumePreview(state);
				else if (state.timer === undefined) state.timer = setTimeout(() => parkPreview(state), 3000);
			}
		}, { root });
		group = { observer, states: new Set() };
		previewObservers.set(root, group);
	}
	const state: PreviewState = { node, container, surface, html, root, visible: true };
	previewsByNode.set(node, state);
	previewsByContainer.set(container, state);
	group.states.add(state);
	group.observer.observe(container);
	if (node.isContentMounted === false || node.initialized === false) parkPreview(state);
}

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

function removeHtmlPreviewFromNode(node: CanvasNode): void {
	untrackPreview(node);
	node.contentEl?.querySelector(".html-preview-card-ui")?.remove();
	node.contentEl?.removeClass("html-preview-card");
	node.contentEl?.querySelectorAll<HTMLElement>(".markdown-embed-content").forEach(host => {
		host.removeClass("html-preview-code-hidden");
		host.removeClass("html-preview-code-pane");
	});
	htmlPreviewModes.delete(node.id);
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
	untrackPreview(node);
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
	trackPreview(node, container, renderSurface, htmlBlocks[0].content);

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
const canvasNodesByElement = new WeakMap<Element, CanvasNode>();

export function restoreHtmlPreviewForNode(node: CanvasNode, defaultRender = false): void {
	if (node.nodeEl) canvasNodesByElement.set(node.nodeEl, node);
	const preview = previewsByNode.get(node);
	if (node.isContentMounted === false || node.initialized === false) {
		if (preview) parkPreview(preview);
		return;
	}
	if (preview?.visible) resumePreview(preview);
	const nodeData = node.getData?.();
	if (nodeData?.type === "text") {
		const text = node.text || "";
		if (lastScannedText.get(node) !== text) {
			lastScannedText.set(node, text);
			scannedHtmlBlocks.set(node, extractHtmlCodeBlocks(text));
		}
		const htmlBlocks = scannedHtmlBlocks.get(node) ?? [];
		if (htmlBlocks.length === 0) {
			removeHtmlPreviewFromNode(node);
		} else if (!node.contentEl?.querySelector(".html-preview-card-ui")) {
			addHtmlPreviewToNode(node, htmlBlocks, defaultRender);
		}
	}
}

export function restoreHtmlPreviews(canvas: any, defaultRender = false): void {
	if (!canvas?.nodes) return;
	canvas.nodes.forEach((node: CanvasNode) => restoreHtmlPreviewForNode(node, defaultRender));
}

/**
 * Set up canvas event listeners to restore HTML previews
 */
export function setupHtmlPreviewPersistence(app: any, getDefaultRender: () => boolean): () => void {
	let restoreTimer: ReturnType<typeof setTimeout> | undefined;
	let observer: MutationObserver | undefined;
	let observedRoot: HTMLElement | null = null;
	const registeredRoots = new WeakSet<HTMLElement>();

	const getActiveCanvas = () => {
		const view = app.workspace.activeLeaf?.view;
		return view?.getViewType?.() === "canvas" ? view.canvas : null;
	};

	const runRestore = () => {
		restoreTimer = undefined;
		const canvas = getActiveCanvas();
		if (!canvas) return;

		if (canvas.wrapperEl && canvas.wrapperEl !== observedRoot) {
			const root = canvas.wrapperEl;
			if (!registeredRoots.has(root)) {
				app.workspace.activeLeaf?.view?.register?.(() => {
					if (observedRoot === root) {
						clearTimeout(restoreTimer);
						restoreTimer = undefined;
						observer?.disconnect();
						observedRoot = null;
					}
					disconnectPreviewObserver(root);
				});
				registeredRoots.add(root);
			}
			observer?.disconnect();
			observer = new MutationObserver(records => {
				const addedCards = new Set<Element>();
				for (const record of records) {
					for (const removed of Array.from(record.removedNodes ?? [])) {
						if (removed.nodeType !== 1) continue;
						const element = removed as Element;
						const containers = Array.from(element.querySelectorAll(".html-preview-container"));
						if (element.matches(".html-preview-container")) containers.push(element);
						for (const container of containers) {
							const state = previewsByContainer.get(container);
							if (state) parkPreview(state);
						}
					}
					for (const added of Array.from(record.addedNodes)) {
						if (added.nodeType !== 1) continue;
						const element = added as Element;
						if (element.matches(".canvas-node")) addedCards.add(element);
						element.querySelectorAll(".canvas-node").forEach(card => addedCards.add(card));
					}
				}
				for (const element of addedCards) {
					// Known cards are indexed during restoration; newly created cards
					// may not expose an ID attribute, so resolve those by element identity.
					const node = canvasNodesByElement.get(element) ??
						canvas.nodes.get?.(element.getAttribute("data-node-id")) ??
						Array.from(canvas.nodes.values()).find((candidate: any) => candidate.nodeEl === element);
					if (node) restoreHtmlPreviewForNode(node, getDefaultRender());
				}
			});
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
		for (const root of previewObservers.keys()) disconnectPreviewObserver(root);
		closeHtmlPreviewWindows();
		app.workspace.off("active-leaf-change", restoreForActiveCanvas);
		app.workspace.off("layout-change", scheduleRestore);
	};
}
