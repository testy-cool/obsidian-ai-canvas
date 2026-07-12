import { Check, Trash2 } from "lucide-react";
import { memo, useState } from "react";
import {
	BaseEdge,
	EdgeLabelRenderer,
	getSmoothStepPath,
	type EdgeProps,
} from "@xyflow/react";
import type { CanvasFlowEdge } from "../flowAdapter";
import type { CanvasLineStyle } from "../types";

const LINE_STYLES: CanvasLineStyle[] = ["solid", "dashed", "dotted"];
const LINE_WIDTHS = [
	{ label: "thin", value: 1.5 },
	{ label: "regular", value: 2 },
	{ label: "thick", value: 4 },
] as const;
const EDGE_COLORS = ["1", "2", "3", "4", "5", "6"];

function CanvasEdgeComponent(props: EdgeProps<CanvasFlowEdge>) {
	const [path, labelX, labelY] = getSmoothStepPath(props);
	const [label, setLabel] = useState(String(props.data?.canvasEdge.label ?? ""));
	const selected = Boolean(props.selected);
	const canvasEdge = props.data?.canvasEdge;
	const lineStyle: CanvasLineStyle = canvasEdge?.web_line_style === "dashed" || canvasEdge?.web_line_style === "dotted"
		? canvasEdge.web_line_style
		: "solid";
	const lineWidth = LINE_WIDTHS.some(({ value }) => value === canvasEdge?.web_line_width)
		? canvasEdge?.web_line_width
		: 2;

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
							<div className="canvas-edge-editor">
								<div className="canvas-edge-editor__label">
									<input aria-label="Edge label" value={label} onChange={(event) => setLabel(event.target.value)} onKeyDown={(event) => {
										if (event.key === "Enter") props.data?.onPatch?.(props.id, { label });
									}} />
									<button type="button" aria-label="Save edge label" onClick={() => props.data?.onPatch?.(props.id, { label })}><Check size={14} /></button>
									<button type="button" aria-label="Delete edge" onClick={() => props.data?.onDelete?.(props.id)}><Trash2 size={14} /></button>
								</div>
								<div className="canvas-edge-editor__appearance">
									<div className="canvas-edge-colors" role="group" aria-label="Edge color">
										<button
											type="button"
											className={`color-dot color-dot--clear${canvasEdge?.color ? "" : " is-active"}`}
											aria-label="Clear edge color"
											aria-pressed={!canvasEdge?.color}
											onClick={() => props.data?.onPatch?.(props.id, { color: undefined })}
										/>
										{EDGE_COLORS.map((color) => (
											<button
												key={color}
												type="button"
												className={`color-dot color-dot--${color}${canvasEdge?.color === color ? " is-active" : ""}`}
												aria-label={`Use edge color ${color}`}
												aria-pressed={canvasEdge?.color === color}
												onClick={() => props.data?.onPatch?.(props.id, { color })}
											/>
										))}
									</div>
									<span className="edge-style-divider" />
									<div className="edge-style-buttons" role="group" aria-label="Edge line style">
										{LINE_STYLES.map((style) => (
											<button
												key={style}
												type="button"
												className={`edge-style-button${lineStyle === style ? " is-active" : ""}`}
												aria-label={`Use ${style} edge`}
												aria-pressed={lineStyle === style}
												data-tooltip={style[0].toUpperCase() + style.slice(1)}
												onClick={() => props.data?.onPatch?.(props.id, { web_line_style: style === "solid" ? undefined : style })}
											>
												<span className={`edge-line-swatch edge-line-swatch--${style}`} />
											</button>
										))}
									</div>
									<div className="edge-style-buttons" role="group" aria-label="Edge thickness">
										{LINE_WIDTHS.map(({ label: widthLabel, value }) => (
											<button
												key={value}
												type="button"
												className={`edge-style-button${lineWidth === value ? " is-active" : ""}`}
												aria-label={`Use ${widthLabel} edge`}
												aria-pressed={lineWidth === value}
												data-tooltip={widthLabel[0].toUpperCase() + widthLabel.slice(1)}
												onClick={() => props.data?.onPatch?.(props.id, { web_line_width: value === 2 ? undefined : value })}
											>
												<span className="edge-width-swatch" style={{ height: value }} />
											</button>
										))}
									</div>
								</div>
							</div>
						) : props.data?.canvasEdge.label}
					</div>
				</EdgeLabelRenderer>
			) : null}
		</>
	);
}

export const CanvasEdge = memo(CanvasEdgeComponent);
