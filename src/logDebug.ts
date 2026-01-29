import { AugmentedCanvasSettings } from "./settings/AugmentedCanvasSettings";

let settings: AugmentedCanvasSettings | null = null;

export const initLogDebug = (settings2: AugmentedCanvasSettings) => {
	settings = settings2;
};

export const logDebug = (...params: any[]) => {
	if (settings?.debug) {
		console.log("[AI Canvas]", ...params);
	}
};
