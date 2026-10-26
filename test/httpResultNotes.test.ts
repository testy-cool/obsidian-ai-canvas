import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { HttpRequestCards } from "../src/utils/httpRequestCards";
import { DEFAULT_HTTP_REQUEST } from "../src/utils/httpRequest";

const large = { status: 200, headers: { "content-type": "application/json" }, text: JSON.stringify({ body: "x".repeat(5500) }), elapsedMs: 5 };
const request = { ...DEFAULT_HTTP_REQUEST, url: "https://example.com/items" };

function fixture() {
	let count = 0;
	const files = new Map<string, TFile>();
	const contents = new Map<TFile, string>();
	const file = Object.assign(new TFile(), { path: "Boards/Requests.canvas" });
	files.set(file.path, file);
	const canvas: any = { view: { file }, x: 0, y: 0, nodes: new Map(), selection: new Set() };
	let edges: any[] = [];
	const make = (initial: any) => {
		let data = { ...initial };
		const node: any = { canvas, ...data, getData: () => ({ ...data }), setData: (value: any) => { data = { ...data, ...value }; Object.assign(node, value); }, setText: async (text: string) => { data.text = text; node.text = text; } };
		canvas.nodes.set(data.id, node);
		return node;
	};
	Object.assign(canvas, {
		createTextNode: (options: any) => make({ id: `node-${++count}`, type: "text", text: options.text, ...options.pos, ...options.size }),
		addNode() {}, selectOnly() {}, deselectAll() {}, requestFrame: vi.fn(),
		select: (node: any) => canvas.selection.add(node),
		getData: () => ({ nodes: [...canvas.nodes.values()].map((node: any) => node.getData()), edges }),
		getEdgesForNode: (node: any) => edges.filter(e => e.fromNode === node.id || e.toNode === node.id).map(e => ({ from: { node: canvas.nodes.get(e.fromNode) }, to: { node: canvas.nodes.get(e.toNode) } })),
		removeNode: (node: any) => { canvas.nodes.delete(node.id); canvas.selection.delete(node); edges = edges.filter(e => e.fromNode !== node.id && e.toNode !== node.id); },
		importData: (data: any) => { for (const d of data.nodes) if (!canvas.nodes.has(d.id)) make(d); edges = data.edges; },
		requestSave: vi.fn(() => { contents.set(file, JSON.stringify(canvas.getData())); }),
	});
	const app: any = {
		workspace: { getLeavesOfType: () => [{ view: { canvas } }] },
		fileManager: { getAvailablePathForAttachment: vi.fn(async (name: string) => `Boards/attachments/${name}`) },
		vault: {
			getAbstractFileByPath: (path: string) => files.get(path),
			create: vi.fn(async (path: string, text: string) => { if (files.has(path)) throw Error("File exists"); const created = Object.assign(new TFile(), { path }); files.set(path, created); contents.set(created, text); return created; }),
			read: async (target: TFile) => contents.get(target),
			process: vi.fn(async (target: TFile, change: (text: string) => string) => { contents.set(target, change(contents.get(target)!)); }),
			delete: vi.fn(async (target: TFile) => { files.delete(target.path); contents.delete(target); }),
		},
	};
	return { app, canvas, file, contents, files, notes: () => [...files.values()].filter(f => f.path.endsWith(".md")) };
}

