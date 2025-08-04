import { ItemView } from "obsidian";
import { AllCanvasNodeData } from "obsidian/canvas";
import { randomHexString } from "../utils";
import { Canvas, CanvasNode, CreateNodeOptions } from "./canvas-internal";

export interface CanvasEdgeIntermediate {
	fromOrTo: string;
	side: string;
	node: CanvasElement;
}

interface CanvasElement {
	id: string;
}

export type CanvasView = ItemView & {
	canvas: Canvas;
};

/**
 * Minimum width for new notes
 */
const minWidth = 360;

/**
 * Assumed pixel width per character
 */
const pxPerChar = 5;

/**
 * Assumed pixel height per line
 */
const pxPerLine = 28;

/**
 * Assumed height of top + bottom text area padding
 */
const textPaddingHeight = 12;

/**
 * Margin between new notes
 */
const newNoteMargin = 60;
const newNoteMarginWithLabel = 110;

/**
 * Min height of new notes
 */
const minHeight = 60;

/**
 * Direction preference for new node placement
 */
export type DirectionBias = "up" | "down" | "left" | "right" | "none";

/**
 * Analyzes incoming edges to determine the directional bias for new node placement
 * Based on which side arrows are coming FROM (opposite to where new nodes should be placed)
 */
export const getIncomingEdgeDirection = (node: CanvasNode): DirectionBias => {
	const canvas = node.canvas;
	if (!canvas) return "none";
	
	// Get all edges pointing TO this node
	const incomingEdges = canvas.getEdgesForNode(node).filter(edge => edge.to.node.id === node.id);
	
	if (incomingEdges.length === 0) return "none";
	
	// Get the canvas data to access edge properties including toSide
	const canvasData = canvas.getData();
	if (!canvasData) return "none";
	
	// Count directions based on where arrows are coming FROM
	const directionCounts = {
		up: 0,    // arrows coming from above (toSide: "top") -> generate downward
		down: 0,  // arrows coming from below (toSide: "bottom") -> generate upward
		left: 0,  // arrows coming from left (toSide: "left") -> generate rightward
		right: 0  // arrows coming from right (toSide: "right") -> generate leftward
	};
	
	// Check each incoming edge's toSide property from canvas data
	for (const edge of incomingEdges) {
		const edgeData = canvasData.edges.find((e: any) => 
			e.fromNode === edge.from.node.id && e.toNode === edge.to.node.id
		);
		
		if (edgeData) {
			const toSide = edgeData.toSide;
			// toSide indicates where the arrow connects TO this node
			// We want to place new nodes in the OPPOSITE direction of where arrows come from
			if (toSide === "top") {
				directionCounts.down++; // Arrow from above -> generate downward
			} else if (toSide === "bottom") {
				directionCounts.up++;   // Arrow from below -> generate upward
			} else if (toSide === "left") {
				directionCounts.right++; // Arrow from left -> generate rightward
			} else if (toSide === "right") {
				directionCounts.left++;  // Arrow from right -> generate leftward
			}
		}
	}
	
	// Return the direction with the highest count
	const maxCount = Math.max(...Object.values(directionCounts));
	if (maxCount === 0) return "none";
	
	// Find the direction with the highest count (prefer up/down over left/right for ties)
	if (directionCounts.up === maxCount) return "up";
	if (directionCounts.down === maxCount) return "down";
	if (directionCounts.left === maxCount) return "left";
	if (directionCounts.right === maxCount) return "right";
	
	return "none";
};

/**
 * Choose height for generated note based on text length and parent height.
 * For notes beyond a few lines, the note will have scroll bar.
 * Not a precise science, just something that is not surprising.
 */
// export const calcHeight = (options: { parentHeight: number; text: string }) => {
export const calcHeight = (options: { text: string }) => {
	const calcTextHeight = Math.round(
		textPaddingHeight +
			(pxPerLine * options.text.length) / (minWidth / pxPerChar)
	);
	return calcTextHeight;
	// return Math.max(options.parentHeight, calcTextHeight);
};

const DEFAULT_NODE_WIDTH = 400;
const DEFAULT_NODE_HEIGHT = DEFAULT_NODE_WIDTH * (1024 / 1792) + 20;

/**
 * Create new node as descendant from the parent node.
 * Align and offset relative to siblings.
 */
