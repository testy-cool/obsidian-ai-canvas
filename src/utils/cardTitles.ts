import { App, Notice, TextComponent } from "obsidian";
import { around } from "monkey-around";
import { Canvas, CanvasNode } from "../obsidian/canvas-internal";

const labels = new WeakMap<CanvasNode, HTMLElement>();
const hiddenLabels = new WeakMap<CanvasNode, { element: HTMLElement; display: string }>();
const editing = new WeakSet<CanvasNode>();
const editCallbacks = new WeakMap<CanvasNode, () => void>();
const boundHeadings = new WeakSet<HTMLElement>();
const nodesIn = (canvas: Canvas): CanvasNode[] => Array.from(canvas.nodes.values());

export function getCanvasCardTitle(node: CanvasNode): string {
	const data = node.getData() as any;
	const value = data.type === "group" ? data.label : data.ai_card_title;
	return typeof value === "string" ? value.trim() : "";
}

function restoreNativeLabel(node: CanvasNode) {
	const saved = hiddenLabels.get(node);
	if (saved) saved.element.style.display = saved.display;
	hiddenLabels.delete(node);
}

function hideNativeLabel(node: CanvasNode) {
	if (!node.labelEl) return;
	if (!hiddenLabels.has(node)) hiddenLabels.set(node, { element: node.labelEl, display: node.labelEl.style.display });
	node.labelEl.style.display = "none";
}

function titleLabel(node: CanvasNode): HTMLElement {
	let label = labels.get(node);
	if (label?.parentElement === node.nodeEl) return label;
	label?.remove();
	label = node.nodeEl.createDiv({ cls: "canvas-node-label canvas-card-title" });
	label.addEventListener("pointerdown", event => {
		if (!editing.has(node)) (node as any).onPointerdown?.(event);
	});
	label.addEventListener("dblclick", event => {
		if (editing.has(node)) return;
		event.stopPropagation();
		editCallbacks.get(node)?.();
	});
	labels.set(node, label);
	return label;
}

export function renderCanvasCardTitle(node: CanvasNode): void {
	if (!node.nodeEl || editing.has(node)) return;
	const data = node.getData() as any;
	if (data.type === "group" && (node.isEditing || node.labelEl?.isContentEditable)) return;
	const legacy = node.nodeEl.querySelector(".ai-card-title");
	if (legacy) {
		legacy.remove();
		node.nodeEl.removeClass("ai-card-title-host");
		if (node.labelEl) node.labelEl.style.display = "";
	}
	const title = getCanvasCardTitle(node);
	const heading = node.nodeEl.querySelector(".http-request-heading")?.querySelector<HTMLElement>("h3");
	if (heading && data.http_request) {
		labels.get(node)?.remove();
		labels.delete(node);
		restoreNativeLabel(node);
		if (heading.textContent !== (title || "HTTP request")) heading.setText(title || "HTTP request");
		if (!boundHeadings.has(heading)) {
			heading.addEventListener("dblclick", event => {
				if (editing.has(node)) return;
				event.stopPropagation();
				editCallbacks.get(node)?.();
			});
			boundHeadings.add(heading);
		}
		return;
	}
	if (data.type === "group" || !title || data.http_request) {
		labels.get(node)?.remove();
		labels.delete(node);
		restoreNativeLabel(node);
		if (data.type === "group" && node.labelEl && node.labelEl.textContent !== title) node.labelEl.setText(title);
		return;
	}
	const label = titleLabel(node);
	if (label.textContent !== title) label.setText(title);
	label.setAttribute("title", title);
	hideNativeLabel(node);
}

/** Manual naming and AI naming share persistence, but this never calls a model. */
export function setCanvasCardTitle(node: CanvasNode, value: string): void {
	if (node.canvas.readonly) throw new Error("This canvas is read-only.");
	if (!nodesIn(node.canvas).includes(node)) throw new Error("The card was removed.");
	const data = node.getData() as any;
	const title = value.replace(/\s+/g, " ").trim();
	if (data.type === "group") {
		node.setData({ ...data, label: title });
		(node as any).label = title;
	} else node.setData({ ...data, ai_card_title: title } as any);
	renderCanvasCardTitle(node);
	void node.canvas.requestSave();
	void node.canvas.requestFrame();
}

function cleanupTitle(node: CanvasNode) {
	labels.get(node)?.remove();
	labels.delete(node);
	restoreNativeLabel(node);
	const heading = node.nodeEl?.querySelector(".http-request-heading")?.querySelector<HTMLElement>("h3");
	if (heading) heading.setText("HTTP request");
	editCallbacks.delete(node);
}

export class CanvasCardTitles {
	private disposed = false;
	private known = new Set<CanvasNode>();
	private dataPatches = new Map<CanvasNode, () => void>();
	private inputs = new Map<CanvasNode, { input: HTMLInputElement; original: string }>();
	private cleanups: Array<() => void> = [];
	private byElement = new WeakMap<Element, CanvasNode>();

