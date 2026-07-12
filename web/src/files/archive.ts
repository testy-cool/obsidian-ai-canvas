import type { JsonCanvasData } from "../canvas/types";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { parseCanvasJson, serializeCanvas } from "../canvas/codec";
import { canvasFilename } from "./fileAccess";

export interface LoadedCanvasArchive {
	name: string;
	canvas: JsonCanvasData;
}

const MIME_BY_EXTENSION: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	svg: "image/svg+xml",
	md: "text/markdown",
	txt: "text/plain",
	json: "application/json",
	csv: "text/csv",
};

const extension = (path: string): string => path.split(".").pop()?.toLowerCase() ?? "";
const basename = (path: string): string => path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "asset";
const safeAssetPath = (path: string, id: string, mimeType: string): string => {
	const normalized = path.replace(/\\/g, "/");
	const parts = normalized.split("/").filter((part) => part && part !== ".");
	const unsafe = normalized.startsWith("/") || parts.includes("..") || /^[a-z]+:/i.test(normalized);
	let result = unsafe || !parts.length ? `assets/${basename(normalized) || id}` : parts.join("/");
	if (!extension(result)) {
		const inferred = Object.entries(MIME_BY_EXTENSION).find(([, mime]) => mime === mimeType)?.[0] ?? "bin";
		result = `${result}.${inferred}`;
	}
	return result;
};

const decodeDataUrl = (value: string): { bytes: Uint8Array; mimeType: string } | null => {
	const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(value);
	if (!match) return null;
	const mimeType = match[1] || "application/octet-stream";
	if (match[2]) {
		const binary = atob(match[3]);
		return { bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)), mimeType };
	}
	return { bytes: strToU8(decodeURIComponent(match[3])), mimeType };
};

const encodeBase64 = (bytes: Uint8Array): string => {
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	}
	return btoa(binary);
};

export const createCanvasArchive = (canvas: JsonCanvasData, name: string): Uint8Array => {
	const exported = structuredClone(canvas);
	const files: Record<string, Uint8Array> = {};
	for (const node of exported.nodes) {
		if (node.type !== "file" || typeof node.file !== "string") continue;
		const embedded = typeof node.web_asset === "string" ? decodeDataUrl(node.web_asset) : null;
		const text = typeof node.web_file_text === "string" ? node.web_file_text : null;
		if (!embedded && text === null) continue;
		const mimeType = embedded?.mimeType || (typeof node.web_asset_type === "string" ? node.web_asset_type : MIME_BY_EXTENSION[extension(node.file)] || "text/plain");
		const path = safeAssetPath(node.file, node.id, mimeType);
		files[path] = embedded?.bytes ?? strToU8(text!);
		node.file = path;
		delete node.web_asset;
		delete node.web_asset_type;
		delete node.web_file_text;
	}
	const archiveName = canvasFilename(basename(name));
	files[archiveName] = strToU8(serializeCanvas(exported));
	return zipSync(files, { level: 6 });
};

export const readCanvasArchive = (source: Uint8Array): LoadedCanvasArchive => {
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(source);
	} catch (error) {
		throw new Error(`Invalid canvas ZIP: ${error instanceof Error ? error.message : String(error)}`);
	}
	const canvasPath = Object.keys(files).find((path) => path.toLowerCase().endsWith(".canvas"));
	if (!canvasPath) throw new Error("This ZIP does not contain a .canvas file");
	const canvas = parseCanvasJson(strFromU8(files[canvasPath]));
	const baseDirectory = canvasPath.includes("/") ? canvasPath.slice(0, canvasPath.lastIndexOf("/") + 1) : "";
	for (const node of canvas.nodes) {
		if (node.type !== "file" || typeof node.file !== "string") continue;
		const path = node.file.replace(/\\/g, "/");
		const bytes = files[path] ?? files[`${baseDirectory}${path}`];
		if (!bytes) continue;
		const mimeType = MIME_BY_EXTENSION[extension(path)] || "application/octet-stream";
		if (mimeType.startsWith("image/")) {
			node.web_asset = `data:${mimeType};base64,${encodeBase64(bytes)}`;
			node.web_asset_type = mimeType;
		} else if (mimeType.startsWith("text/") || mimeType === "application/json") {
			node.web_file_text = strFromU8(bytes);
			node.web_asset_type = mimeType;
		}
	}
	return { name: basename(canvasPath), canvas };
};
