import {
	BoxSelect,
	FilePlus2,
	FolderKanban,
	ImagePlus,
	Link2,
	MessageSquarePlus,
	Sparkles,
	Trash2,
} from "lucide-react";
import {
	ReactFlow,
	ReactFlowProvider,
	Background,
	BackgroundVariant,
	Controls,
	MiniMap,
	ConnectionMode,
	applyEdgeChanges,
	applyNodeChanges,
	useReactFlow,
	type Connection,
	type EdgeChange,
	type FinalConnectionState,
	type NodeChange,
} from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { QuickEntryDialog } from "../components/QuickEntryDialog";
import { CanvasEdge } from "./edges/CanvasEdge";
import {
	canvasToFlowEdges,
	canvasToFlowNodes,
	flowNodesToCanvas,
	type CanvasFlowEdge,
	type CanvasFlowNode,
} from "./flowAdapter";
import {
	addCanvasEdge,
	addCanvasNode,
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
	type CanvasClipboard,
} from "./operations";
import type { CanvasSide, JsonCanvasData, JsonCanvasNode, NodeBounds } from "./types";
import { CanvasCardNode } from "./nodes/CanvasCardNode";
import { CanvasGroupNode } from "./nodes/CanvasGroupNode";

const nodeTypes = { canvasCard: CanvasCardNode, canvasGroup: CanvasGroupNode };
const edgeTypes = { canvasEdge: CanvasEdge };
const SIDES = new Set(["top", "right", "bottom", "left"]);