	constructor(private app: App) {}

	edit(node: CanvasNode) {
		if (this.disposed) return;
		if (node.canvas.readonly) { new Notice("This canvas is read-only."); return; }
		if (!node.nodeEl || !nodesIn(node.canvas).includes(node)) return;
		const existing = this.inputs.get(node);
		if (existing) { existing.input.focus(); return; }
		this.remember(node);
		const original = getCanvasCardTitle(node);
		const heading = node.nodeEl.querySelector(".http-request-heading")?.querySelector<HTMLElement>("h3");
		const host = (node.getData() as any).http_request && heading ? heading : titleLabel(node);
		editing.add(node);
		if (host !== heading) hideNativeLabel(node);
		host.empty();
		const input = new TextComponent(host).setValue(original).setPlaceholder("Card title")
			.onChange(value => {
				try { setCanvasCardTitle(node, value); }
				catch (error) { new Notice(error instanceof Error ? error.message : String(error)); this.finish(node, true); }
			}).inputEl;
		input.addClass("canvas-card-title-input");
		input.setAttribute("aria-label", "Card title");
		for (const event of ["pointerdown", "mousedown", "click", "dblclick"]) input.addEventListener(event, event => event.stopPropagation());
		input.addEventListener("keydown", event => {
			event.stopPropagation();
			if (event.key === "Enter" || event.key === "Escape") {
				event.preventDefault();
				this.finish(node, event.key === "Escape");
			}
		});
		input.addEventListener("blur", () => this.finish(node));
		this.inputs.set(node, { input, original });
		input.focus();
		input.select();
	}

	private finish(node: CanvasNode, cancel = false) {
		const state = this.inputs.get(node);
		if (!state) return;
		this.inputs.delete(node);
		if (cancel && !node.canvas.readonly && nodesIn(node.canvas).includes(node)) setCanvasCardTitle(node, state.original);
		editing.delete(node);
		state.input.remove();
		renderCanvasCardTitle(node);
	}

	private remember(node: CanvasNode) {
		if (!this.dataPatches.has(node)) {
			this.dataPatches.set(node, around(node, {
				setData: next => function (this: CanvasNode, ...args: Parameters<CanvasNode["setData"]>) {
					const result = next.apply(this, args);
					renderCanvasCardTitle(this);
					return result;
				},
			}));
		}
		this.known.add(node);
		if (node.nodeEl) this.byElement.set(node.nodeEl, node);
		editCallbacks.set(node, () => this.edit(node));
	}

	start() {
		const observers = new Map<Canvas, MutationObserver>();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const refresh = () => {
			const canvases = new Set<Canvas>(this.app.workspace.getLeavesOfType("canvas").map(leaf => (leaf.view as any).canvas).filter(Boolean));
			for (const node of this.known) {
				if (!canvases.has(node.canvas) || !nodesIn(node.canvas).includes(node)) {
					this.finish(node);
					cleanupTitle(node);
					this.dataPatches.get(node)?.();
					this.dataPatches.delete(node);
					this.known.delete(node);
				}
			}
			for (const [canvas, observer] of observers) if (!canvases.has(canvas)) { observer.disconnect(); observers.delete(canvas); }
			for (const canvas of canvases) {
				for (const node of nodesIn(canvas)) { this.remember(node); renderCanvasCardTitle(node); }
				if (!canvas.wrapperEl || observers.has(canvas)) continue;
				const observer = new MutationObserver(records => {
					for (const record of records) {
						const target = record.target instanceof Element ? record.target : record.target.parentElement;
						if (target?.closest(".canvas-node-label, .canvas-group-label, .http-request-heading")) {
							const element = target.closest(".canvas-node");
							const node = element && this.byElement.get(element);
							if (node) renderCanvasCardTitle(node);
						}
						for (const added of Array.from(record.addedNodes)) {
							if (added.nodeType !== 1) continue;
							const element = added as Element;
							if (element.matches(".canvas-node, .canvas-node-container, .canvas-node-content, .canvas-node-label, .canvas-group-label, .http-request-editor") || element.querySelector(".canvas-node")) schedule();
						}
					}
				});
				observer.observe(canvas.wrapperEl, { childList: true, subtree: true });
				observers.set(canvas, observer);
			}
		};
		const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 100); };
		for (const name of ["active-leaf-change", "layout-change"] as const) {
			const ref = this.app.workspace.on(name as any, schedule);
			this.cleanups.push(() => this.app.workspace.offref(ref));
		}
		this.cleanups.push(() => { clearTimeout(timer); observers.forEach(observer => observer.disconnect()); });
		schedule();
	}

	dispose() {
		this.disposed = true;
		this.cleanups.forEach(cleanup => cleanup());
		for (const node of this.known) { this.finish(node); cleanupTitle(node); }
		this.known.clear();
		this.dataPatches.forEach(unpatch => unpatch());
		this.dataPatches.clear();
	}
}
