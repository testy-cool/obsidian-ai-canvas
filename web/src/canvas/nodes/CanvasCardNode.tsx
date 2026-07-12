import DOMPurify from "dompurify";
import { marked } from "marked";
import {
	Copy,
	ExternalLink,
	FileText,
	Image as ImageIcon,
	MessageSquareText,
	Sparkles,
	Trash2,
} from "lucide-react";
import { memo, useMemo, useState } from "react";
import {
	Handle,
	NodeResizer,
	NodeToolbar,
	Position,
	type NodeProps,
} from "@xyflow/react";
import type { CanvasFlowNode } from "../flowAdapter";

const POSITIONS = [
	["top", Position.Top],
	["right", Position.Right],
	["bottom", Position.Bottom],
	["left", Position.Left],
] as const;

const cardColor = (color: unknown): string | undefined => {
	if (typeof color !== "string") return undefined;
	return /^[1-6]$/.test(color) ? `var(--canvas-color-${color})` : color;
};

const safeMarkdown = (source: string): string => {
	const rendered = marked.parse(source, { breaks: true, gfm: true });
	return DOMPurify.sanitize(typeof rendered === "string" ? rendered : source);
};

const fencedHtmlDocument = (source: string): string | null => {
	const match = /^```(<html>[\s\S]*<\/html>)\s*```$/i.exec(source.trim());
	return match?.[1] ?? null;
};

const hostname = (value: string): string => {
	try {
		return new URL(value).hostname.replace(/^www\./, "");
	} catch {
		return value;
	}
};

function CanvasCardNodeComponent({ id, data, selected }: NodeProps<CanvasFlowNode>) {
	const node = data.canvasNode;
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(node.type === "text" ? String(node.text ?? "") : "");
	const htmlDocument = useMemo(
		() => fencedHtmlDocument(node.type === "text" ? String(node.text ?? "") : ""),
		[node]
	);
	const markdown = useMemo(
		() => safeMarkdown(node.type === "text" ? String(node.text ?? "") : ""),
		[node]
	);
	const accent = cardColor(node.color);
	const prompt = typeof node.ai_image_prompt === "string" ? node.ai_image_prompt : null;

	const saveDraft = () => {
		if (node.type === "text" && draft !== node.text) data.onPatch?.(id, { text: draft });
		setEditing(false);
	};

	return (
		<article
			className={`canvas-card canvas-card--${node.type}${selected ? " is-selected" : ""}`}
			data-canvas-node-id={id}
			style={{ "--node-accent": accent } as React.CSSProperties}
			onDoubleClick={() => node.type === "text" && setEditing(true)}
		>
			<NodeResizer
				isVisible={selected}
				minWidth={180}
				minHeight={110}
				lineClassName="canvas-resizer-line"
				handleClassName="canvas-resizer-handle"
				onResizeEnd={(_event, bounds) => data.onResize?.(id, bounds)}
			/>
			{POSITIONS.map(([side, position]) => (
				<Handle key={side} id={side} type="source" position={position} className="canvas-handle" />
			))}

			<NodeToolbar className="node-toolbar" isVisible={selected} position={Position.Top}>
				<div className="node-toolbar__colors" aria-label="Card color">
					<button type="button" className="color-dot color-dot--clear" aria-label="Clear card color" onClick={() => data.onPatch?.(id, { color: undefined })} />
					{["1", "2", "3", "4", "5", "6"].map((color) => (
						<button key={color} type="button" className={`color-dot color-dot--${color}`} aria-label={`Use card color ${color}`} onClick={() => data.onPatch?.(id, { color })} />
					))}
				</div>
				<span className="toolbar-divider" />
				<button type="button" aria-label="Ask AI from this card" onClick={() => data.onAskAi?.(id)}><Sparkles size={16} /></button>
				<button type="button" aria-label="Generate image from this card" onClick={() => data.onGenerateImage?.(id)}><ImageIcon size={16} /></button>
				{prompt ? <button type="button" aria-label="View image prompt" onClick={() => data.onViewPrompt?.(prompt)}><MessageSquareText size={16} /></button> : null}
				<button type="button" aria-label="Duplicate card" onClick={() => data.onDuplicate?.(id)}><Copy size={16} /></button>
				<button type="button" aria-label="Delete card" onClick={() => data.onDelete?.(id)}><Trash2 size={16} /></button>
			</NodeToolbar>

			<div className="canvas-card__surface">
				{node.type === "text" ? (
					editing ? (
						<textarea
							className="canvas-card__editor nodrag nowheel"
							aria-label="Edit card text"
							autoFocus
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							onBlur={saveDraft}
							onKeyDown={(event) => {
								if ((event.metaKey || event.ctrlKey) && event.key === "Enter") saveDraft();
								if (event.key === "Escape") {
									setDraft(String(node.text ?? ""));
									setEditing(false);
								}
							}}
						/>
					) : (
						htmlDocument ? (
							<iframe
								className="canvas-card__html-preview"
								title="HTML preview"
								sandbox=""
								srcDoc={htmlDocument}
							/>
						) : (
							<div className="canvas-card__markdown" dangerouslySetInnerHTML={{ __html: markdown }} />
						)
					)
				) : null}

				{node.type === "file" ? (
					<div className="canvas-card__file">
						{typeof node.web_asset === "string" ? (
							<img src={node.web_asset} alt={String(node.file ?? "Canvas attachment")} draggable={false} />
						) : typeof node.web_file_text === "string" ? (
							<div className="canvas-card__markdown" dangerouslySetInnerHTML={{ __html: safeMarkdown(node.web_file_text) }} />
						) : (
							<div className="file-fallback">
								{/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(String(node.file)) ? <ImageIcon size={34} /> : <FileText size={34} />}
								<strong>{String(node.file ?? "File")}</strong>
								{node.subpath ? <span>{String(node.subpath)}</span> : null}
							</div>
						)}
						<div className="canvas-card__file-caption">{String(node.file ?? "File")}</div>
					</div>
				) : null}

				{node.type === "link" ? (
					<a className="canvas-card__link" href={String(node.url)} target="_blank" rel="noreferrer" draggable={false}>
						<span className="link-orbit"><ExternalLink size={22} /></span>
						<span className="link-host">{hostname(String(node.url))}</span>
						<span className="link-url">{String(node.url)}</span>
					</a>
				) : null}

				{!["text", "file", "link"].includes(node.type) ? (
					<div className="file-fallback"><FileText size={34} /><strong>{node.type}</strong><span>Unsupported custom node</span></div>
				) : null}
			</div>
		</article>
	);
}

export const CanvasCardNode = memo(CanvasCardNodeComponent);
