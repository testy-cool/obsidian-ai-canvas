import { memo, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import type { CanvasFlowNode } from "../flowAdapter";

function CanvasGroupNodeComponent({ id, data, selected }: NodeProps<CanvasFlowNode>) {
	const node = data.canvasNode;
	const [editing, setEditing] = useState(false);
	const [label, setLabel] = useState(String(node.label ?? "Group"));
	const color = typeof node.color === "string"
		? (/^[1-6]$/.test(node.color) ? `var(--canvas-color-${node.color})` : node.color)
		: undefined;

	return (
		<section
			className={`canvas-group${selected ? " is-selected" : ""}`}
			data-canvas-node-id={id}
			style={{ "--node-accent": color } as React.CSSProperties}
		>
			<NodeResizer
				isVisible={selected}
				minWidth={280}
				minHeight={180}
				onResizeEnd={(_event, bounds) => data.onResize?.(id, bounds)}
			/>
			{editing ? (
				<input
					className="canvas-group__label nodrag"
					aria-label="Edit group label"
					autoFocus
					value={label}
					onChange={(event) => setLabel(event.target.value)}
					onBlur={() => {
						data.onPatch?.(id, { label });
						setEditing(false);
					}}
				/>
			) : (
				<button type="button" className="canvas-group__label" onDoubleClick={() => setEditing(true)}>{label}</button>
			)}
		</section>
	);
}

export const CanvasGroupNode = memo(CanvasGroupNodeComponent);
