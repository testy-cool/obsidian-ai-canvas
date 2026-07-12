import type { JsonCanvasData, JsonCanvasEdge, JsonCanvasNode, NodeBounds } from "./types";

export const addCanvasNode = (canvas: JsonCanvasData, node: JsonCanvasNode): JsonCanvasData => {
	if (canvas.nodes.some(({ id }) => id === node.id)) throw new Error(`Duplicate node id: ${node.id}`);
	return { ...canvas, nodes: [...canvas.nodes, structuredClone(node)] };
};

export const updateNodeBounds = (canvas: JsonCanvasData, nodeId: string, bounds: NodeBounds): JsonCanvasData => {
	return {
		...canvas,
		nodes: canvas.nodes.map((node) => node.id === nodeId ? { ...node, ...bounds } : node),
	};
};

export const deleteCanvasSelection = (
	canvas: JsonCanvasData,
	nodeIds: Set<string>,
	edgeIds: Set<string>
): JsonCanvasData => {
	return {
		...canvas,
		nodes: canvas.nodes.filter((node) => !nodeIds.has(node.id)),
		edges: canvas.edges.filter((edge) =>
			!edgeIds.has(edge.id) && !nodeIds.has(edge.fromNode) && !nodeIds.has(edge.toNode)
		),
	};
};

export const duplicateCanvasNodes = (
	canvas: JsonCanvasData,
	nodeIds: Set<string>,
	createId: () => string
): JsonCanvasData => {
	const idMap = new Map<string, string>();
	const nodes = canvas.nodes
		.filter((node) => nodeIds.has(node.id))
		.map((node) => {
			const id = createId();
			idMap.set(node.id, id);
			return { ...structuredClone(node), id, x: node.x + 32, y: node.y + 32 };
		});
	const edges = canvas.edges
		.filter((edge) => idMap.has(edge.fromNode) && idMap.has(edge.toNode))
		.map((edge) => ({
			...structuredClone(edge),
			id: createId(),
			fromNode: idMap.get(edge.fromNode)!,
			toNode: idMap.get(edge.toNode)!,
		}));
	return { ...canvas, nodes: [...canvas.nodes, ...nodes], edges: [...canvas.edges, ...edges] };
};

export const addCanvasEdge = (canvas: JsonCanvasData, edge: JsonCanvasEdge): JsonCanvasData => {
	if (canvas.edges.some(({ id }) => id === edge.id)) throw new Error(`Duplicate edge id: ${edge.id}`);
	return { ...canvas, edges: [...canvas.edges, structuredClone(edge)] };
};

export const patchCanvasNode = (
	canvas: JsonCanvasData,
	nodeId: string,
	patch: Record<string, unknown>
): JsonCanvasData => ({
	...canvas,
	nodes: canvas.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node),
});

export const patchCanvasEdge = (
	canvas: JsonCanvasData,
	edgeId: string,
	patch: Partial<JsonCanvasEdge>
): JsonCanvasData => ({
	...canvas,
	edges: canvas.edges.map((edge) => edge.id === edgeId ? { ...edge, ...patch } : edge),
});

export const groupCanvasNodes = (
	canvas: JsonCanvasData,
	nodeIds: Set<string>,
	groupId: string,
	label = "Group"
): JsonCanvasData => {
	if (canvas.nodes.some(({ id }) => id === groupId)) throw new Error(`Duplicate node id: ${groupId}`);
	const selected = canvas.nodes.filter((node) => nodeIds.has(node.id) && node.type !== "group");
	if (!selected.length) throw new Error("Select at least one card to create a group");
	const left = Math.min(...selected.map((node) => node.x));
	const top = Math.min(...selected.map((node) => node.y));
	const right = Math.max(...selected.map((node) => node.x + node.width));
	const bottom = Math.max(...selected.map((node) => node.y + node.height));
	return addCanvasNode(canvas, {
		id: groupId,
		type: "group",
		label,
		x: left - 40,
		y: top - 72,
		width: right - left + 80,
		height: bottom - top + 112,
	});
};

