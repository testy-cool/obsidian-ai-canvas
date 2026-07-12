import {
	Download,
	FilePlus2,
	FolderOpen,
	Settings2,
	Moon,
	PackageOpen,
	Redo2,
	Save,
	Sun,
	Undo2,
} from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { CanvasWorkspace } from "./canvas/CanvasWorkspace";
import { WELCOME_CANVAS } from "./canvas/demoCanvas";
import { appendGeneratedImageNode, appendGeneratedTextNode } from "./canvas/operations";
import type { JsonCanvasData } from "./canvas/types";
import { Modal } from "./components/Modal";
import { AiRunDialog } from "./ai/AiRunDialog";
import { AiSettingsDialog } from "./ai/AiSettingsDialog";
import { requestAiImage, requestAiText } from "./ai/client";
import { loadAiSettings, saveAiSettings, type BrowserAiSettings } from "./ai/settings";
import {
	downloadCanvas,
	readCanvasFile,
	writeCanvasHandle,
	type CanvasFileHandle,
} from "./files/fileAccess";
import { createCanvasDocument, reduceCanvasDocument } from "./state/documentState";
import { loadCanvasDraft, saveCanvasDraft } from "./state/draftStorage";
import { createCanvasArchive, readCanvasArchive } from "./files/archive";

interface PickerFileHandle extends CanvasFileHandle {
	getFile: () => Promise<File>;
}

