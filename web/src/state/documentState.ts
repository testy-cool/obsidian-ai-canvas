import type { CanvasHistory } from "../canvas/history";
import { createHistory, pushHistory, redoHistory, undoHistory } from "../canvas/history";
import type { JsonCanvasData } from "../canvas/types";
import type { CanvasFileHandle } from "../files/fileAccess";

export interface CanvasDocumentState {
	name: string;
	dirty: boolean;
	history: CanvasHistory;
	handle: CanvasFileHandle | null;
	savedRevision: string;
}

export type CanvasDocumentAction =
	| { type: "commit"; canvas: JsonCanvasData }
	| { type: "undo" }
	| { type: "redo" }
	| { type: "load"; canvas: JsonCanvasData; name: string; handle?: CanvasFileHandle | null }
	| { type: "saved"; handle?: CanvasFileHandle | null }
	| { type: "rename"; name: string };

const revision = (canvas: JsonCanvasData): string => JSON.stringify(canvas);
const cleanName = (name: string): string => name.replace(/\.canvas$/i, "").trim() || "Untitled";

export const createCanvasDocument = (canvas: JsonCanvasData, name: string): CanvasDocumentState => {
	return {
		name: cleanName(name),
		dirty: false,
		history: createHistory(canvas),
		handle: null,
		savedRevision: revision(canvas),
	};
};

export const reduceCanvasDocument = (
	state: CanvasDocumentState,
	action: CanvasDocumentAction
): CanvasDocumentState => {
	switch (action.type) {
		case "commit": {
			const history = pushHistory(state.history, action.canvas);
			if (history === state.history) return state;
			return { ...state, history, dirty: revision(history.present) !== state.savedRevision };
		}
		case "undo": {
			const history = undoHistory(state.history);
			if (history === state.history) return state;
			return { ...state, history, dirty: revision(history.present) !== state.savedRevision };
		}
		case "redo": {
			const history = redoHistory(state.history);
			if (history === state.history) return state;
			return { ...state, history, dirty: revision(history.present) !== state.savedRevision };
		}
		case "load":
			return {
				name: cleanName(action.name),
				dirty: false,
				history: createHistory(action.canvas),
				handle: action.handle ?? null,
				savedRevision: revision(action.canvas),
			};
		case "saved":
			return {
				...state,
				dirty: false,
				handle: action.handle === undefined ? state.handle : action.handle,
				savedRevision: revision(state.history.present),
			};
		case "rename": {
			const name = cleanName(action.name);
			return name === state.name ? state : { ...state, name, dirty: true };
		}
	}
};
