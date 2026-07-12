import { describe, expect, it } from "vitest";
import { canvasToFlowEdges, canvasToFlowNodes, flowNodesToCanvas } from "./flowAdapter";
import type { JsonCanvasData } from "./types";

const canvas: JsonCanvasData = {
	nodes: [
		{ id: "group", type: "group", label: "Ideas", x: -40, y: -40, width: 760, height: 420, color: "4" },
		{ id: "note", type: "text", text: "# First idea", x: 20, y: 20, width: 320, height: 180, custom: true },
		{ id: "source", type: "link", url: "https://example.com", x: 420, y: 80, width: 260, height: 140 },
	],
	edges: [
		{ id: "edge", fromNode: "note", fromSide: "right", fromEnd: "none", toNode: "source", toSide: "left", toEnd: "arrow", label: "evidence", color: "3", customEdge: 7 },
	],
};

describe("React Flow adapter", () => {
	it("maps JSON Canvas card bounds and groups to custom flow nodes", () => {
		const nodes = canvasToFlowNodes(canvas);
		expect(nodes[0]).toMatchObject({
			id: "group",
			type: "canvasGroup",
			position: { x: -40, y: -40 },
			style: { width: 760, height: 420 },
			zIndex: -1,
		});
		expect(nodes[1]).toMatchObject({
			id: "note",
			type: "canvasCard",
			position: { x: 20, y: 20 },
			style: { width: 320, height: 180 },
		});
	});

	it("maps handles, arrow ends, labels, and colors", () => {
		const [edge] = canvasToFlowEdges(canvas);
		expect(edge).toMatchObject({
			id: "edge",
			source: "note",
			target: "source",
			sourceHandle: "right",
			targetHandle: "left",
			label: "evidence",
			data: { canvasEdge: expect.objectContaining({ customEdge: 7 }) },
		});
		expect(edge.markerStart).toBeUndefined();
		expect(edge.markerEnd).toEqual(expect.objectContaining({ type: "arrowclosed" }));
	});

	it("writes moved and resized flow nodes back without dropping node data", () => {
		const nodes = canvasToFlowNodes(canvas).map((node) => node.id === "note" ? {
			...node,
			position: { x: 80, y: 120 },
			width: 460,
			height: 260,
		} : node);
		const next = flowNodesToCanvas(canvas, nodes);
		expect(next.nodes.find(({ id }) => id === "note")).toMatchObject({
			x: 80,
			y: 120,
			width: 460,
			height: 260,
			custom: true,
			text: "# First idea",
		});
	});

	it("uses JSON Canvas default end markers when the fields are omitted", () => {
		const [edge] = canvasToFlowEdges({
			nodes: canvas.nodes,
			edges: [{ id: "default", fromNode: "note", toNode: "source" }],
		});
		expect(edge.markerStart).toBeUndefined();
		expect(edge.markerEnd).toEqual(expect.objectContaining({ type: "arrowclosed" }));
	});
});
