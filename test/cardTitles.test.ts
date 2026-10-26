import { afterEach, describe, expect, it, vi } from "vitest";
import { getCanvasCardTitle, renderCanvasCardTitle, setCanvasCardTitle } from "../src/utils/cardTitles";

const fixture = (data: any) => {
	let stored = { id: "card", ...data };
	const node: any = {
		getData: () => ({ ...stored }),
		setData: (value: any) => { stored = { ...stored, ...value }; },
		canvas: { readonly: false, nodes: new Map(), requestSave: vi.fn(), requestFrame: vi.fn() },
	};
	node.canvas.nodes.set("card", node);
	return node;
};
afterEach(() => vi.restoreAllMocks());

describe("manual canvas card titles", () => {
	it.each([
		{ type: "text", text: "Do not change the note", http_request: { method: "GET" } },
		{ type: "text", text: "HTTP 200", http_response: { status: 200 } },
		{ type: "file", file: "attachments/image.png", subpath: "#section" },
		{ type: "link", url: "https://example.com/page" },
	])("names $type cards without changing their contents or target", data => {
		const node = fixture(data);
		setCanvasCardTitle(node, '  My <custom> "title"  ');
		expect(node.getData()).toMatchObject({ ...data, ai_card_title: 'My <custom> "title"' });
		expect(getCanvasCardTitle(node)).toBe('My <custom> "title"');
		expect(node.canvas.requestSave).toHaveBeenCalledOnce();
		setCanvasCardTitle(node, "");
		expect(getCanvasCardTitle(node)).toBe("");
		expect(node.getData()).toMatchObject(data);
	});

	it("uses the native group label, preserving the group geometry", () => {
		const node = fixture({ type: "group", label: "Original", x: 0, y: 20, width: 800, height: 500 });
		setCanvasCardTitle(node, "Research");
		expect(node.getData()).toMatchObject({ label: "Research", x: 0, y: 20, width: 800, height: 500 });
		expect(node.getData()).not.toHaveProperty("ai_card_title");
		expect(getCanvasCardTitle(node)).toBe("Research");
	});

	it("recognizes titles already stored by AI naming without calling a provider", () => {
		const node = fixture({ type: "text", text: "Note", ai_card_title: "Existing title" });
		expect(getCanvasCardTitle(node)).toBe("Existing title");
	});

	it("restores the current filename label after Obsidian replaces its element", () => {
		const node = fixture({ type: "file", file: "image.png" });
		const custom: any = { textContent: "", addEventListener() {}, setAttribute() {}, remove() {}, setText(value: string) { this.textContent = value; } };
		node.nodeEl = { querySelector: () => null, createDiv: () => custom };
		custom.parentElement = node.nodeEl;
		const first = { style: { display: "" } };
		node.labelEl = first;
		setCanvasCardTitle(node, "Image title");
		expect(first.style.display).toBe("none");
		const replacement = { style: { display: "" } };
		node.labelEl = replacement;
		renderCanvasCardTitle(node);
		expect(replacement.style.display).toBe("none");
		setCanvasCardTitle(node, "");
		expect(replacement.style.display).toBe("");
		expect(first.style.display).toBe("");
	});

	it("leaves native group label typing alone until the edit finishes", () => {
		const node = fixture({ type: "group", label: "Saved label" });
		node.nodeEl = { querySelector: vi.fn() };
		node.isEditing = false; // Native label editing does not set this flag.
		node.labelEl = { isContentEditable: true, textContent: "Draft label", setText: vi.fn() };
		renderCanvasCardTitle(node);
		expect(node.labelEl.setText).not.toHaveBeenCalled();
	});

	it("refuses edits to locked canvases and removed cards", () => {
		const node = fixture({ type: "text", text: "Original" });
		node.canvas.readonly = true;
		expect(() => setCanvasCardTitle(node, "Locked")).toThrow(/read.only/i);
		node.canvas.readonly = false;
		node.canvas.nodes.clear();
		expect(() => setCanvasCardTitle(node, "Removed")).toThrow(/removed/i);
		expect(node.getData()).not.toHaveProperty("ai_card_title");
	});
});
