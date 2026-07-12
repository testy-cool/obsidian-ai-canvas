import type { JsonCanvasData } from "../canvas/types";
import { parseCanvasJson } from "../canvas/codec";

export interface CanvasDraft {
	name: string;
	canvas: JsonCanvasData;
}

export interface DraftStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

const DRAFT_KEY = "obsidian-ai-canvas:web-draft";

export const loadCanvasDraft = (storage: DraftStorage): CanvasDraft | null => {
	try {
		const raw = storage.getItem(DRAFT_KEY);
		if (!raw) return null;
		const value: unknown = JSON.parse(raw);
		if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
		const draft = value as { name?: unknown; canvas?: unknown };
		if (typeof draft.name !== "string" || !draft.name.trim() || !draft.canvas) return null;
		return { name: draft.name, canvas: parseCanvasJson(JSON.stringify(draft.canvas)) };
	} catch {
		return null;
	}
};

export const saveCanvasDraft = (storage: DraftStorage, draft: CanvasDraft): void => {
	storage.setItem(DRAFT_KEY, JSON.stringify(draft));
};
