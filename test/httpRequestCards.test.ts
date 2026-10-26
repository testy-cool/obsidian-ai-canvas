import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpRequestCards } from "../src/utils/httpRequestCards";
import { DEFAULT_HTTP_REQUEST } from "../src/utils/httpRequest";
import { restoreHtmlPreviews } from "../src/utils/htmlPreview";

function fixture() {
	let count = 0;
	const nodes = new Map<string, any>();
	let edges: any[] = [];
	const canvas: any = {
		x: 0, y: 0, nodes,
		createTextNode: vi.fn((options: any) => {
			let data: any = { id: `node-${++count}`, type: "text", text: options.text, x: options.pos.x, y: options.pos.y, width: options.size.width, height: options.size.height };
			const node: any = {
				canvas, ...data, unknownData: {}, startEditing: vi.fn(),
				getData: () => ({ ...data }),
				setData: (next: any) => { data = { ...data, ...next }; Object.assign(node, next); },
				setText: async (text: string) => { data.text = text; node.text = text; },
			};
			nodes.set(node.id, node);
			return node;
		}),
		addNode: vi.fn(), deselectAll: vi.fn(), selectOnly: vi.fn(), requestSave: vi.fn(), requestFrame: vi.fn(),
		getEdgesForNode: (node: any) => edges.filter(edge => edge.fromNode === node.id || edge.toNode === node.id).map(edge => ({ from: { node: nodes.get(edge.fromNode) }, to: { node: nodes.get(edge.toNode) } })),
		getData: () => ({ nodes: [...nodes.values()].map(node => node.getData()), edges }),
		importData: (next: any) => { edges = next.edges; },
	};
	const app: any = { workspace: { activeLeaf: { view: { canvas, getViewType: () => "canvas" } }, on: vi.fn(), offref: vi.fn(), getLeavesOfType: () => [{ view: { canvas } }] } };
	return { app, canvas, nodes };
}
const request = { ...DEFAULT_HTTP_REQUEST, url: "https://example.com/items" };
const response = { status: 200, headers: { "content-type": "application/json" }, text: '{"ok":true}', elapsedMs: 5 };
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("standalone canvas HTTP interactions", () => {
	it("adds the HTTP action to the native background creation menu and removes the patch on unload", async () => {
		vi.useFakeTimers();
		vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
		class CanvasWithMenu { showCreationMenu(menu: any) { menu.addItem((item: any) => item.setTitle("Add card")); } }
		const { app, canvas } = fixture();
		Object.setPrototypeOf(canvas, CanvasWithMenu.prototype);
		app.workspace.getLeavesOfType = () => [{ view: { canvas } }];
		const cards = new HttpRequestCards(app);
		const items: any[] = [];
		const menu = { addItem(callback: (item: any) => void) {
			const item = { title: "", click: () => {}, setTitle(value: string) { this.title = value; return this; }, setSection() { return this; }, setIcon() { return this; }, onClick(fn: () => void) { this.click = fn; return this; } };
			callback(item); items.push(item); return this;
		} };
		cards.start();
		await vi.advanceTimersByTimeAsync(100);
		canvas.showCreationMenu(menu, { x: 120, y: 250 });
		expect(items.map(item => item.title)).toEqual(["Add card", "Add HTTP request"]);
		items[1].click();
		expect(canvas.createTextNode.mock.calls[0][0].pos).toEqual({ x: 120, y: 250 });
		cards.dispose();
		items.length = 0;
		canvas.showCreationMenu(menu, { x: 0, y: 0 });
		expect(items.map(item => item.title)).toEqual(["Add card"]);
	});

	it("adds an unfinished request card immediately at the chosen position without a modal or network call", () => {
		const { app, canvas } = fixture();
		const send = vi.fn();
		const cards = new HttpRequestCards(app, send);
		const node = cards.create(canvas, { x: 100, y: 200 });
		expect(node.getData().http_request).toEqual(DEFAULT_HTTP_REQUEST);
		expect(canvas.createTextNode.mock.calls[0][0].pos).toEqual({ x: 100, y: 200 });
		expect(node.getData().text).toContain("HTTP request");
		expect(send).not.toHaveBeenCalled();
		cards.save(canvas, { ...DEFAULT_HTTP_REQUEST, url: "https://", headers: "X-Partial" }, node);
		expect(node.getData().http_request.headers).toBe("X-Partial");
		cards.dispose();
	});

	it("saving a card does not send it; send creates an ordinary response edge and readable output", async () => {
		const { app, canvas } = fixture();
		const send = vi.fn(async () => response);
		const cards = new HttpRequestCards(app, send);
		const node = cards.save(canvas, request);
		expect(send).not.toHaveBeenCalled();
		expect(node.getData().http_request).toEqual(request);
		await cards.send(node);
		expect(send).toHaveBeenCalledWith(request);
		const data = canvas.getData();
		expect(data.nodes).toHaveLength(2);
		expect(data.nodes[1].text).toContain('"ok": true');
		expect(data.edges[0]).toMatchObject({ fromNode: node.id, toNode: data.nodes[1].id, isGenerated: false });
		expect(data.nodes[1]).not.toHaveProperty("ai_provider");
		cards.dispose();
	});

	it("suppresses duplicate sends while running, but retains each completed response", async () => {
		const { app, canvas } = fixture();
		let finish!: (value: typeof response) => void;
		const send = vi.fn(() => new Promise<typeof response>(resolve => { finish = resolve; }));
		const cards = new HttpRequestCards(app, send);
		const node = cards.save(canvas, request);
		const first = cards.send(node);
		await cards.send(node);
		expect(send).toHaveBeenCalledOnce();
		finish(response);
		await first;
		const second = cards.send(node);
		finish(response);
		await second;
		expect(canvas.getData().nodes).toHaveLength(3);
		cards.dispose();
	});

	it("writes network errors onto the output card and allows an explicit retry", async () => {
		const { app, canvas } = fixture();
		const send = vi.fn().mockRejectedValueOnce(new Error("Connection refused")).mockResolvedValueOnce(response);
		const cards = new HttpRequestCards(app, send);
		const node = cards.save(canvas, request);
		await cards.send(node);
		expect(canvas.getData().nodes[1].text).toContain("Connection refused");
		await cards.send(node);
		expect(canvas.getData().nodes[2].text).toContain("HTTP 200");
		cards.dispose();
	});

	it("records a pending response on the new node objects after switching away and reopening the canvas", async () => {
		const first = fixture();
		const second = fixture();
		const file = { path: "requests.canvas" };
		first.canvas.view = second.canvas.view = { file };
		let finish!: (value: typeof response) => void;
		const cards = new HttpRequestCards(first.app, () => new Promise<typeof response>(resolve => { finish = resolve; }));
		const node = cards.save(first.canvas, request);
		const pending = cards.send(node);
		const snapshot = first.canvas.getData();
		for (const data of snapshot.nodes) {
			const copy = second.canvas.createTextNode({ text: data.text, pos: { x: data.x, y: data.y }, size: { width: data.width, height: data.height } });
			copy.setData(data);
		}
		first.nodes.clear();
		first.app.workspace.getLeavesOfType = () => [{ view: { canvas: second.canvas } }];
		finish(response);
		await pending;
		const output = [...second.nodes.values()].find(n => n.getData().http_response);
		expect(output.getData().http_response).toMatchObject({ state: "complete", status: 200 });
		expect(output.text).toContain('"ok": true');
		cards.dispose();
	});

	it("does not restore a deleted output from stale disk content while its canvas is still open", async () => {
		const { app, canvas, nodes } = fixture();
		const file = { path: "requests.canvas" };
		canvas.view = { file };
		let contents = "";
		app.vault = { getAbstractFileByPath: () => file, process: vi.fn(async (_file: any, update: (text: string) => string) => { contents = update(contents); }) };
		let finish!: (value: typeof response) => void;
		const cards = new HttpRequestCards(app, () => new Promise<typeof response>(resolve => { finish = resolve; }));
		const source = cards.save(canvas, request);
		const pending = cards.send(source);
		contents = JSON.stringify(canvas.getData());
		const output = [...nodes.values()].find(n => n.getData().http_response);
		nodes.delete(output.id);
		finish(response);
		await pending;
		expect(app.vault.process).not.toHaveBeenCalled();
		expect(nodes.has(output.id)).toBe(false);
		cards.dispose();
	});

	it("persists a response atomically into the canvas file when every view has closed", async () => {
		const { app, canvas, nodes } = fixture();
		const file = { path: "requests.canvas" };
		canvas.view = { file };
		let contents = "";
		app.vault = {
			getAbstractFileByPath: (path: string) => path === file.path ? file : null,
			process: vi.fn(async (_file: any, update: (value: string) => string) => { contents = update(contents); }),
		};
		let finish!: (value: typeof response) => void;
		const cards = new HttpRequestCards(app, () => new Promise<typeof response>(resolve => { finish = resolve; }));
		const node = cards.save(canvas, request);
		const pending = cards.send(node);
		contents = JSON.stringify({ ...canvas.getData(), custom: "preserved" });
		nodes.clear();
		app.workspace.getLeavesOfType = () => [];
		file.path = "renamed.canvas";
		finish(response);
		await pending;
		const data = JSON.parse(contents);
		expect(data.custom).toBe("preserved");
		expect(data.nodes.find((n: any) => n.http_response)).toMatchObject({ http_response: { state: "complete", status: 200 } });
		expect(app.vault.process).toHaveBeenCalledOnce();
		cards.dispose();
	});

	it("does not resurrect deleted cards or write into another canvas after a reload", async () => {
		const { app, canvas, nodes } = fixture();
		let finish!: (value: typeof response) => void;
		const cards = new HttpRequestCards(app, () => new Promise<typeof response>(resolve => { finish = resolve; }));
		const node = cards.save(canvas, request);
		const pending = cards.send(node);
		const output = [...nodes.values()][1];
		const setText = vi.spyOn(output, "setText");
		nodes.delete(output.id);
		finish(response);
		await pending;
		expect(setText).not.toHaveBeenCalled();
		const next = cards.send(node);
		cards.dispose();
		expect([...nodes.values()].at(-1).getData().http_response.state).toBe("interrupted");
		finish(response);
		await next;
		expect(canvas.requestSave).toHaveBeenCalled();
	});

	it("routes native keyboard editing through request configuration so visible text cannot diverge from the sent request", () => {
		const { app, canvas } = fixture();
		const cards = new HttpRequestCards(app);
		const edit = vi.spyOn(cards, "edit").mockImplementation(() => {});
		const node = cards.save(canvas, request);
		node.startEditing();
		expect(edit).toHaveBeenCalledWith(canvas, node);
		cards.dispose();
		node.startEditing();
		expect(edit).toHaveBeenCalledOnce();
	});

	it("does not send or change cards when a canvas is locked", async () => {
		const { app, canvas } = fixture();
		const send = vi.fn(async () => response);
		const cards = new HttpRequestCards(app, send);
		const node = cards.save(canvas, request);
		canvas.readonly = true;
		await cards.send(node);
		expect(send).not.toHaveBeenCalled();
		expect(canvas.nodes.size).toBe(1);
		expect(() => cards.save(canvas, { ...request, url: "https://example.com/changed" }, node)).toThrow(/read.only/i);
		expect(node.getData().http_request.url).toBe(request.url);
		cards.dispose();
	});

	it("rejects saves from an editor left open across plugin unload", () => {
		const { app, canvas } = fixture();
		const cards = new HttpRequestCards(app);
		const node = cards.save(canvas, request);
		cards.dispose();
		const saves = canvas.requestSave.mock.calls.length;
		expect(() => cards.save(canvas, { ...request, url: "https://example.com/stale" }, node)).toThrow(/unloaded/i);
		expect(canvas.requestSave).toHaveBeenCalledTimes(saves);
		expect(node.getData().http_request.url).toBe(request.url);
	});

	it("shares a running request across two panes of the same canvas file", async () => {
		vi.useFakeTimers();
		vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
		const first = fixture();
		const second = fixture();
		first.canvas.view = second.canvas.view = { file: { path: "requests.canvas" } };
		let finish!: (value: typeof response) => void;
		const send = vi.fn(() => new Promise<typeof response>(resolve => { finish = resolve; }));
		const cards = new HttpRequestCards(first.app, send);
		const node = cards.save(first.canvas, request);
		const otherNode = cards.save(second.canvas, request);
		const pending = cards.send(node);
		const originalOutput = [...first.nodes.values()].at(-1);
		const copiedOutput = second.canvas.createTextNode({ text: originalOutput.text, pos: { x: 0, y: 0 }, size: { width: 560, height: 480 } });
		copiedOutput.setData(originalOutput.getData());
		first.app.workspace.activeLeaf.view.canvas = second.canvas;
		first.app.workspace.getLeavesOfType = () => [{ view: { canvas: first.canvas } }, { view: { canvas: second.canvas } }];
		cards.start();
		await vi.advanceTimersByTimeAsync(100);
		expect(copiedOutput.getData().http_response.state).toBe("pending");
		await cards.send(otherNode);
		expect(send).toHaveBeenCalledOnce();
		finish(response);
		await pending;
		cards.dispose();
		vi.unstubAllGlobals();
	});

	it("keeps duplicate suppression when the canvas file is renamed during a request", async () => {
		const { app, canvas } = fixture();
		canvas.view = { file: { path: "requests.canvas" } };
		const completions: Array<(value: typeof response) => void> = [];
		const send = vi.fn(() => new Promise<typeof response>(resolve => { completions.push(resolve); }));
		const cards = new HttpRequestCards(app, send);
		const node = cards.save(canvas, { ...request, method: "POST", body: '{"amount":100}' });
		const first = cards.send(node);
		canvas.view.file.path = "renamed.canvas";
		const duplicate = cards.send(node);
		completions.forEach(finish => finish(response));
		await Promise.all([first, duplicate]);
		expect(send).toHaveBeenCalledOnce();
		cards.dispose();
	});

	it("does not render HTML previews for raw HTTP inputs or outputs containing HTML fences", () => {
		const node: any = { contentEl: { removeClass: vi.fn(), addClass: vi.fn(), querySelector: () => null, querySelectorAll: () => [], createEl: () => { throw new Error("HTTP content must not mount an HTML preview"); } }, id: "output", text: '````text\n```html\n<script>bad()</script>\n```\n````', getData: () => ({ type: "text", http_response: { requestNodeId: "request" } }) };
		restoreHtmlPreviews({ nodes: new Map([[node.id, node]]) }, true);
		expect(node.contentEl.addClass).not.toHaveBeenCalled();
	});
});
