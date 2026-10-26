import { App, ButtonComponent, Notice } from "obsidian";
import { around } from "monkey-around";
import { Canvas, CanvasNode } from "../obsidian/canvas-internal";
import { addEdge } from "../obsidian/canvas-patches";
import { randomHexString } from "../utils";
import { HttpRequestModal } from "../Modals/HttpRequestModal";
import { buildHttpRequest, executeHttpRequest, formatHttpRequest, formatHttpResponse, getHttpRequest, httpCodeBlock, HttpRequestConfig } from "./httpRequest";

const nodesIn = (canvas: Canvas): CanvasNode[] => Array.from(canvas.nodes.values());
const contains = (node: CanvasNode) => nodesIn(node.canvas).includes(node);

/** HTTP cards have no dependency on providers or generation settings. */
export class HttpRequestCards {
	private disposed = false;
	private active = new Map<string, { output: CanvasNode; started: number; timer: ReturnType<typeof setInterval> }>();
	private fileKeys = new WeakMap<object, string>();
	private sessionId = randomHexString(16);
	private toolbars = new Map<CanvasNode, HTMLElement>();
	private editPatches = new Map<CanvasNode, () => void>();
	private cleanups: Array<() => void> = [];

	constructor(private app: App, private execute = executeHttpRequest) {}

	private requestKey(canvas: Canvas, nodeId: string): string {
		// Panes share their TFile object, which survives renames; paths do not.
		const file = canvas.view?.file ?? canvas;
		const key = this.fileKeys.get(file) ?? randomHexString(16);
		this.fileKeys.set(file, key);
		return JSON.stringify([key, nodeId]);
	}

	edit(canvas: Canvas, node?: CanvasNode) {
		if (this.disposed || (node && this.active.has(this.requestKey(canvas, node.id)))) return;
		if (canvas.readonly) { new Notice("This canvas is read-only."); return; }
		const initial = node ? getHttpRequest(node.getData() as unknown as Record<string, unknown>) : undefined;
		new HttpRequestModal(this.app, initial ?? undefined, config => this.save(canvas, config, node)).open();
	}

	save(canvas: Canvas, config: HttpRequestConfig, existing?: CanvasNode): CanvasNode {
		if (this.disposed) throw new Error("The HTTP request editor was unloaded. Open it again.");
		if (canvas.readonly) throw new Error("This canvas is read-only.");
		const text = formatHttpRequest(config);
		if (existing && !contains(existing)) throw new Error("The request card was removed.");
		const node = existing ?? canvas.createTextNode({
			pos: { x: (canvas as any).x, y: (canvas as any).y },
			size: { width: 480, height: 400 }, text, focus: false,
		});
		if (!existing) canvas.addNode(node);
		node.setData({ ...node.getData(), text, http_request: { ...config } } as any);
		this.mount(node);
		void canvas.requestSave();
		return node;
	}

	async send(node: CanvasNode): Promise<void> {
		const key = this.requestKey(node.canvas, node.id);
		if (this.disposed || this.active.has(key) || !contains(node)) return;
		if (node.canvas.readonly) { new Notice("This canvas is read-only."); return; }
		const config = getHttpRequest(node.getData() as unknown as Record<string, unknown>);
		if (!config) return;
		try { buildHttpRequest(config); }
		catch (error) { new Notice(error instanceof Error ? error.message : String(error)); return; }
		const canvas = node.canvas;
		const siblings = canvas.getEdgesForNode(node).filter(edge => edge.from.node.id === node.id).map(edge => edge.to.node).filter(Boolean);
		const top = Math.max(node.y, ...siblings.map(sibling => sibling.y + sibling.height + 30));
		const output = canvas.createTextNode({
			pos: { x: node.x + node.width + 60 + 280, y: top }, position: "top",
			size: { width: 560, height: 480 }, text: "## HTTP response\n\nSending request…", focus: false,
		});
		canvas.addNode(output);
		output.setData({ ...output.getData(), http_response: { requestNodeId: node.id, state: "pending", sessionId: this.sessionId } } as any);
		addEdge(canvas, randomHexString(16), { fromOrTo: "from", side: "right", node }, { fromOrTo: "to", side: "left", node: output }, "Response", { isGenerated: false });
		const state = { output, started: Date.now(), timer: setInterval(() => this.updateRequestToolbars(key), 1000) };
		this.active.set(key, state);
		this.updateRequestToolbars(key);
		void canvas.requestSave();
		try {
			const response = await this.execute(config);
			if (this.disposed || !contains(output)) return;
			await output.setText(formatHttpResponse(response));
			output.setData({ ...output.getData(), http_response: { requestNodeId: node.id, state: "complete", status: response.status, elapsedMs: response.elapsedMs } } as any);
		} catch (error) {
			if (this.disposed || !contains(output)) return;
			const message = error instanceof Error ? error.message : String(error);
			await output.setText(`## HTTP request failed\n\n${Date.now() - state.started} ms\n\n${httpCodeBlock(message)}`);
			output.setData({ ...output.getData(), http_response: { requestNodeId: node.id, state: "failed" } } as any);
		} finally {
			clearInterval(state.timer);
			this.active.delete(key);
			if (!this.disposed) {
				this.updateRequestToolbars(key);
				if (contains(output)) void canvas.requestSave();
			}
		}
	}

