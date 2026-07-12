import type { JsonCanvasData } from "../canvas/types";
import { parseCanvasJson, serializeCanvas } from "../canvas/codec";

export interface CanvasFileHandle {
	name: string;
	createWritable?: () => Promise<{
		write: (value: string) => Promise<void> | void;
		close: () => Promise<void> | void;
	}>;
}

export interface CanvasFileLike {
	name: string;
	text: () => Promise<string>;
}

export const canvasFilename = (name: string): string => {
	const normalized = name.trim() || "Untitled";
	return normalized.toLowerCase().endsWith(".canvas") ? normalized : `${normalized}.canvas`;
};

export const readCanvasFile = async (file: CanvasFileLike): Promise<{ name: string; canvas: JsonCanvasData }> => {
	return { name: file.name, canvas: parseCanvasJson(await file.text()) };
};

export const writeCanvasHandle = async (handle: CanvasFileHandle, canvas: JsonCanvasData): Promise<void> => {
	if (!handle.createWritable) throw new Error("This file cannot be written by the browser");
	const writable = await handle.createWritable();
	await writable.write(serializeCanvas(canvas));
	await writable.close();
};

export const canvasBlob = (canvas: JsonCanvasData): Blob =>
	new Blob([serializeCanvas(canvas)], { type: "application/json" });

export const downloadCanvas = (canvas: JsonCanvasData, name: string): void => {
	const url = URL.createObjectURL(canvasBlob(canvas));
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = canvasFilename(name);
	anchor.click();
	URL.revokeObjectURL(url);
};
