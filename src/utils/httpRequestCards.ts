import { App, Notice, TFile } from "obsidian";
import { around } from "monkey-around";
import { Canvas, CanvasNode } from "../obsidian/canvas-internal";
import { addEdge } from "../obsidian/canvas-patches";
import { randomHexString } from "../utils";
import { createResultNote, DEFAULT_RESULT_NOTE_THRESHOLD, replaceResultCard, resultNoteData, shouldSaveResultNote } from "./resultNotes";
import { HttpRequestEditor } from "./httpRequestEditor";
import { buildHttpRequest, DEFAULT_HTTP_REQUEST, executeHttpRequest, formatHttpRequest, formatHttpResponse, getHttpRequest, httpCodeBlock, HttpRequestConfig } from "./httpRequest";

const nodesIn = (canvas: Canvas): CanvasNode[] => Array.from(canvas.nodes.values());
const contains = (node: CanvasNode) => nodesIn(node.canvas).includes(node);

/** HTTP cards have no dependency on providers or generation settings. */
export class HttpRequestCards {
	private disposed = false;
	private active = new Map<string, { output: CanvasNode; started: number; timer: ReturnType<typeof setInterval> }>();
	private fileKeys = new WeakMap<object, string>();
	private sessionId = randomHexString(16);
	private editors = new Map<CanvasNode, HttpRequestEditor>();
	private creationMenuPatched = false;
	private editPatches = new Map<CanvasNode, () => void>();
	private cleanups: Array<() => void> = [];

