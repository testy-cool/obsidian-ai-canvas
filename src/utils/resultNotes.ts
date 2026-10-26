import { App, TFile } from "obsidian";
import { CanvasNode } from "../obsidian/canvas-internal";

export const DEFAULT_RESULT_NOTE_THRESHOLD = 5000;

export function shouldSaveResultNote(text: string, threshold = DEFAULT_RESULT_NOTE_THRESHOLD): boolean {
	return Number.isFinite(threshold) && threshold > 0 && text.length > threshold;
}

export async function createResultNote(app: App, text: string, sourcePath?: string, prefix = "Canvas result"): Promise<TFile> {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const path = await app.fileManager.getAvailablePathForAttachment(`${prefix}-${timestamp}.md`, sourcePath);
	return app.vault.create(path, text);
}

export function resultNoteData(data: Record<string, any>, path: string): Record<string, any> {
	const { text: _text, url: _url, subpath: _subpath, ...rest } = data;
	return { ...rest, type: "file", file: path, result_note: true };
}

/** Canvas importData alone keeps the old node class when its ID already exists. */
export function replaceResultCard(node: CanvasNode, data: Record<string, any>): CanvasNode | undefined {
	const canvas = node.canvas;
	if (!Array.from(canvas.nodes.values()).includes(node)) return;
	const before = canvas.getData();
	const selected = canvas.selection.has(node);
	const next = { ...before, nodes: before.nodes.map(current => current.id === node.id ? data : current) };
	canvas.removeNode(node);
	try {
		canvas.importData(next);
	} catch (error) {
		// Keep the original readable result and connections if native import fails.
		canvas.importData(before);
		throw error;
	}
	const replacement = Array.from(canvas.nodes.values()).find(current => current.id === node.id);
	if (selected && replacement) (canvas as any).select(replacement);
	void canvas.requestSave();
	void canvas.requestFrame();
	return replacement;
}