	private updateRequestToolbars(key: string) {
		for (const node of this.toolbars.keys()) if (this.requestKey(node.canvas, node.id) === key) this.updateToolbar(node);
	}

	private updateToolbar(node: CanvasNode) {
		const toolbar = this.toolbars.get(node);
		if (!toolbar) return;
		const state = this.active.get(this.requestKey(node.canvas, node.id));
		toolbar.querySelectorAll("button").forEach(button => { button.disabled = !!state || !!node.canvas.readonly; });
		const status = toolbar.querySelector<HTMLElement>("[role=status]");
		if (status) status.setText(state ? `Sending… ${Math.floor((Date.now() - state.started) / 1000)}s` : "");
	}

	mount(node: CanvasNode) {
		if (this.disposed || !getHttpRequest(node.getData() as unknown as Record<string, unknown>)) return;
		if (!this.editPatches.has(node)) {
			this.editPatches.set(node, around(node, {
				startEditing: () => () => this.edit(node.canvas, node),
			}));
		}
		if (!node.contentEl) return;
		const existing = this.toolbars.get(node);
		if (existing?.parentElement === node.contentEl) { this.updateToolbar(node); return; }
		existing?.remove();
		node.nodeEl.addClass("http-request-card");
		const toolbar = node.contentEl.createDiv({ cls: "http-request-toolbar" });
		for (const name of ["pointerdown", "mousedown", "dblclick", "keydown"]) toolbar.addEventListener(name, event => event.stopPropagation());
		const status = toolbar.createSpan();
		status.setAttribute("role", "status");
		new ButtonComponent(toolbar).setButtonText("Edit request").onClick(() => this.edit(node.canvas, node));
		new ButtonComponent(toolbar).setButtonText("Send").setCta().onClick(() => { void this.send(node); });
		this.toolbars.set(node, toolbar);
		this.updateToolbar(node);
	}

	start() {
		let observer: MutationObserver | undefined;
		let lockObserver: MutationObserver | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const refresh = () => {
			observer?.disconnect();
			lockObserver?.disconnect();
			const view = this.app.workspace.activeLeaf?.view as any;
			const canvas: Canvas | undefined = view?.getViewType?.() === "canvas" ? view.canvas : undefined;
			const openCanvases = this.app.workspace.getLeavesOfType("canvas").map(leaf => (leaf.view as any).canvas);
			for (const [node, toolbar] of this.toolbars) {
				if (!openCanvases.includes(node.canvas) || !contains(node) || !getHttpRequest(node.getData() as unknown as Record<string, unknown>)) {
					toolbar.remove();
					node.nodeEl?.removeClass("http-request-card");
					this.toolbars.delete(node);
				}
			}
			for (const [node, unpatch] of this.editPatches) {
				if (!openCanvases.includes(node.canvas) || !contains(node) || !getHttpRequest(node.getData() as any)) {
					unpatch();
					this.editPatches.delete(node);
				}
			}
			if (!canvas) return;
			nodesIn(canvas).forEach(node => {
				this.mount(node);
				const metadata = (node.getData() as any).http_response;
				if (metadata?.state === "pending" && metadata.sessionId !== this.sessionId) this.markInterrupted(node);
			});
			if (!canvas.wrapperEl) return;
			observer = new MutationObserver(records => {
				// Ignore markdown streaming and toolbar changes. Restore only when
				// Canvas adds/remounts a node or removes one of our toolbars.
				const relevant = records.some(record => [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)]
					.some(element => element.nodeType === 1 && ((element as Element).matches(".canvas-node, .canvas-node-content, .http-request-toolbar") || !!(element as Element).querySelector(".canvas-node"))));
				if (relevant) schedule();
			});
			observer.observe(canvas.wrapperEl, { childList: true, subtree: true });
			lockObserver = new MutationObserver(schedule);
			lockObserver.observe(canvas.wrapperEl, { attributes: true, attributeFilter: ["class"] });
		};
		const schedule = () => {
			clearTimeout(timer);
			timer = setTimeout(refresh, 100);
		};
		for (const event of ["active-leaf-change", "layout-change"] as const) {
			const ref = this.app.workspace.on(event as any, schedule);
			this.cleanups.push(() => this.app.workspace.offref(ref));
		}
		this.cleanups.push(() => { clearTimeout(timer); observer?.disconnect(); lockObserver?.disconnect(); });
		schedule();
	}

	private markInterrupted(output: CanvasNode) {
		if (!contains(output)) return;
		const data = output.getData() as any;
		output.setData({ ...data,
			text: "## HTTP request interrupted\n\nThe plugin was unloaded before a response was recorded. The request may still have reached the server. Check before sending it again.",
			http_response: { ...data.http_response, state: "interrupted" },
		});
		void output.canvas.requestSave();
	}

	dispose() {
		this.disposed = true;
		for (const state of this.active.values()) {
			clearInterval(state.timer);
			this.markInterrupted(state.output);
		}
		this.active.clear();
		for (const [node, toolbar] of this.toolbars) {
			toolbar.remove();
			node.nodeEl?.removeClass("http-request-card");
		}
		this.toolbars.clear();
		this.editPatches.forEach(unpatch => unpatch());
		this.editPatches.clear();
		this.cleanups.forEach(cleanup => cleanup());
	}
}
