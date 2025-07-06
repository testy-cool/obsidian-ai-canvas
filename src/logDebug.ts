import { Notice } from "obsidian";
import { AugmentedCanvasSettings } from "./settings/AugmentedCanvasSettings";

let settings: AugmentedCanvasSettings | null = null;

export const initLogDebug = (settings2: AugmentedCanvasSettings) => {
	settings = settings2;
};

export const logDebug = (...params: any[]) => {
	if (settings?.debug) {
		const message = params.map(p => typeof p === 'string' ? p : JSON.stringify(p)).join(' ');
		new Notice(message);
		console.log(...params);
	}
};
