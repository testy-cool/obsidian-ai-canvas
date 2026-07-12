import type { JsonCanvasData } from "./types";

export interface CanvasHistory {
	past: JsonCanvasData[];
	present: JsonCanvasData;
	future: JsonCanvasData[];
}

const cloneCanvas = (canvas: JsonCanvasData): JsonCanvasData => structuredClone(canvas);
const canvasKey = (canvas: JsonCanvasData): string => JSON.stringify(canvas);

export const createHistory = (initial: JsonCanvasData): CanvasHistory => {
	return { past: [], present: cloneCanvas(initial), future: [] };
};

export const pushHistory = (history: CanvasHistory, next: JsonCanvasData): CanvasHistory => {
	if (canvasKey(history.present) === canvasKey(next)) return history;
	return {
		past: [...history.past, history.present],
		present: cloneCanvas(next),
		future: [],
	};
};

export const undoHistory = (history: CanvasHistory): CanvasHistory => {
	const previous = history.past.at(-1);
	if (!previous) return history;
	return {
		past: history.past.slice(0, -1),
		present: cloneCanvas(previous),
		future: [history.present, ...history.future],
	};
};

export const redoHistory = (history: CanvasHistory): CanvasHistory => {
	const next = history.future[0];
	if (!next) return history;
	return {
		past: [...history.past, history.present],
		present: cloneCanvas(next),
		future: history.future.slice(1),
	};
};
