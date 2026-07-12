import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { JsonCanvasData, JsonCanvasEdge, JsonCanvasNode, NodeBounds } from "./types";

export interface CanvasFlowNodeData extends Record<string, unknown> {
	canvasNode: JsonCanvasNode;
	onPatch?: (nodeId: string, patch: Record<string, unknown>) => void;
	onResize?: (nodeId: string, bounds: NodeBounds) => void;
	onDelete?: (nodeId: string) => void;
	onDuplicate?: (nodeId: string) => void;
	onAskAi?: (nodeId: string) => void;
	onGenerateImage?: (nodeId: string) => void;
	onViewPrompt?: (prompt: string) => void;
}

export interface CanvasFlowEdgeData extends Record<string, unknown> {
	canvasEdge: JsonCanvasEdge;
	onPatch?: (edgeId: string, patch: Partial<JsonCanvasEdge>) => void;
	onDelete?: (edgeId: string) => void;
}

export type CanvasFlowNode = Node<CanvasFlowNodeData, "canvasCard" | "canvasGroup">;
export type CanvasFlowEdge = Edge<CanvasFlowEdgeData>;

const edgeColor = (color: string | undefined): string => {
	if (!color) return "var(--canvas-edge)";
	return /^[1-6]$/.test(color) ? `var(--canvas-color-${color})` : color;
};

export const canvasToFlowNodes = (canvas: JsonCanvasData): CanvasFlowNode[] => {
	return [...canvas.nodes]
		.sort((left, right) => Number(right.type === "group") - Number(left.type === "group"))
		.map((canvasNode) => ({
			id: canvasNode.id,
			type: canvasNode.type === "group" ? "canvasGroup" : "canvasCard",
			position: { x: canvasNode.x, y: canvasNode.y },
			style: { width: canvasNode.width, height: canvasNode.height },
			data: { canvasNode: structuredClone(canvasNode) },
			zIndex: canvasNode.type === "group" ? -1 : 1,
		}));
};

export const canvasToFlowEdges = (canvas: JsonCanvasData): CanvasFlowEdge[] => {
	return canvas.edges.map((canvasEdge) => {
		const color = edgeColor(canvasEdge.color);
		return {
			id: canvasEdge.id,
			source: canvasEdge.fromNode,
			target: canvasEdge.toNode,
			sourceHandle: canvasEdge.fromSide,
			targetHandle: canvasEdge.toSide,
			label: canvasEdge.label,
			type: "canvasEdge",
			style: { stroke: color, strokeWidth: 2 },
			markerStart: canvasEdge.fromEnd === "arrow"
				? { type: MarkerType.ArrowClosed, color }
				: undefined,
			markerEnd: canvasEdge.toEnd !== "none"
				? { type: MarkerType.ArrowClosed, color }
				: undefined,
			data: { canvasEdge: structuredClone(canvasEdge) },
		};
	});
};

const positiveDimension = (...values: unknown[]): number | undefined => {
	for (const value of values) {
		if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
	}
	return undefined;
};

export const flowNodesToCanvas = (canvas: JsonCanvasData, nodes: CanvasFlowNode[]): JsonCanvasData => {
	const nodesById = new Map(nodes.map((node) => [node.id, node]));
	return {
		...canvas,
		nodes: canvas.nodes.map((canvasNode) => {
			const flowNode = nodesById.get(canvasNode.id);
			if (!flowNode) return canvasNode;
			return {
				...canvasNode,
				x: flowNode.position.x,
				y: flowNode.position.y,
				width: positiveDimension(flowNode.width, flowNode.measured?.width, flowNode.style?.width) ?? canvasNode.width,
				height: positiveDimension(flowNode.height, flowNode.measured?.height, flowNode.style?.height) ?? canvasNode.height,
			};
		}),
	};
};
