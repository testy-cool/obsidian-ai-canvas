import type { JsonCanvasData, JsonCanvasNode } from "../canvas/types";

export interface PromptContextEntry {
	node: JsonCanvasNode;
	depth: number;
	edgeLabel?: string;
}

export const collectPromptContext = (canvas: JsonCanvasData, currentNodeId: string): PromptContextEntry[] => {
	const nodes = new Map(canvas.nodes.map((node) => [node.id, node]));
	const current = nodes.get(currentNodeId);
	if (!current) throw new Error(`Canvas card not found: ${currentNodeId}`);
	const entries: PromptContextEntry[] = [];
	const visited = new Set<string>();
	const queue: { node: JsonCanvasNode; depth: number; edgeLabel?: string }[] = [{ node: current, depth: 0 }];

	while (queue.length) {
		const entry = queue.shift()!;
		if (visited.has(entry.node.id)) continue;
		visited.add(entry.node.id);
		entries.push(entry);
		for (const edge of canvas.edges) {
			if (edge.toNode !== entry.node.id || visited.has(edge.fromNode)) continue;
			const parent = nodes.get(edge.fromNode);
			if (parent) queue.push({ node: parent, depth: entry.depth + 1, edgeLabel: edge.label });
		}
	}

	return entries;
};

const nodeContent = (node: JsonCanvasNode): string => {
	switch (node.type) {
		case "text":
			return String(node.text ?? "");
		case "link":
			return `Link: ${String(node.url ?? "")}`;
		case "file":
			return typeof node.web_file_text === "string"
				? `File: ${String(node.file ?? "")}\n${node.web_file_text}`
				: `File: ${String(node.file ?? "")}${node.subpath ? `\nSubpath: ${String(node.subpath)}` : ""}`;
		case "group":
			return `Group: ${String(node.label ?? "Untitled")}`;
		default:
			return JSON.stringify(node, null, 2);
	}
};

export const buildCanvasPrompt = (
	canvas: JsonCanvasData,
	currentNodeId: string,
	selectedNodeIds: Set<string>,
	instruction: string
): string => {
	const blocks = collectPromptContext(canvas, currentNodeId)
		.reverse()
		.filter(({ node }) => node.id === currentNodeId || selectedNodeIds.has(node.id))
		.map(({ node, edgeLabel }) => [
			`### Canvas card: ${node.id} (${node.type})`,
			nodeContent(node),
			edgeLabel ? `Connection to the next card: ${edgeLabel}` : null,
		].filter(Boolean).join("\n\n"));

	return [
		"Use the selected JSON Canvas cards below as context.",
		blocks.join("\n\n---\n\n"),
		`## Task\n\n${instruction.trim() || "Respond to the current card using the selected context."}`,
	].join("\n\n");
};
