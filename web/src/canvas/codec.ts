import type {
	CanvasEnd,
	CanvasSide,
	JsonCanvasData,
	JsonCanvasEdge,
	JsonCanvasNode,
} from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === "string" && value.trim().length > 0;

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const assertNode = (value: unknown): JsonCanvasNode => {
	if (!isRecord(value)) throw new Error("Every canvas node must be an object");
	const id = isNonEmptyString(value.id) ? value.id : "<unknown>";
	if (!isNonEmptyString(value.id)) throw new Error("A canvas node is missing a valid id");
	if (!isNonEmptyString(value.type)) throw new Error(`Node ${id} is missing a valid type`);
	for (const key of ["x", "y", "width", "height"] as const) {
		if (!isFiniteNumber(value[key])) throw new Error(`Node ${id} has an invalid ${key}`);
	}
	if ((value.width as number) <= 0 || (value.height as number) <= 0) {
		throw new Error(`Node ${id} must have positive width and height`);
	}
	if (value.type === "text" && typeof value.text !== "string") {
		throw new Error(`Text node ${id} is missing text`);
	}
	if (value.type === "file" && !isNonEmptyString(value.file)) {
		throw new Error(`File node ${id} is missing a file path`);
	}
	if (value.type === "link" && !isNonEmptyString(value.url)) {
		throw new Error(`Link node ${id} is missing a URL`);
	}
	return value as unknown as JsonCanvasNode;
};

const SIDES = new Set<CanvasSide>(["top", "right", "bottom", "left"]);
const ENDS = new Set<CanvasEnd>(["none", "arrow"]);

const assertEdge = (value: unknown, nodeIds: Set<string>): JsonCanvasEdge => {
	if (!isRecord(value)) throw new Error("Every canvas edge must be an object");
	if (!isNonEmptyString(value.id)) throw new Error("A canvas edge is missing a valid id");
	if (!isNonEmptyString(value.fromNode) || !nodeIds.has(value.fromNode)) {
		throw new Error(`Edge ${value.id} has an invalid fromNode`);
	}
	if (!isNonEmptyString(value.toNode) || !nodeIds.has(value.toNode)) {
		throw new Error(`Edge ${value.id} has an invalid toNode`);
	}
	if (value.fromSide !== undefined && !SIDES.has(value.fromSide as CanvasSide)) {
		throw new Error(`Edge ${value.id} has an invalid fromSide`);
	}
	if (value.toSide !== undefined && !SIDES.has(value.toSide as CanvasSide)) {
		throw new Error(`Edge ${value.id} has an invalid toSide`);
	}
	if (value.fromEnd !== undefined && !ENDS.has(value.fromEnd as CanvasEnd)) {
		throw new Error(`Edge ${value.id} has an invalid fromEnd`);
	}
	if (value.toEnd !== undefined && !ENDS.has(value.toEnd as CanvasEnd)) {
		throw new Error(`Edge ${value.id} has an invalid toEnd`);
	}
	return value as unknown as JsonCanvasEdge;
};

const assertUniqueIds = (kind: "node" | "edge", values: { id: string }[]) => {
	const ids = new Set<string>();
	for (const value of values) {
		if (ids.has(value.id)) throw new Error(`Duplicate ${kind} id: ${value.id}`);
		ids.add(value.id);
	}
};

export const parseCanvasJson = (source: string): JsonCanvasData => {
	let value: unknown;
	try {
		value = JSON.parse(source);
	} catch (error) {
		throw new Error(`Invalid JSON Canvas: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(value)) throw new Error("A JSON Canvas document must be an object");
	if (!Array.isArray(value.nodes)) throw new Error("A JSON Canvas document must contain a nodes array");
	if (!Array.isArray(value.edges)) throw new Error("A JSON Canvas document must contain an edges array");

	const nodes = value.nodes.map(assertNode);
	assertUniqueIds("node", nodes);
	const nodeIds = new Set(nodes.map((node) => node.id));
	const edges = value.edges.map((edge) => assertEdge(edge, nodeIds));
	assertUniqueIds("edge", edges);
	return { ...value, nodes, edges } as JsonCanvasData;
};

export const serializeCanvas = (canvas: JsonCanvasData): string => {
	return `${JSON.stringify(canvas, null, "\t")}\n`;
};