	constructor(private app: App, private execute = executeHttpRequest, private noteThreshold = () => DEFAULT_RESULT_NOTE_THRESHOLD) {}

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
		if (!node) { this.create(canvas); return; }
		this.mount(node);
		this.editors.get(node)?.focus();
	}

	create(canvas: Canvas, position?: { x: number; y: number }): CanvasNode {
		const node = this.save(canvas, { ...DEFAULT_HTTP_REQUEST }, undefined, position);
		canvas.selectOnly(node, false);
		this.editors.get(node)?.focus();
		return node;
	}

	save(canvas: Canvas, config: HttpRequestConfig, existing?: CanvasNode, position?: { x: number; y: number }): CanvasNode {
		if (this.disposed) throw new Error("The HTTP request editor was unloaded. Open it again.");
		if (canvas.readonly) throw new Error("This canvas is read-only.");
		const text = formatHttpRequest(config);
		if (existing && !contains(existing)) throw new Error("The request card was removed.");
		const node = existing ?? canvas.createTextNode({
			pos: position ?? { x: (canvas as any).x - 280, y: (canvas as any).y - 260 },
			size: { width: 560, height: 520 }, text, focus: false,
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
		catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const editor = this.editors.get(node);
			if (editor) editor.setError(message); else new Notice(message);
			return;
		}
		const canvas = node.canvas;
		const file = canvas.view?.file;
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
			if (this.disposed) return;
			await this.writeResponse(output, file, formatHttpResponse(response), {
				requestNodeId: node.id, state: "complete", status: response.status, elapsedMs: response.elapsedMs,
			});
		} catch (error) {
			if (this.disposed) return;
			const message = error instanceof Error ? error.message : String(error);
			await this.writeResponse(output, file,
				`## HTTP request failed\n\n${Date.now() - state.started} ms\n\n${httpCodeBlock(message)}`,
				{ requestNodeId: node.id, state: "failed" });
		} finally {
			clearInterval(state.timer);
			this.active.delete(key);
			if (!this.disposed) {
				this.updateRequestToolbars(key);
				if (contains(output)) void canvas.requestSave();
			}
		}
	}

	private async writeResponse(output: CanvasNode, file: { path: string } | null | undefined, text: string, metadata: Record<string, unknown>) {
		await this.writeInlineResponse(output, file, text, metadata);
		if (this.disposed || !shouldSaveResultNote(text, this.noteThreshold())) return;
		try {
			await this.saveResponseNote(output, file, text, metadata);
		} catch (error) {
			new Notice(`Could not save the response as a note. The result is still in the canvas: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private responseLocation(output: CanvasNode, file: { path: string } | null | undefined) {
		const nodes: CanvasNode[] = [];
		let loaded = false;
		for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
			if ((leaf.view as any)?._loaded === false) continue;
			const canvas = (leaf.view as any)?.canvas as Canvas | undefined;
			if (!canvas || (file ? canvas.view?.file !== file : canvas !== output.canvas)) continue;
			loaded = true;
			const node = nodesIn(canvas).find(node => node.id === output.id);
			if (node) nodes.push(node);
		}
		return { nodes, loaded };
	}

	private async saveResponseNote(output: CanvasNode, file: { path: string } | null | undefined, text: string, metadata: Record<string, unknown>) {
		const eligible = (data: any) => data?.id === output.id && data.type === "text" && data.text === text
			&& data.http_response?.requestNodeId === metadata.requestNodeId && data.http_response?.state === metadata.state;
		const first = this.responseLocation(output, file);
		if (first.loaded) {
			if (!first.nodes.some(node => eligible(node.getData()))) return;
		} else {
			if (!file || this.app.vault.getAbstractFileByPath(file.path) !== file) return;
			const data = JSON.parse(await this.app.vault.read(file as TFile));
			if (!data.nodes?.some(eligible)) return;
		}
		if (this.disposed) return;
		const note = await createResultNote(this.app, text, file?.path, "HTTP response");
		// The note is an ordinary vault file from here on. Keep it even if its
		// card is deleted or conversion fails; the user may already be editing it.
		if (this.disposed) return;
		const current = this.responseLocation(output, file);
		if (current.loaded) {
			for (const node of current.nodes) {
				if (eligible(node.getData())) replaceResultCard(node, resultNoteData(node.getData(), note.path));
			}
		} else if (file && this.app.vault.getAbstractFileByPath(file.path) === file) {
			await this.app.vault.process(file as TFile, contents => {
				if (this.disposed) return contents;
				const data = JSON.parse(contents);
				const index = data.nodes?.findIndex(eligible);
				if (index == null || index < 0) return contents;
				data.nodes[index] = resultNoteData(data.nodes[index], note.path);
				return JSON.stringify(data, null, "\t");
			});
		}
	}

	private async writeInlineResponse(output: CanvasNode, file: { path: string } | null | undefined, text: string, metadata: Record<string, unknown>) {
		// Views and node objects are replaced on navigation. Resolve the output
		// again by stable file identity and node ID instead of using an orphan.
		const location = this.responseLocation(output, file);
		const targets = new Set(location.nodes.filter(node => (node.getData() as any).http_response?.requestNodeId === metadata.requestNodeId));
		if (targets.size) {
			for (const node of targets) {
				void node.setText(text);
				node.setData({ ...node.getData(), text, http_response: metadata } as any);
				void node.canvas.requestSave();
			}
			return;
		}
		if (location.loaded) return; // The output was deleted in the live document.
		// All views may be closed. Update only the original pending output in
		// the file; never recreate a deleted card or overwrite unrelated edits.
		if (!file || this.app.vault?.getAbstractFileByPath(file.path) !== file) return;
		try {
			await this.app.vault.process(file as TFile, contents => {
				if (this.disposed) return contents;
				const data = JSON.parse(contents);
				const node = data.nodes?.find((node: any) => node.id === output.id
					&& node.http_response?.requestNodeId === metadata.requestNodeId
					&& node.http_response?.sessionId === this.sessionId
					&& node.http_response?.state === "pending");
				if (!node) return contents;
				node.text = text;
				node.http_response = metadata;
				return JSON.stringify(data, null, "\t");
			});
		} catch (error) {
			new Notice(`HTTP request finished, but its response could not be saved: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private updateRequestToolbars(key: string) {
		for (const node of this.editors.keys()) if (this.requestKey(node.canvas, node.id) === key) this.updateToolbar(node);
	}

	private updateToolbar(node: CanvasNode) {
		const editor = this.editors.get(node);
		const config = getHttpRequest(node.getData() as any);
		if (!editor || !config) return;
		const state = this.active.get(this.requestKey(node.canvas, node.id));
		editor.update(config, !!state || !!node.canvas.readonly,
			state ? `Sending… ${Math.floor((Date.now() - state.started) / 1000)}s` : "");
	}

	mount(node: CanvasNode) {
		if (this.disposed || !getHttpRequest(node.getData() as unknown as Record<string, unknown>)) return;
		if (!this.editPatches.has(node)) {
			this.editPatches.set(node, around(node, {
				startEditing: () => () => this.edit(node.canvas, node),
			}));
		}
		if (!node.contentEl || !node.nodeEl || !node.containerEl) return;
		const existing = this.editors.get(node);
		if (existing?.root.parentElement === node.containerEl) { this.updateToolbar(node); return; }
		existing?.destroy();
		node.nodeEl.addClass("http-request-card");
		const config = getHttpRequest(node.getData() as any)!;
		const editor = new HttpRequestEditor(node.containerEl, config,
			value => this.save(node.canvas, value, node), () => { void this.send(node); });
		this.editors.set(node, editor);
		this.updateToolbar(node);
	}

	private patchCreationMenu(canvas: Canvas) {
		if (this.creationMenuPatched) return;
		const proto = Object.getPrototypeOf(canvas);
		if (typeof proto?.showCreationMenu !== "function") return;
		const create = this.create.bind(this);
		this.cleanups.push(around(proto, {
			showCreationMenu: (next: any) => function (this: Canvas, menu: any, position: { x: number; y: number }, ...args: any[]) {
				const result = next.call(this, menu, position, ...args);
				menu.addItem((item: any) => item.setTitle("Add HTTP request").setSection("create").setIcon("lucide-globe")
					.onClick(() => { if (!this.readonly) create(this, position); }));
				return result;
			},
		}));
		this.creationMenuPatched = true;
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
			const openCanvases: Canvas[] = this.app.workspace.getLeavesOfType("canvas").map(leaf => (leaf.view as any).canvas).filter(Boolean);
			openCanvases.forEach(open => this.patchCreationMenu(open));
			for (const [node, editor] of this.editors) {
				if (!openCanvases.includes(node.canvas) || !contains(node) || !getHttpRequest(node.getData() as unknown as Record<string, unknown>)) {
					editor.destroy();
					node.nodeEl?.removeClass("http-request-card");
					this.editors.delete(node);
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
				// Canvas adds/remounts a node or removes one of our editors.
				const relevant = records.some(record => [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)]
					.some(element => element.nodeType === 1 && ((element as Element).matches(".canvas-node, .canvas-node-content, .http-request-editor") || !!(element as Element).querySelector(".canvas-node"))));
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
		if (data.http_response?.state !== "pending") return;
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
		for (const [node, editor] of this.editors) {
			editor.destroy();
			node.nodeEl?.removeClass("http-request-card");
		}
		this.editors.clear();
		this.editPatches.forEach(unpatch => unpatch());
		this.editPatches.clear();
		this.cleanups.forEach(cleanup => cleanup());
	}
}