const makeId = (prefix: string): string => {
	const random = typeof crypto.randomUUID === "function"
		? crypto.randomUUID()
		: `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	return `${prefix}-${random}`;
};

const isEditableTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof HTMLElement)) return false;
	return target.matches("input, textarea, [contenteditable='true']") || Boolean(target.closest("input, textarea, [contenteditable='true']"));
};

const sameIds = (current: Set<string>, next: string[]): boolean =>
	current.size === next.length && next.every((id) => current.has(id));

const fileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
	const reader = new FileReader();
	reader.onload = () => resolve(String(reader.result));
	reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
	reader.readAsDataURL(file);
});

interface CanvasWorkspaceProps {
	canvas: JsonCanvasData;
	onCommit: (canvas: JsonCanvasData) => void;
	onAskAi: (nodeId: string) => void;
	onGenerateImage: (nodeId: string) => void;
	onViewPrompt: (prompt: string) => void;
	onError: (message: string) => void;
}

interface ContextMenuState {
	x: number;
	y: number;
	nodeId: string;
}

interface NewCanvasNode {
	type: string;
	width: number;
	height: number;
	[key: string]: unknown;
}

interface ConnectionDropState {
	screenX: number;
	screenY: number;
	flowX: number;
	flowY: number;
	fromNodeId: string;
	fromSide?: CanvasSide;
}

const oppositeSide = (side: CanvasSide | undefined): CanvasSide | undefined => {
	if (side === "top") return "bottom";
	if (side === "right") return "left";
	if (side === "bottom") return "top";
	if (side === "left") return "right";
	return undefined;
};

function CanvasWorkspaceInner({ canvas, onCommit, onAskAi, onGenerateImage, onViewPrompt, onError }: CanvasWorkspaceProps) {
	const canvasRef = useRef(canvas);
	const nodesRef = useRef<CanvasFlowNode[]>([]);
	const edgesRef = useRef<CanvasFlowEdge[]>([]);
	const attachmentInput = useRef<HTMLInputElement>(null);
	const clipboard = useRef<CanvasClipboard | null>(null);
	const [nodes, setNodes] = useState<CanvasFlowNode[]>([]);
	const [edges, setEdges] = useState<CanvasFlowEdge[]>([]);
	const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
	const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(new Set());
	const [linkDialog, setLinkDialog] = useState(false);
	const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
	const [connectionDropMenu, setConnectionDropMenu] = useState<ConnectionDropState | null>(null);
	const [pendingCreation, setPendingCreation] = useState<ConnectionDropState | null>(null);
	const { screenToFlowPosition, fitView } = useReactFlow();

	useEffect(() => {
		canvasRef.current = canvas;
	}, [canvas]);

	const commit = useCallback((next: JsonCanvasData) => onCommit(next), [onCommit]);
	const patchNode = useCallback((id: string, patch: Record<string, unknown>) => commit(patchCanvasNode(canvasRef.current, id, patch)), [commit]);
	const patchEdge = useCallback((id: string, patch: Record<string, unknown>) => commit(patchCanvasEdge(canvasRef.current, id, patch)), [commit]);
	const resizeNode = useCallback((id: string, bounds: NodeBounds) => commit(updateNodeBounds(canvasRef.current, id, bounds)), [commit]);
	const deleteNode = useCallback((id: string) => commit(deleteCanvasSelection(canvasRef.current, new Set([id]), new Set())), [commit]);
	const deleteEdge = useCallback((id: string) => commit(deleteCanvasSelection(canvasRef.current, new Set(), new Set([id]))), [commit]);
	const duplicateNode = useCallback((id: string) => commit(duplicateCanvasNodes(canvasRef.current, new Set([id]), () => makeId("node"))), [commit]);

	const decorateNodes = useCallback((source: JsonCanvasData) => canvasToFlowNodes(source).map((node) => ({
		...node,
		data: {
			...node.data,
			onPatch: patchNode,
			onResize: resizeNode,
			onDelete: deleteNode,
			onDuplicate: duplicateNode,
			onAskAi,
			onGenerateImage,
			onViewPrompt,
		},
	})), [deleteNode, duplicateNode, onAskAi, onGenerateImage, onViewPrompt, patchNode, resizeNode]);

	const decorateEdges = useCallback((source: JsonCanvasData) => {
		const selectedIds = new Set(edgesRef.current.filter(({ selected }) => selected).map(({ id }) => id));
		return canvasToFlowEdges(source).map((edge) => ({
			...edge,
			selected: selectedIds.has(edge.id),
			data: { ...edge.data!, onPatch: patchEdge, onDelete: deleteEdge },
		}));
	}, [deleteEdge, patchEdge]);

	useEffect(() => {
		const nextNodes = decorateNodes(canvas);
		const nextEdges = decorateEdges(canvas);
		nodesRef.current = nextNodes;
		edgesRef.current = nextEdges;
		setNodes(nextNodes);
		setEdges(nextEdges);
	}, [canvas, decorateEdges, decorateNodes]);

	const changeNodes = useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
		setNodes((current) => {
			const next = applyNodeChanges(changes, current);
			nodesRef.current = next;
			return next;
		});
	}, []);

	const changeEdges = useCallback((changes: EdgeChange<CanvasFlowEdge>[]) => {
		setEdges((current) => {
			const next = applyEdgeChanges(changes, current);
			edgesRef.current = next;
			return next;
		});
	}, []);

	const changeSelection = useCallback(({
		nodes: selectedNodes,
		edges: selectedEdges,
	}: {
		nodes: CanvasFlowNode[];
		edges: CanvasFlowEdge[];
	}) => {
		const nodeIds = selectedNodes.map(({ id }) => id);
		const edgeIds = selectedEdges.map(({ id }) => id);
		setSelectedNodeIds((current) => sameIds(current, nodeIds) ? current : new Set(nodeIds));
		setSelectedEdgeIds((current) => sameIds(current, edgeIds) ? current : new Set(edgeIds));
	}, []);

	const createCanvasNode = useCallback((node: NewCanvasNode, connectionDrop?: ConnectionDropState | null) => {
		const position = connectionDrop
			? { x: connectionDrop.flowX, y: connectionDrop.flowY }
			: screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
		const nodeId = makeId("node");
		let next = addCanvasNode(canvasRef.current, {
			...node,
			id: nodeId,
			x: position.x - node.width / 2,
			y: connectionDrop ? position.y - 24 : position.y - node.height / 2,
		} as JsonCanvasNode);
		if (connectionDrop) {
			next = addCanvasEdge(next, {
				id: makeId("edge"),
				fromNode: connectionDrop.fromNodeId,
				fromSide: connectionDrop.fromSide,
				fromEnd: "none",
				toNode: nodeId,
				toSide: oppositeSide(connectionDrop.fromSide),
				toEnd: "arrow",
			});
		}
		commit(next);
	}, [commit, screenToFlowPosition]);

	const addNodeAtCenter = useCallback((node: NewCanvasNode) => createCanvasNode(node), [createCanvasNode]);

	const connect = useCallback((connection: Connection) => {
		if (!connection.source || !connection.target) return;
		const fromSide = connection.sourceHandle && SIDES.has(connection.sourceHandle) ? connection.sourceHandle as CanvasSide : undefined;
		const toSide = connection.targetHandle && SIDES.has(connection.targetHandle) ? connection.targetHandle as CanvasSide : undefined;
		commit(addCanvasEdge(canvasRef.current, {
			id: makeId("edge"),
			fromNode: connection.source,
			fromSide,
			fromEnd: "none",
			toNode: connection.target,
			toSide,
			toEnd: "arrow",
		}));
	}, [commit]);

	const finishConnection = useCallback((event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
		if (connectionState.isValid || !connectionState.fromNode || connectionState.toNode) return;
		const pointer = "changedTouches" in event ? event.changedTouches[0] : event;
		if (!pointer) return;
		const fromHandleId = connectionState.fromHandle?.id;
		const fromSide = fromHandleId && SIDES.has(fromHandleId) ? fromHandleId as CanvasSide : undefined;
		const flowPosition = screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY });
		setContextMenu(null);
		setConnectionDropMenu({
			screenX: Math.min(pointer.clientX, Math.max(12, window.innerWidth - 230)),
			screenY: Math.min(pointer.clientY, Math.max(12, window.innerHeight - 160)),
			flowX: flowPosition.x,
			flowY: flowPosition.y,
			fromNodeId: connectionState.fromNode.id,
			fromSide,
		});
	}, [screenToFlowPosition]);

	const removeSelection = useCallback(() => {
		if (!selectedNodeIds.size && !selectedEdgeIds.size) return;
		commit(deleteCanvasSelection(canvasRef.current, selectedNodeIds, selectedEdgeIds));
		setSelectedNodeIds(new Set());
		setSelectedEdgeIds(new Set());
	}, [commit, selectedEdgeIds, selectedNodeIds]);

	const duplicateSelection = useCallback(() => {
		if (!selectedNodeIds.size) return;
		commit(duplicateCanvasNodes(canvasRef.current, selectedNodeIds, () => makeId("node")));
	}, [commit, selectedNodeIds]);

	const copySelection = useCallback(() => {
		if (!selectedNodeIds.size) return;
		clipboard.current = copyCanvasSelection(canvasRef.current, selectedNodeIds);
		void navigator.clipboard?.writeText(JSON.stringify({
			type: "application/json-canvas-selection",
			...clipboard.current,
		})).catch(() => undefined);
	}, [selectedNodeIds]);

	const pasteSelection = useCallback(() => {
		if (!clipboard.current?.nodes.length) return;
		commit(pasteCanvasSelection(canvasRef.current, clipboard.current, () => makeId("node")));
	}, [commit]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (isEditableTarget(event.target)) return;
			if (event.key === "Delete" || event.key === "Backspace") {
				event.preventDefault();
				removeSelection();
			}
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
				event.preventDefault();
				duplicateSelection();
			}
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
				event.preventDefault();
				copySelection();
			}
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "x") {
				event.preventDefault();
				copySelection();
				removeSelection();
			}
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
				event.preventDefault();
				pasteSelection();
			}
			if (event.key === "Escape") {
				setContextMenu(null);
				setConnectionDropMenu(null);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [copySelection, duplicateSelection, pasteSelection, removeSelection]);

	const finishNodeDrag = useCallback((_event: MouseEvent | TouchEvent, draggedNode: CanvasFlowNode) => {
		const before = canvasRef.current;
		let next = flowNodesToCanvas(before, nodesRef.current);
		const original = before.nodes.find(({ id }) => id === draggedNode.id);
		if (original?.type === "group") {
			const moved = moveGroupWithContents(before, draggedNode.id, draggedNode.position.x, draggedNode.position.y);
			const positions = new Map(moved.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
			next = {
				...next,
				nodes: next.nodes.map((node) => ({ ...node, ...positions.get(node.id) })),
			};
		}
		commit(next);
	}, [commit]);

	const attachFile = async (file: File, connectionDrop?: ConnectionDropState | null) => {
		try {
			const isImage = file.type.startsWith("image/");
			const isText = file.type.startsWith("text/") || /\.(md|txt|json|csv)$/i.test(file.name);
			const custom = isImage
				? { web_asset: await fileAsDataUrl(file), web_asset_type: file.type }
				: isText
					? { web_file_text: await file.text(), web_asset_type: file.type }
					: {};
			createCanvasNode({ type: "file", file: file.name, width: isImage ? 460 : 380, height: isImage ? 320 : 240, ...custom }, connectionDrop);
		} catch (error) {
			onError(error instanceof Error ? error.message : String(error));
		}
	};

	const createGroup = () => {
		if (selectedNodeIds.size) {
			try {
				commit(groupCanvasNodes(canvasRef.current, selectedNodeIds, makeId("group"), "Group"));
			} catch (error) {
				onError(error instanceof Error ? error.message : String(error));
			}
			return;
		}
		addNodeAtCenter({ type: "group", label: "Group", width: 720, height: 440 });
	};

	const contextNode = contextMenu ? canvas.nodes.find(({ id }) => id === contextMenu.nodeId) : null;

	return (
		<div className="canvas-workspace">
			<ReactFlow
				nodes={nodes}
				edges={edges}
				nodeTypes={nodeTypes}
				edgeTypes={edgeTypes}
				onNodesChange={changeNodes}
				onEdgesChange={changeEdges}
				onConnect={connect}
				onConnectEnd={finishConnection}
				onNodeDragStop={finishNodeDrag}
				onReconnect={(oldEdge, connection) => {
					if (!connection.source || !connection.target) return;
					commit(reconnectCanvasEdge(canvasRef.current, oldEdge.id, {
						fromNode: connection.source,
						fromSide: connection.sourceHandle && SIDES.has(connection.sourceHandle) ? connection.sourceHandle as CanvasSide : undefined,
						toNode: connection.target,
						toSide: connection.targetHandle && SIDES.has(connection.targetHandle) ? connection.targetHandle as CanvasSide : undefined,
					}));
				}}
				onSelectionChange={changeSelection}
				onNodeContextMenu={(event, node) => {
					event.preventDefault();
					setConnectionDropMenu(null);
					setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
				}}
				onPaneClick={() => {
					setContextMenu(null);
					setConnectionDropMenu(null);
				}}
				connectionMode={ConnectionMode.Loose}
				deleteKeyCode={null}
				selectionKeyCode="Shift"
				multiSelectionKeyCode={["Meta", "Control"]}
				panOnDrag
				selectionOnDrag={false}
				fitView
				fitViewOptions={{ padding: 0.18, maxZoom: 1.05 }}
				minZoom={0.08}
				maxZoom={3}
			>
				<Background variant={BackgroundVariant.Dots} gap={20} size={1.25} />
				<Controls position="bottom-left" showInteractive={false} />
				<MiniMap position="bottom-right" pannable zoomable nodeColor={(node) => node.type === "canvasGroup" ? "var(--background-modifier-border)" : "var(--canvas-card)"} maskColor="var(--minimap-mask)" />
			</ReactFlow>

			<nav className="canvas-tool-rail" aria-label="Canvas tools">
				<button type="button" aria-label="Add text card" data-tooltip="Text card" onClick={() => addNodeAtCenter({ type: "text", text: "Start writing…", width: 360, height: 220 })}><MessageSquarePlus size={20} /></button>
				<button type="button" aria-label="Add file card" data-tooltip="File or image" onClick={() => { setPendingCreation(null); attachmentInput.current?.click(); }}><ImagePlus size={20} /></button>
				<button type="button" aria-label="Add link card" data-tooltip="Web link" onClick={() => { setPendingCreation(null); setLinkDialog(true); }}><Link2 size={20} /></button>
				<span className="rail-divider" />
				<button type="button" aria-label="Create group" data-tooltip={selectedNodeIds.size ? "Group selection" : "Group"} onClick={createGroup}><FolderKanban size={20} /></button>
				<button type="button" aria-label="Fit canvas to screen" data-tooltip="Fit view" onClick={() => fitView({ padding: 0.2, duration: 280 })}><BoxSelect size={20} /></button>
			</nav>

			<input
				ref={attachmentInput}
				className="visually-hidden"
				type="file"
				aria-label="Choose a canvas attachment"
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) void attachFile(file, pendingCreation);
					setPendingCreation(null);
					event.target.value = "";
				}}
			/>

			{linkDialog ? (
				<QuickEntryDialog
					title="Add a web link"
					label="URL"
					placeholder="https://example.com"
					submitLabel="Add link"
					onClose={() => { setLinkDialog(false); setPendingCreation(null); }}
					onSubmit={(url) => {
						createCanvasNode({ type: "link", url: /^https?:\/\//i.test(url) ? url : `https://${url}`, width: 360, height: 180 }, pendingCreation);
						setLinkDialog(false);
						setPendingCreation(null);
					}}
				/>
			) : null}

			{connectionDropMenu ? (
				<div
					className="context-menu connection-drop-menu"
					role="menu"
					aria-label="Create connected card"
					style={{ left: connectionDropMenu.screenX, top: connectionDropMenu.screenY }}
					onMouseDown={(event) => event.stopPropagation()}
				>
					<button type="button" role="menuitem" onClick={() => {
						createCanvasNode({ type: "text", text: "Start writing…", width: 360, height: 220 }, connectionDropMenu);
						setConnectionDropMenu(null);
					}}><MessageSquarePlus size={16} /> Text card</button>
					<button type="button" role="menuitem" onClick={() => {
						setPendingCreation(connectionDropMenu);
						setConnectionDropMenu(null);
						setLinkDialog(true);
					}}><Link2 size={16} /> Link card</button>
					<button type="button" role="menuitem" onClick={() => {
						setPendingCreation(connectionDropMenu);
						setConnectionDropMenu(null);
						attachmentInput.current?.click();
					}}><ImagePlus size={16} /> File or image</button>
				</div>
			) : null}

			{contextMenu && contextNode ? (
				<div className="context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
					<button type="button" role="menuitem" onClick={() => { onAskAi(contextNode.id); setContextMenu(null); }}><Sparkles size={16} /> Ask AI</button>
					<button type="button" role="menuitem" onClick={() => { onGenerateImage(contextNode.id); setContextMenu(null); }}><ImagePlus size={16} /> Generate image</button>
					{typeof contextNode.ai_image_prompt === "string" ? (
						<button type="button" role="menuitem" onClick={() => { onViewPrompt(contextNode.ai_image_prompt as string); setContextMenu(null); }}><FilePlus2 size={16} /> View image prompt</button>
					) : null}
					<button type="button" role="menuitem" onClick={() => { duplicateNode(contextNode.id); setContextMenu(null); }}><FolderKanban size={16} /> Duplicate</button>
					<span className="context-menu__divider" />
					<button type="button" role="menuitem" className="is-danger" onClick={() => { deleteNode(contextNode.id); setContextMenu(null); }}><Trash2 size={16} /> Delete</button>
				</div>
			) : null}
		</div>
	);
}

export function CanvasWorkspace(props: CanvasWorkspaceProps) {
	return <ReactFlowProvider><CanvasWorkspaceInner {...props} /></ReactFlowProvider>;
}