interface PickerWindow extends Window {
	showOpenFilePicker?: (options: Record<string, unknown>) => Promise<PickerFileHandle[]>;
	showSaveFilePicker?: (options: Record<string, unknown>) => Promise<PickerFileHandle>;
}

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";
const isEditableTarget = (target: EventTarget | null): boolean => target instanceof HTMLElement && Boolean(target.closest("input, textarea, [contenteditable='true']"));
const makeId = (prefix: string): string => `${prefix}-${typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

export function App() {
	const [documentState, dispatch] = useReducer(
		reduceCanvasDocument,
		undefined,
		() => {
			const draft = loadCanvasDraft(localStorage);
			return createCanvasDocument(draft?.canvas ?? WELCOME_CANVAS, draft?.name ?? "Welcome");
		}
	);
	const [theme, setTheme] = useState<"dark" | "light">("dark");
	const [titleDraft, setTitleDraft] = useState(documentState.name);
	const [promptPreview, setPromptPreview] = useState<string | null>(null);
	const [aiNodeId, setAiNodeId] = useState<string | null>(null);
	const [aiMode, setAiMode] = useState<"text" | "image">("text");
	const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
	const [aiSettings, setAiSettings] = useState<BrowserAiSettings>(() => loadAiSettings(localStorage));
	const [notice, setNotice] = useState<string | null>(null);
	const openInput = useRef<HTMLInputElement>(null);

	useEffect(() => setTitleDraft(documentState.name), [documentState.name]);

	const report = useCallback((message: string) => {
		setNotice(message);
		window.setTimeout(() => setNotice((current) => current === message ? null : current), 3600);
	}, []);

	useEffect(() => {
		const timeout = window.setTimeout(() => {
			try {
				saveCanvasDraft(localStorage, {
					name: documentState.name,
					canvas: documentState.history.present,
				});
			} catch {
				report("This canvas is too large for browser draft recovery. Save or download it instead.");
			}
		}, 250);
		return () => window.clearTimeout(timeout);
	}, [documentState.history.present, documentState.name, report]);

	useEffect(() => {
		if (!documentState.dirty || !documentState.handle?.createWritable) return;
		const timeout = window.setTimeout(() => {
			void writeCanvasHandle(documentState.handle!, documentState.history.present)
				.then(() => dispatch({ type: "saved", handle: documentState.handle }))
				.catch((error) => report(error instanceof Error ? error.message : String(error)));
		}, 850);
		return () => window.clearTimeout(timeout);
	}, [documentState.dirty, documentState.handle, documentState.history.present, report]);

	const commit = useCallback((canvas: JsonCanvasData) => dispatch({ type: "commit", canvas }), []);

	const loadFile = useCallback(async (file: File, handle: CanvasFileHandle | null = null) => {
		try {
			const zipped = file.name.toLowerCase().endsWith(".zip");
			const loaded = zipped
				? readCanvasArchive(new Uint8Array(await file.arrayBuffer()))
				: await readCanvasFile(file);
			dispatch({ type: "load", ...loaded, handle: zipped ? null : handle });
			report(`Opened ${loaded.name}`);
		} catch (error) {
			report(error instanceof Error ? error.message : String(error));
		}
	}, [report]);

	const openCanvas = useCallback(async () => {
		if (documentState.dirty && !window.confirm("Discard the unsaved changes and open another canvas?")) return;
		const picker = window as PickerWindow;
		if (!picker.showOpenFilePicker) {
			openInput.current?.click();
			return;
		}
		try {
			const [handle] = await picker.showOpenFilePicker({
				multiple: false,
				types: [
					{ description: "JSON Canvas", accept: { "application/json": [".canvas"] } },
					{ description: "Portable Canvas ZIP", accept: { "application/zip": [".zip"] } },
				],
			});
			if (handle) await loadFile(await handle.getFile(), handle);
		} catch (error) {
			if (!isAbort(error)) report(error instanceof Error ? error.message : String(error));
		}
	}, [documentState.dirty, loadFile, report]);

	const saveCanvas = useCallback(async () => {
		try {
			let handle = documentState.handle;
			if (!handle?.createWritable) {
				const picker = window as PickerWindow;
				if (!picker.showSaveFilePicker) {
					downloadCanvas(documentState.history.present, documentState.name);
					dispatch({ type: "saved", handle: null });
					report("Canvas downloaded");
					return;
				}
				handle = await picker.showSaveFilePicker({
					suggestedName: `${documentState.name}.canvas`,
					types: [{ description: "JSON Canvas", accept: { "application/json": [".canvas"] } }],
				});
			}
			await writeCanvasHandle(handle, documentState.history.present);
			dispatch({ type: "saved", handle });
			report(`Saved ${handle.name}`);
		} catch (error) {
			if (!isAbort(error)) report(error instanceof Error ? error.message : String(error));
		}
	}, [documentState, report]);

	const newCanvas = () => {
		if (documentState.dirty && !window.confirm("Discard the unsaved changes and create a new canvas?")) return;
		dispatch({ type: "load", canvas: { nodes: [], edges: [] }, name: "Untitled", handle: null });
	};

	const downloadPortableArchive = () => {
		const bytes = createCanvasArchive(documentState.history.present, documentState.name);
		const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
		const url = URL.createObjectURL(new Blob([data], { type: "application/zip" }));
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = `${documentState.name.replace(/\.canvas$/i, "") || "Untitled"}.zip`;
		anchor.click();
		URL.revokeObjectURL(url);
	};

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey) || isEditableTarget(event.target)) return;
			if (event.key.toLowerCase() === "s") {
				event.preventDefault();
				void saveCanvas();
			}
			if (event.key.toLowerCase() === "z") {
				event.preventDefault();
				dispatch({ type: event.shiftKey ? "redo" : "undo" });
			}
	};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [saveCanvas]);

	const history = documentState.history;
	const aiNode = aiNodeId ? history.present.nodes.find(({ id }) => id === aiNodeId) : null;
	const storeAiSettings = (settings: BrowserAiSettings) => {
		saveAiSettings(localStorage, settings);
		setAiSettings(settings);
		setAiSettingsOpen(false);
		report("AI provider settings saved");
	};
	const runAi = async (prompt: string) => {
		if (!aiNodeId) return;
		if (aiMode === "image") {
			const image = await requestAiImage(aiSettings, prompt);
			const extension = image.mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
			dispatch({
				type: "commit",
				canvas: appendGeneratedImageNode(
					history.present,
					aiNodeId,
					makeId("image"),
					`generated/ai-image-${Date.now()}.${extension}`,
					image.src,
					image.mimeType,
					prompt,
					makeId("edge")
				),
			});
		} else {
			const answer = await requestAiText(aiSettings, prompt);
			dispatch({
				type: "commit",
				canvas: appendGeneratedTextNode(history.present, aiNodeId, makeId("ai"), answer, makeId("edge")),
			});
		}
		setAiNodeId(null);
		report(aiMode === "image" ? "Generated image added to the canvas" : "AI response added to the canvas");
	};

	return (
		<div className="app-shell" data-theme={theme}>
			<header className="top-bar">
				<div className="top-bar__brand" aria-label="Canvas home">
					<span className="brand-mark"><span /><span /><span /></span>
					<span>Canvas</span>
				</div>
				<span className="top-bar__divider" />
				<div className="file-actions">
					<button type="button" className="icon-button" aria-label="New canvas" data-tooltip="New" onClick={newCanvas}><FilePlus2 size={18} /></button>
					<button type="button" className="icon-button" aria-label="Open canvas" data-tooltip="Open" onClick={() => void openCanvas()}><FolderOpen size={18} /></button>
					<button type="button" className="icon-button" aria-label="Save canvas" data-tooltip="Save" onClick={() => void saveCanvas()}><Save size={18} /></button>
					<button type="button" className="icon-button" aria-label="Export canvas" data-tooltip="Download copy" onClick={() => downloadCanvas(history.present, documentState.name)}><Download size={18} /></button>
					<button type="button" className="icon-button" aria-label="Export portable ZIP" data-tooltip="Canvas + attachments" onClick={downloadPortableArchive}><PackageOpen size={18} /></button>
				</div>
				<div className="document-title">
					<input
						aria-label="Canvas name"
						value={titleDraft}
						onChange={(event) => setTitleDraft(event.target.value)}
						onBlur={() => dispatch({ type: "rename", name: titleDraft })}
						onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
					/>
					{documentState.dirty ? <span className="save-state">Unsaved</span> : <span className="save-state save-state--clean">Saved</span>}
				</div>
				<div className="history-actions">
					<button type="button" className="icon-button" aria-label="Undo" disabled={!history.past.length} onClick={() => dispatch({ type: "undo" })}><Undo2 size={18} /></button>
					<button type="button" className="icon-button" aria-label="Redo" disabled={!history.future.length} onClick={() => dispatch({ type: "redo" })}><Redo2 size={18} /></button>
					<button type="button" className="icon-button" aria-label="Configure AI" data-tooltip="AI provider" onClick={() => setAiSettingsOpen(true)}><Settings2 size={18} /></button>
					<button
						type="button"
						className="icon-button"
						aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}
						onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
					>
						{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
					</button>
				</div>
			</header>

			<main className="app-main">
				<CanvasWorkspace
					canvas={history.present}
					onCommit={commit}
					onAskAi={(nodeId) => { setAiMode("text"); setAiNodeId(nodeId); }}
					onGenerateImage={(nodeId) => { setAiMode("image"); setAiNodeId(nodeId); }}
					onViewPrompt={setPromptPreview}
					onError={report}
				/>
			</main>

			<input
				ref={openInput}
				className="visually-hidden"
				type="file"
				accept=".canvas,.zip,application/json,application/zip"
				aria-label="Choose a JSON Canvas file"
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) void loadFile(file);
					event.target.value = "";
				}}
			/>

			{promptPreview ? (
				<Modal
					title="Image generation prompt"
					onClose={() => setPromptPreview(null)}
					wide
					footer={<button type="button" className="button-primary" onClick={() => { void navigator.clipboard?.writeText(promptPreview); report("Prompt copied"); }}>Copy prompt</button>}
				>
					<p className="modal-lede">This is the exact prompt stored on the image card and sent when the image was generated.</p>
					<textarea className="prompt-preview" readOnly value={promptPreview} aria-label="Image generation prompt" />
				</Modal>
			) : null}

			{aiNodeId && aiNode ? (
				<AiRunDialog
					canvas={history.present}
					currentNodeId={aiNodeId}
					settings={aiSettings}
					mode={aiMode}
					onRun={runAi}
					onConfigure={() => setAiSettingsOpen(true)}
					onClose={() => setAiNodeId(null)}
				/>
			) : null}

			{aiSettingsOpen ? <AiSettingsDialog settings={aiSettings} onSave={storeAiSettings} onClose={() => setAiSettingsOpen(false)} /> : null}

			{notice ? <div className="notice" role="status">{notice}</div> : null}
		</div>
	);
}
