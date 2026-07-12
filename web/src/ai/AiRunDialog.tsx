import { CheckSquare2, LoaderCircle, Settings2, SquareMousePointer } from "lucide-react";
import { useMemo, useState } from "react";
import { Modal } from "../components/Modal";
import type { JsonCanvasData, JsonCanvasNode } from "../canvas/types";
import { buildCanvasPrompt, collectPromptContext } from "./context";
import type { BrowserAiSettings } from "./settings";

interface AiRunDialogProps {
	canvas: JsonCanvasData;
	currentNodeId: string;
	settings: BrowserAiSettings;
	onRun: (prompt: string) => Promise<void>;
	onConfigure: () => void;
	onClose: () => void;
	mode?: "text" | "image";
}

const preview = (node: JsonCanvasNode): string => {
	if (node.type === "text") return String(node.text ?? "").replace(/[#*_`>-]/g, "").trim().slice(0, 120);
	if (node.type === "link") return String(node.url ?? "");
	if (node.type === "file") return String(node.file ?? "File");
	return String(node.label ?? node.type);
};

export function AiRunDialog({ canvas, currentNodeId, settings, onRun, onConfigure, onClose, mode = "text" }: AiRunDialogProps) {
	const entries = useMemo(() => collectPromptContext(canvas, currentNodeId), [canvas, currentNodeId]);
	const [selected, setSelected] = useState(() => new Set(entries.map(({ node }) => node.id)));
	const [instruction, setInstruction] = useState(
		mode === "image"
			? "Create an image from the selected canvas context."
			: "Respond to the current card using the selected context."
	);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const exactPrompt = useMemo(
		() => buildCanvasPrompt(canvas, currentNodeId, selected, instruction),
		[canvas, currentNodeId, instruction, selected]
	);
	const configured = Boolean(settings.apiKey.trim() && (mode === "image" ? settings.imageModel.trim() : settings.model.trim()) && settings.baseUrl.trim());
	const actionLabel = mode === "image" ? "Generate image" : "Generate response";

	const run = async () => {
		if (!configured || running) return;
		setRunning(true);
		setError(null);
		try {
			await onRun(exactPrompt);
		} catch (runError) {
			setError(runError instanceof Error ? runError.message : String(runError));
			setRunning(false);
		}
	};

	return (
		<Modal
			title={mode === "image" ? "Generate image" : "Ask AI"}
			onClose={onClose}
			wide
			footer={(
				<>
					{!configured ? <button type="button" className="button-secondary button-with-icon" onClick={onConfigure}><Settings2 size={16} /> Configure AI</button> : null}
					<span className="modal-footer__spacer" />
					<button type="button" className="button-secondary" onClick={onClose}>Cancel</button>
					<button type="button" className="button-primary button-with-icon" aria-label={actionLabel} disabled={!configured || running || !instruction.trim()} onClick={() => void run()}>
						{running ? <LoaderCircle className="spin" size={16} /> : <CheckSquare2 size={16} />}
						{running ? "Generating…" : actionLabel}
					</button>
				</>
			)}
		>
			<div className="ai-run-layout">
				<section className="ai-run-context">
					<div className="section-heading"><div><strong>Prompt context</strong><span>{selected.size} of {entries.length} cards</span></div><SquareMousePointer size={18} /></div>
					<div className="context-actions">
						<button type="button" onClick={() => setSelected(new Set(entries.map(({ node }) => node.id)))}>Select all</button>
						<button type="button" onClick={() => setSelected(new Set([currentNodeId]))}>Only current card</button>
					</div>
					<div className="context-list">
						{entries.map(({ node, depth, edgeLabel }) => {
							const current = node.id === currentNodeId;
							return (
								<label key={node.id} className={`context-option${current ? " is-current" : ""}`}>
									<input
										type="checkbox"
										aria-label={`Include ${node.id}`}
										checked={selected.has(node.id)}
										disabled={current}
										onChange={(event) => setSelected((previous) => {
											const next = new Set(previous);
											if (event.target.checked) next.add(node.id); else next.delete(node.id);
											return next;
										})}
									/>
									<span className="context-option__body"><span><strong>{current ? "Current card" : `${depth} step${depth === 1 ? "" : "s"} back`}</strong><em>{node.type}</em></span><small>{preview(node) || "Empty card"}</small>{edgeLabel ? <small className="edge-context">→ {edgeLabel}</small> : null}</span>
								</label>
							);
						})}
					</div>
				</section>
				<section className="ai-run-prompt">
					<label className="field-label">
						<span>Task for the model</span>
						<textarea aria-label="Task for the model" value={instruction} onChange={(event) => setInstruction(event.target.value)} />
					</label>
					<label className="field-label ai-exact-prompt">
						<span>Exact prompt sent to the API</span>
						<textarea aria-label="Exact prompt sent to the API" readOnly value={exactPrompt} />
					</label>
					{!configured ? <p className="inline-warning">Add an API key and an exact {mode === "image" ? "image " : ""}model ID before generating.</p> : null}
					{error ? <p className="inline-error" role="alert">{error}</p> : null}
				</section>
			</div>
		</Modal>
	);
}
