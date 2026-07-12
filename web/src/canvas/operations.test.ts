import { describe, expect, it } from "vitest";
import {
	addCanvasEdge,
	addCanvasNode,
	appendGeneratedImageNode,
	appendGeneratedTextNode,
	copyCanvasSelection,
	deleteCanvasSelection,
	duplicateCanvasNodes,
	groupCanvasNodes,
	moveGroupWithContents,
	patchCanvasEdge,
	patchCanvasNode,
	pasteCanvasSelection,
	reconnectCanvasEdge,
	updateNodeBounds,
} from "./operations";
import type { JsonCanvasData } from "./types";

const base: JsonCanvasData = {
	nodes: [
		{ id: "a", type: "text", text: "Alpha", x: 0, y: 0, width: 240, height: 160 },
		{ id: "b", type: "text", text: "Beta", x: 400, y: 0, width: 240, height: 160 },
	],
	edges: [{ id: "a-b", fromNode: "a", toNode: "b", toEnd: "arrow" }],
};

describe("canvas operations", () => {
	it("adds a node at a canvas position with an id from the caller", () => {
		const next = addCanvasNode(base, {
			id: "new",
			type: "text",
			text: "Start writing…",
			x: 120,
			y: 220,
			width: 300,
			height: 180,
		});
		expect(next.nodes.at(-1)).toMatchObject({ id: "new", x: 120, y: 220 });
		expect(base.nodes).toHaveLength(2);
	});

	it("updates position and dimensions without dropping custom fields", () => {
		const withCustom: JsonCanvasData = {
			...base,
			nodes: [{ ...base.nodes[0], ai_image_prompt: "exact prompt" }, base.nodes[1]],
		};
		const next = updateNodeBounds(withCustom, "a", { x: 40, y: 60, width: 500, height: 260 });
		expect(next.nodes[0]).toMatchObject({ x: 40, y: 60, width: 500, height: 260, ai_image_prompt: "exact prompt" });
	});

	it("deletes selected nodes and their attached edges", () => {
		const next = deleteCanvasSelection(base, new Set(["a"]), new Set());
		expect(next.nodes.map((node) => node.id)).toEqual(["b"]);
		expect(next.edges).toEqual([]);
	});

	it("duplicates selected nodes and internal edges", () => {
		let sequence = 0;
		const next = duplicateCanvasNodes(base, new Set(["a", "b"]), () => `copy-${++sequence}`);
		expect(next.nodes.slice(-2).map((node) => ({ id: node.id, x: node.x, y: node.y }))).toEqual([
			{ id: "copy-1", x: 32, y: 32 },
			{ id: "copy-2", x: 432, y: 32 },
		]);
		expect(next.edges.at(-1)).toMatchObject({ id: "copy-3", fromNode: "copy-1", toNode: "copy-2" });
	});

	it("adds an edge with JSON Canvas side and end metadata", () => {
		const next = addCanvasEdge(base, {
			id: "b-a",
			fromNode: "b",
			fromSide: "left",
			fromEnd: "none",
			toNode: "a",
			toSide: "right",
			toEnd: "arrow",
		});
		expect(next.edges.at(-1)).toMatchObject({ id: "b-a", fromSide: "left", toSide: "right" });
	});

	it("patches editable node and edge fields while preserving custom metadata", () => {
		const withCustom: JsonCanvasData = {
			nodes: [{ ...base.nodes[0], customNode: 3 }, base.nodes[1]],
			edges: [{ ...base.edges[0], customEdge: 4 }],
		};
		const nodePatched = patchCanvasNode(withCustom, "a", { text: "Edited", color: "2" });
		const edgePatched = patchCanvasEdge(nodePatched, "a-b", { label: "next", color: "5" });
		expect(edgePatched.nodes[0]).toMatchObject({ text: "Edited", color: "2", customNode: 3 });
		expect(edgePatched.edges[0]).toMatchObject({ label: "next", color: "5", customEdge: 4 });
	});

	it("creates a padded group around selected cards", () => {
		const next = groupCanvasNodes(base, new Set(["a", "b"]), "group", "Collection");
		expect(next.nodes.at(-1)).toMatchObject({
			id: "group",
			type: "group",
			label: "Collection",
			x: -40,
			y: -72,
			width: 720,
			height: 272,
		});
	});

	it("places a generated response to the right and connects it to the source", () => {
		const next = appendGeneratedTextNode(base, "a", "answer", "Generated answer", "answer-edge");
		expect(next.nodes.at(-1)).toMatchObject({
			id: "answer",
			type: "text",
			text: "Generated answer",
			x: 320,
			y: 0,
			width: 380,
			height: 240,
		});
		expect(next.edges.at(-1)).toMatchObject({
			id: "answer-edge",
			fromNode: "a",
			fromSide: "right",
			toNode: "answer",
			toSide: "left",
			toEnd: "arrow",
		});
	});

	it("stores the exact prompt on a generated image card", () => {
		const next = appendGeneratedImageNode(
			base,
			"a",
			"image",
			"generated/image.png",
			"data:image/png;base64,aW1hZ2U=",
			"image/png",
			"THE EXACT SENT PROMPT",
			"image-edge"
		);
		expect(next.nodes.at(-1)).toMatchObject({
			id: "image",
			type: "file",
			file: "generated/image.png",
			web_asset: "data:image/png;base64,aW1hZ2U=",
			web_asset_type: "image/png",
			ai_image_prompt: "THE EXACT SENT PROMPT",
		});
		expect(next.edges.at(-1)).toMatchObject({ fromNode: "a", toNode: "image" });
	});

	it("copies and pastes selected cards with internal arrows", () => {
		const clipboard = copyCanvasSelection(base, new Set(["a", "b"]));
		let sequence = 0;
		const pasted = pasteCanvasSelection(base, clipboard, () => `paste-${++sequence}`);
		expect(pasted.nodes.slice(-2).map(({ id, x, y }) => ({ id, x, y }))).toEqual([
			{ id: "paste-1", x: 32, y: 32 },
			{ id: "paste-2", x: 432, y: 32 },
		]);
		expect(pasted.edges.at(-1)).toMatchObject({ id: "paste-3", fromNode: "paste-1", toNode: "paste-2" });
	});

	it("reconnects an edge without dropping labels or custom metadata", () => {
		const withThird: JsonCanvasData = {
			nodes: [...base.nodes, { id: "c", type: "text", text: "Gamma", x: 800, y: 0, width: 240, height: 160 }],
			edges: [{ ...base.edges[0], label: "keep", custom: 9 }],
		};
		const next = reconnectCanvasEdge(withThird, "a-b", {
			fromNode: "c",
			fromSide: "bottom",
			toNode: "a",
			toSide: "top",
		});
		expect(next.edges[0]).toMatchObject({ fromNode: "c", fromSide: "bottom", toNode: "a", toSide: "top", label: "keep", custom: 9 });
	});

	it("moves cards enclosed by a dragged group", () => {
		const grouped: JsonCanvasData = {
			...base,
			nodes: [{ id: "group", type: "group", label: "All", x: -40, y: -40, width: 720, height: 260 }, ...base.nodes],
		};
		const next = moveGroupWithContents(grouped, "group", 60, 10);
		expect(next.nodes.find(({ id }) => id === "group")).toMatchObject({ x: 60, y: 10 });
		expect(next.nodes.find(({ id }) => id === "a")).toMatchObject({ x: 100, y: 50 });
		expect(next.nodes.find(({ id }) => id === "b")).toMatchObject({ x: 500, y: 50 });
	});
});