export const createNode = (
	canvas: Canvas,
	nodeOptions: CreateNodeOptions,
	parentNode?: CanvasNode,
	nodeData?: Partial<AllCanvasNodeData>,
	edgeLabel?: string,
	directionBias?: DirectionBias
) => {
	if (!canvas) {
		throw new Error("Invalid arguments");
	}

	const { text } = nodeOptions;

	const width = parentNode
		? nodeOptions?.size?.width || Math.max(minWidth, parentNode?.width)
		: DEFAULT_NODE_WIDTH;

	const height = text
		? parentNode
			? nodeOptions?.size?.height ||
			  Math.max(
					minHeight,
					parentNode &&
						calcHeight({
							text,
							// parentHeight: parentNode.height
						})
			  )
			: DEFAULT_NODE_HEIGHT
		: undefined;

	// @ts-expect-error
	let x = canvas.x - width / 2;
	// @ts-expect-error
	let y = canvas.y - height / 2;

	if (parentNode) {
		const siblings =
			parent &&
			canvas
				.getEdgesForNode(parentNode)
				.filter((n) => n.from.node.id == parentNode.id)
				.map((e) => e.to.node);

		// Determine actual direction bias - if not provided, detect from parent's incoming edges
		const actualDirectionBias = directionBias || getIncomingEdgeDirection(parentNode);

		if (actualDirectionBias === "right") {
			// Place nodes to the right of the parent or rightmost sibling
			const siblingsRight = siblings?.length
				? siblings.reduce(
						(right, sib) => Math.max(right, sib.x + sib.width),
						parentNode.x + parentNode.width
				  )
				: parentNode.x + parentNode.width;
			
			x = siblingsRight + newNoteMargin;
			// Align vertically with parent center
			y = parentNode.y + parentNode.height / 2 - height! / 2;
			
		} else if (actualDirectionBias === "left") {
			// Place nodes to the left of the parent or leftmost sibling
			const siblingsLeft = siblings?.length
				? siblings.reduce(
						(left, sib) => Math.min(left, sib.x),
						parentNode.x
				  )
				: parentNode.x;
			
			x = siblingsLeft - width - newNoteMargin;
			// Align vertically with parent center
			y = parentNode.y + parentNode.height / 2 - height! / 2;
			
		} else if (actualDirectionBias === "down") {
			// Place nodes below the parent or bottommost sibling
			const siblingsBottom = siblings?.length
				? siblings.reduce(
						(bottom, sib) => Math.max(bottom, sib.y + sib.height),
						parentNode.y + parentNode.height
				  )
				: parentNode.y + parentNode.height;
			
			y = siblingsBottom + (edgeLabel ? newNoteMarginWithLabel : newNoteMargin);
			// Align horizontally with parent center
			x = parentNode.x + parentNode.width / 2 - width / 2;
			
		} else if (actualDirectionBias === "up") {
			// Place nodes above the parent or topmost sibling
			const siblingsTop = siblings?.length
				? siblings.reduce(
						(top, sib) => Math.min(top, sib.y),
						parentNode.y
				  )
				: parentNode.y;
			
			y = siblingsTop - height! - (edgeLabel ? newNoteMarginWithLabel : newNoteMargin);
			// Align horizontally with parent center
			x = parentNode.x + parentNode.width / 2 - width / 2;
			
		} else {
			// Default behavior (original logic)
			const farLeft = parentNode.y - parentNode.width * 5;
			const siblingsRight = siblings?.length
				? siblings.reduce(
						(right, sib) => Math.max(right, sib.x + sib.width),
						farLeft
				  )
				: undefined;
			const priorSibling = siblings[siblings.length - 1];

			// Position left at right of prior sibling, otherwise aligned with parent
			x =
				siblingsRight != null
					? siblingsRight + newNoteMargin
					: parentNode.x;

			// Position top at prior sibling top, otherwise offset below parent
			y =
				(priorSibling
					? priorSibling.y
					: parentNode.y +
					  parentNode.height +
					  (edgeLabel ? newNoteMarginWithLabel : newNoteMargin)) +
				// Using position=left, y value is treated as vertical center
				height! * 0.5;
		}
	}

	const newNode =
		nodeOptions.type === "file"
			? //  @ts-expect-error
			  canvas.createFileNode({
					file: nodeOptions.file,
					pos: { x, y },
					// // position: "left",
					// size: { height, width },
					// focus: false,
			  })
			: canvas.createTextNode({
					pos: { x, y },
					position: "left",
					size: { height, width },
					text,
					focus: false,
			  });

	if (nodeData) {
		newNode.setData(nodeData);
	}

	canvas.deselectAll();
	canvas.addNode(newNode);

	if (parentNode) {
		// Determine edge sides based on direction bias for straight arrows
		const actualDirectionBias = directionBias || getIncomingEdgeDirection(parentNode);
		let fromSide: string, toSide: string;
		
		if (actualDirectionBias === "right") {
			// Rightward generation: parent right → new node left
			fromSide = "right";
			toSide = "left";
		} else if (actualDirectionBias === "left") {
			// Leftward generation: parent left → new node right
			fromSide = "left";
			toSide = "right";
		} else if (actualDirectionBias === "down") {
			// Downward generation: parent bottom → new node top
			fromSide = "bottom";
			toSide = "top";
		} else if (actualDirectionBias === "up") {
			// Upward generation: parent top → new node bottom
			fromSide = "top";
			toSide = "bottom";
		} else {
			// Default behavior: downward generation
			fromSide = "bottom";
			toSide = "top";
		}
		
		addEdge(
			canvas,
			randomHexString(16),
			{
				fromOrTo: "from",
				side: fromSide,
				node: parentNode,
			},
			{
				fromOrTo: "to",
				side: toSide,
				node: newNode,
			},
			edgeLabel,
			{
				isGenerated: true,
			}
		);
	}

	return newNode;
};

/**
 * Add edge entry to canvas.
 */
export const addEdge = (
	canvas: Canvas,
	edgeID: string,
	fromEdge: CanvasEdgeIntermediate,
	toEdge: CanvasEdgeIntermediate,
	label?: string,
	edgeData?: {
		isGenerated: boolean;
	}
) => {
	if (!canvas) return;

	const data = canvas.getData();

	if (!data) return;

	canvas.importData({
		edges: [
			...data.edges,
			{
				...edgeData,
				id: edgeID,
				fromNode: fromEdge.node.id,
				fromSide: fromEdge.side,
				toNode: toEdge.node.id,
				toSide: toEdge.side,
				label,
			},
		],
		nodes: data.nodes,
	});

	canvas.requestFrame();
};

/**
 * Trap exception and write to console.error.
 */
export function trapError<T>(fn: (...params: unknown[]) => T) {
	return (...params: unknown[]) => {
		try {
			return fn(...params);
		} catch (e) {
			console.error(e);
		}
	};
}