describe("HTTP result attachment notes", () => {
	it("embeds a real Markdown file for a long result, preserving title, node ID, metadata and edges", async () => {
		const f = fixture();
		let finish!: (value: typeof large) => void;
		const cards = new HttpRequestCards(f.app, () => new Promise(resolve => { finish = resolve; }));
		const source = cards.save(f.canvas, request);
		const pending = cards.send(source);
		const output = [...f.canvas.nodes.values()][1] as any;
		output.setData({ ...output.getData(), ai_card_title: "Customer records", x: 900, y: 200 });
		const edge = f.canvas.getData().edges[0];
		finish(large); await pending;
		const note = f.notes()[0];
		const saved = f.canvas.nodes.get(output.id).getData();
		expect(saved).toMatchObject({ id: output.id, type: "file", file: note.path, ai_card_title: "Customer records", x: 900, y: 200, result_note: true, http_response: { state: "complete", status: 200 } });
		expect(saved).not.toHaveProperty("text");
		expect(f.canvas.getData().edges).toEqual([edge]);
		expect(f.notes()).toHaveLength(1);
		expect(f.contents.get(note)).toContain('"body": "xxx');
		expect(f.app.fileManager.getAvailablePathForAttachment).toHaveBeenCalledWith(expect.stringMatching(/\.md$/), f.file.path);
		cards.dispose();
	});

	it.each([0, 10000])("keeps results inline when the threshold is %s", async threshold => {
		const f = fixture();
		const cards = new HttpRequestCards(f.app, async () => large, () => threshold);
		const source = cards.save(f.canvas, request); await cards.send(source);
		expect([...f.canvas.nodes.values()][1].getData()).toMatchObject({ type: "text", http_response: { state: "complete" } });
		expect(f.notes()).toHaveLength(0);
		cards.dispose();
	});

	it("retains the complete readable response when saving the attachment fails", async () => {
		const f = fixture();
		f.app.vault.create.mockRejectedValue(new Error("Disk full"));
		const cards = new HttpRequestCards(f.app, async () => large);
		await cards.send(cards.save(f.canvas, request));
		const output = [...f.canvas.nodes.values()][1];
		expect(output.getData()).toMatchObject({ type: "text", http_response: { state: "complete", status: 200 } });
		expect(output.text).toContain('"body": "xxx');
		cards.dispose();
	});

	it("embeds the note in the saved canvas when every canvas view has closed", async () => {
		const f = fixture();
		let finish!: (value: typeof large) => void;
		const cards = new HttpRequestCards(f.app, () => new Promise(resolve => { finish = resolve; }));
		const pending = cards.send(cards.save(f.canvas, request));
		const original = JSON.parse(f.contents.get(f.file)!);
		f.canvas.nodes.clear(); f.app.workspace.getLeavesOfType = () => [];
		finish(large); await pending;
		const saved = JSON.parse(f.contents.get(f.file)!);
		expect(saved.nodes[1]).toMatchObject({ id: original.nodes[1].id, type: "file", file: f.notes()[0].path });
		expect(saved.nodes[1]).not.toHaveProperty("text");
		expect(saved.edges).toEqual(original.edges);
		cards.dispose();
	});

	it("does not resurrect a result deleted while the attachment is being created", async () => {
		const f = fixture();
		const create = f.app.vault.create.getMockImplementation();
		let created!: () => void, release!: () => void;
		const entered = new Promise<void>(r => { created = r; });
		const gate = new Promise<void>(r => { release = r; });
		f.app.vault.create.mockImplementation(async (...args: any[]) => { const note = await create(...args); created(); await gate; return note; });
		const cards = new HttpRequestCards(f.app, async () => large);
		const pending = cards.send(cards.save(f.canvas, request));
		await entered;
		const output = [...f.canvas.nodes.values()][1];
		f.canvas.removeNode(output); release(); await pending;
		expect(f.canvas.nodes.has(output.id)).toBe(false);
		expect(f.notes()).toHaveLength(1);
		expect(f.app.vault.delete).not.toHaveBeenCalled();
		cards.dispose();
	});

	it("restores the inline result and its connections after a partially applied native import fails", async () => {
		const f = fixture();
		let finish!: (value: typeof large) => void;
		const cards = new HttpRequestCards(f.app, () => new Promise(resolve => { finish = resolve; }));
		const source = cards.save(f.canvas, request);
		const pending = cards.send(source);
		const output = [...f.canvas.nodes.values()][1];
		f.canvas.selection.add(output);
		const edges = f.canvas.getData().edges;
		const original = f.canvas.importData;
		vi.spyOn(f.canvas, "importData").mockImplementationOnce((data: any) => { original(data); throw Error("Native import failed after creating file node"); });
		finish(large); await pending;
		const restored = f.canvas.nodes.get(output.id);
		expect(restored.getData()).toMatchObject({ id: output.id, type: "text", http_response: { state: "complete" } });
		expect(restored.getData().text).toContain('"body": "xxx');
		expect(restored.getData()).not.toHaveProperty("file");
		expect(f.canvas.getData().edges).toEqual(edges);
		expect(f.canvas.selection.has(restored)).toBe(true);
		cards.dispose();
	});

	it("retains attachment edits even when a pending cleanup read would return old contents", async () => {
		const f = fixture();
		const create = f.app.vault.create.getMockImplementation();
		const read = f.app.vault.read;
		let entered!: () => void, release!: () => void, readEntered!: () => void, readRelease!: () => void;
		const ready = new Promise<void>(r => { entered = r; });
		const gate = new Promise<void>(r => { release = r; });
		const reading = new Promise<void>(r => { readEntered = r; });
		const readGate = new Promise<void>(r => { readRelease = r; });
		f.app.vault.create.mockImplementation(async (...args: any[]) => { const note = await create(...args); entered(); await gate; return note; });
		f.app.vault.read = async (file: TFile) => { const snapshot = await read(file); if (file.path.endsWith(".md")) { readEntered(); await readGate; } return snapshot; };
		const cards = new HttpRequestCards(f.app, async () => large);
		const pending = cards.send(cards.save(f.canvas, request)); await ready;
		f.canvas.removeNode([...f.canvas.nodes.values()][1]); release();
		await Promise.race([reading, pending]);
		const note = f.notes()[0];
		f.contents.set(note, "User changed the saved attachment"); readRelease(); await pending;
		expect(f.notes()).toEqual([note]);
		expect(f.contents.get(note)).toBe("User changed the saved attachment");
		expect(f.app.vault.delete).not.toHaveBeenCalled();
		cards.dispose();
	});

	it("keeps a user's edit made while note creation is pending", async () => {
		const f = fixture();
		const create = f.app.vault.create.getMockImplementation();
		let entered!: () => void, release!: () => void;
		const ready = new Promise<void>(r => { entered = r; });
		const gate = new Promise<void>(r => { release = r; });
		f.app.vault.create.mockImplementation(async (...args: any[]) => { const note = await create(...args); entered(); await gate; return note; });
		const cards = new HttpRequestCards(f.app, async () => large);
		const pending = cards.send(cards.save(f.canvas, request)); await ready;
		const output = [...f.canvas.nodes.values()][1];
		await output.setText("User edited this result"); release(); await pending;
		expect(output.text).toBe("User edited this result");
		expect(output.getData().type).toBe("text");
		expect(f.notes()).toHaveLength(1);
		cards.dispose();
	});
});