export const appendGeneratedTextNode = (
	canvas: JsonCanvasData,
	sourceNodeId: string,
	nodeId: string,
	text: string,
	edgeId: string
): JsonCanvasData => {
	const source = canvas.nodes.find(({ id }) => id === sourceNodeId);
	if (!source) throw new Error(`Canvas card not found: ${sourceNodeId}`);
	const withNode = addCanvasNode(canvas, {
		id: nodeId,
		type: "text",
		text,
		x: source.x + source.width + 80,
		y: source.y,
		width: 380,
		height: 240,
	});
	return addCanvasEdge(withNode, {
		id: edgeId,
		fromNode: sourceNodeId,
		fromSide: "right",
		fromEnd: "none",
		toNode: nodeId,
		toSide: "left",
		toEnd: "arrow",
	});
};

export const appendGeneratedImageNode = (
	canvas: JsonCanvasData,
	sourceNodeId: string,
	nodeId: string,
	file: string,
	src: string,
	mimeType: string,
	prompt: string,
	edgeId: string
): JsonCanvasData => {
	const source = canvas.nodes.find(({ id }) => id === sourceNodeId);
	if (!source) throw new Error(`Canvas card not found: ${sourceNodeId}`);
	const withNode = addCanvasNode(canvas, {
		id: nodeId,
		type: "file",
		file,
		x: source.x + source.width + 80,
		y: source.y,
		width: 500,
		height: 340,
		web_asset: src,
		web_asset_type: mimeType,
		ai_image_prompt: prompt,
	});
	return addCanvasEdge(withNode, {
		id: edgeId,
		fromNode: sourceNodeId,
		fromSide: "right",
		fromEnd: "none",
		toNode: nodeId,
		toSide: "left",
		toEnd: "arrow",
	});
};

export interface CanvasClipboard {
	nodes: JsonCanvasNode[];
	edges: JsonCanvasEdge[];
}

export const copyCanvasSelection = (canvas: JsonCanvasData, nodeIds: Set<string>): CanvasClipboard => {
	return {
		nodes: canvas.nodes.filter((node) => nodeIds.has(node.id)).map((node) => structuredClone(node)),
		edges: canvas.edges
			.filter((edge) => nodeIds.has(edge.fromNode) && nodeIds.has(edge.toNode))
			.map((edge) => structuredClone(edge)),
	};
};

export const pasteCanvasSelection = (
	canvas: JsonCanvasData,
	clipboard: CanvasClipboard,
	createId: () => string
): JsonCanvasData => {
	const idMap = new Map<string, string>();
	const nodes = clipboard.nodes.map((node) => {
		const id = createId();
		idMap.set(node.id, id);
		return { ...structuredClone(node), id, x: node.x + 32, y: node.y + 32 };
	});
	const edges = clipboard.edges
		.filter((edge) => idMap.has(edge.fromNode) && idMap.has(edge.toNode))
		.map((edge) => ({
			...structuredClone(edge),
			id: createId(),
			fromNode: idMap.get(edge.fromNode)!,
			toNode: idMap.get(edge.toNode)!,
		}));
	return { ...canvas, nodes: [...canvas.nodes, ...nodes], edges: [...canvas.edges, ...edges] };
};

export const reconnectCanvasEdge = (
	canvas: JsonCanvasData,
	edgeId: string,
	connection: Pick<JsonCanvasEdge, "fromNode" | "fromSide" | "toNode" | "toSide">
): JsonCanvasData => {
	return patchCanvasEdge(canvas, edgeId, connection);
};

export const moveGroupWithContents = (
	canvas: JsonCanvasData,
	groupId: string,
	x: number,
	y: number
): JsonCanvasData => {
	const group = canvas.nodes.find((node) => node.id === groupId && node.type === "group");
	if (!group) throw new Error(`Canvas group not found: ${groupId}`);
	const dx = x - group.x;
	const dy = y - group.y;
	if (!dx && !dy) return canvas;
	const enclosed = (node: JsonCanvasNode) =>
		node.id !== groupId
		&& node.x >= group.x
		&& node.y >= group.y
		&& node.x + node.width <= group.x + group.width
		&& node.y + node.height <= group.y + group.height;
	return {
		...canvas,
		nodes: canvas.nodes.map((node) => {
			if (node.id === groupId) return { ...node, x, y };
			return enclosed(node) ? { ...node, x: node.x + dx, y: node.y + dy } : node;
		}),
	};
};
