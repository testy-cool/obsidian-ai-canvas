import { Check, Trash2 } from "lucide-react";
import { memo, useState } from "react";
import {
	BaseEdge,
	EdgeLabelRenderer,
	getSmoothStepPath,
	type EdgeProps,
} from "@xyflow/react";
import type { CanvasFlowEdge } from "../flowAdapter";

function CanvasEdgeComponent(props: EdgeProps<CanvasFlowEdge>) {
	const [path, labelX, labelY] = getSmoothStepPath(props);
	const [label, setLabel] = useState(String(props.data?.canvasEdge.label ?? ""));
	const selected = Boolean(props.selected);

	return (
		<>
			<BaseEdge
				path={path}
				markerStart={props.markerStart}
				markerEnd={props.markerEnd}
				style={props.style}
				interactionWidth={24}
			/>
			{props.data?.canvasEdge.label || selected ? (
				<EdgeLabelRenderer>
					<div
						className={`canvas-edge-label${selected ? " is-selected" : ""} nodrag nopan`}
						style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
					>
						{selected ? (
							<>
								<input aria-label="Edge label" value={label} onChange={(event) => setLabel(event.target.value)} onKeyDown={(event) => {
									if (event.key === "Enter") props.data?.onPatch?.(props.id, { label });
								}} />
								<button type="button" aria-label="Save edge label" onClick={() => props.data?.onPatch?.(props.id, { label })}><Check size={14} /></button>
								<button type="button" aria-label="Delete edge" onClick={() => props.data?.onDelete?.(props.id)}><Trash2 size={14} /></button>
							</>
						) : props.data?.canvasEdge.label}
					</div>
				</EdgeLabelRenderer>
			) : null}
		</>
	);
}

export const CanvasEdge = memo(CanvasEdgeComponent);
