import { describe, expect, it } from "vitest";
import { createCanvasDocument, reduceCanvasDocument } from "./documentState";
import type { JsonCanvasData } from "../canvas/types";

const empty: JsonCanvasData = { nodes: [], edges: [] };
const withCard: JsonCanvasData = {
	nodes: [{ id: "one", type: "text", text: "Hello", x: 0, y: 0, width: 300, height: 180 }],
	edges: [],
};

describe("canvas document state", () => {
	it("commits edits and marks the document dirty", () => {
		const initial = createCanvasDocument(empty, "Untitled");
		const edited = reduceCanvasDocument(initial, { type: "commit", canvas: withCard });
		expect(edited.history.present).toEqual(withCard);
		expect(edited.dirty).toBe(true);
	});

	it("undoes and redoes document edits", () => {
		const edited = reduceCanvasDocument(createCanvasDocument(empty, "Untitled"), {
			type: "commit",
			canvas: withCard,
		});
		const undone = reduceCanvasDocument(edited, { type: "undo" });
		expect(undone.history.present).toEqual(empty);
		expect(reduceCanvasDocument(undone, { type: "redo" }).history.present).toEqual(withCard);
	});

	it("loads a file into a fresh clean history", () => {
		const dirty = reduceCanvasDocument(createCanvasDocument(empty, "Untitled"), {
			type: "commit",
			canvas: withCard,
		});
		const loaded = reduceCanvasDocument(dirty, {
			type: "load",
			canvas: withCard,
			name: "Research.canvas",
			handle: { name: "Research.canvas" },
		});
		expect(loaded.name).toBe("Research");
		expect(loaded.dirty).toBe(false);
		expect(loaded.history.past).toEqual([]);
		expect(loaded.handle).toEqual({ name: "Research.canvas" });
	});

	it("marks the current revision saved", () => {
		const dirty = reduceCanvasDocument(createCanvasDocument(empty, "Untitled"), {
			type: "commit",
			canvas: withCard,
		});
		expect(reduceCanvasDocument(dirty, { type: "saved", handle: null }).dirty).toBe(false);
	});
});
