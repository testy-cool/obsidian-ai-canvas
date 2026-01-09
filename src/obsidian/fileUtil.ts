import {
	App,
	TAbstractFile,
	TFile,
	TFolder,
	loadPdfJs,
	resolveSubpath,
} from "obsidian";
import { Canvas, CanvasNode, CreateNodeOptions } from "./canvas-internal";
import { AugmentedCanvasSettings } from "src/settings/AugmentedCanvasSettings";

const IMAGE_MIME_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	bmp: "image/bmp",
	tif: "image/tiff",
	tiff: "image/tiff",
	svg: "image/svg+xml",
};

const IMAGE_EXTENSIONS_BY_MIME: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/jpg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
	"image/bmp": "bmp",
	"image/tiff": "tiff",
	"image/svg+xml": "svg",
};

const MEDIA_MIME_TYPES: Record<string, string> = {
	...IMAGE_MIME_TYPES,
	mp4: "video/mp4",
	m4v: "video/x-m4v",
	mov: "video/quicktime",
	mkv: "video/x-matroska",
	webm: "video/webm",
	ogv: "video/ogg",
	mpeg: "video/mpeg",
	mpg: "video/mpeg",
	avi: "video/x-msvideo",
	flv: "video/x-flv",
	wmv: "video/x-ms-wmv",
	"3gp": "video/3gpp",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	m4a: "audio/mp4",
	aac: "audio/aac",
	flac: "audio/flac",
	oga: "audio/ogg",
	ogg: "audio/ogg",
	opus: "audio/opus",
};

const MAX_INLINE_MEDIA_BYTES = 20 * 1024 * 1024;

const getImageMimeType = (extension: string) =>
	IMAGE_MIME_TYPES[extension.toLowerCase()] || null;
const getMediaMimeType = (extension: string) =>
	MEDIA_MIME_TYPES[extension.toLowerCase()] || null;
const getImageExtensionForMime = (mimeType?: string) =>
	IMAGE_EXTENSIONS_BY_MIME[mimeType?.toLowerCase() || ""] || "png";

const normalizeFileToken = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[-_]+|[-_]+$/g, "");

export const buildImageFileName = (prefix: string, mimeType?: string) => {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const extension = getImageExtensionForMime(mimeType);
	const safePrefix = normalizeFileToken(prefix) || "image";
	return `${safePrefix}-generated-${timestamp}.${extension}`;
};

export const buildResponseFileName = (prefix: string) => {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const safePrefix = normalizeFileToken(prefix) || "response";
	return `${safePrefix}-generated-${timestamp}.json`;
};

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
	const bytes = new Uint8Array(buffer);
	const chunkSize = 0x8000;
	let binary = "";
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}
	return btoa(binary);
};

export async function readFileContent(
	app: App,
	file: TFile,
	subpath?: string | undefined
) {
	// TODO: remove frontmatter
	const body = await app.vault.read(file);

	if (subpath) {
		const cache = app.metadataCache.getFileCache(file);
		if (cache) {
			const resolved = resolveSubpath(cache, subpath);
			if (!resolved) {
				console.warn("Failed to get subpath", { file, subpath });
				return body;
			}
			if (resolved.start || resolved.end) {
				const subText = body.slice(
					resolved.start.offset,
					resolved.end?.offset
				);
				if (subText) {
					return subText;
				} else {
					console.warn("Failed to get subpath", { file, subpath });
					return body;
				}
			}
		}
	}

	return body;
}

const pdfToMarkdown = async (app: App, file: TFile) => {
	const pdfjsLib = await loadPdfJs();

	const pdfBuffer = await app.vault.readBinary(file);
	const loadingTask = pdfjsLib.getDocument({ data: pdfBuffer });
	const pdf = await loadingTask.promise;

	const ebookTitle = file
		.path!.split("/")
		.pop()!
		.replace(/\.pdf$/i, "");

	let markdownContent = `# ${ebookTitle}

`;

	for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
		const page = await pdf.getPage(pageNum);
		const textContent = await page.getTextContent();

		let pageText = textContent.items
			.map((item: { str: string }) => item.str)
			.join(" ");

		// Here you would need to enhance the logic to convert the text into Markdown.
		// For example, you could detect headers, lists, tables, etc., and apply the appropriate Markdown formatting.
		// This can get quite complex depending on the structure and layout of the original PDF.

		// Add a page break after each page's content.
		markdownContent += pageText + "\n\n---\n\n";
	}

	return markdownContent;
};

const epubToMarkdown = async (app: App, file: TFile) => {
	// TODO
	return "";
};

const readDifferentExtensionFileContent = async (app: App, file: TFile) => {
	// console.log({ file });
	switch (file.extension) {
		case "md":
			const body = await app.vault.cachedRead(file);
			return `## ${file.basename}\n${body}`;

		case "pdf":
			return pdfToMarkdown(app, file);

		case "epub":
			return epubToMarkdown(app, file);

		default:
			break;
	}
};

export async function readNodeContent(node: CanvasNode) {
	const app = node.app;
	const nodeData = node.getData();
	switch (nodeData.type) {
		case "text":
			return nodeData.text;
		case "file":
			const file = app.vault.getAbstractFileByPath(nodeData.file);
			if (file instanceof TFile) {
				if (node.subpath) {
					return await readFileContent(app, file, nodeData.subpath);
				} else {
					return readDifferentExtensionFileContent(app, file);
				}
			} else {
				console.debug("Cannot read from file type", file);
			}
	}
}

export async function readNodeImageData(node: CanvasNode) {
	const nodeData = node.getData() as { type?: string; file?: string };
	if (nodeData?.type !== "file" && nodeData?.type !== "image") return null;
	if (!nodeData.file) return null;

	const file = node.app.vault.getAbstractFileByPath(nodeData.file);
	if (!(file instanceof TFile)) return null;

	const mimeType = getImageMimeType(file.extension);
	if (!mimeType) return null;

	const buffer = await node.app.vault.readBinary(file);
	return {
		data: new Uint8Array(buffer),
		mimeType,
		filename: file.basename,
	};
}

export type NodeMediaData =
	| {
			kind: "image";
			data: Uint8Array;
			mimeType: string;
			filename?: string;
		}
	| {
			kind: "file";
			data: string;
			mimeType: string;
			filename?: string;
			size: number;
		}
	| {
			kind: "too-large";
			filename?: string;
			size: number;
			limit: number;
	  };

export async function readNodeMediaData(
	node: CanvasNode
): Promise<NodeMediaData | null> {
	const nodeData = node.getData() as { type?: string; file?: string };
	if (nodeData?.type !== "file" && nodeData?.type !== "image") return null;
	if (!nodeData.file) return null;

	const file = node.app.vault.getAbstractFileByPath(nodeData.file);
	if (!(file instanceof TFile)) return null;

	const mimeType = getMediaMimeType(file.extension);
	if (!mimeType) return null;

	if (mimeType.startsWith("image/")) {
		const buffer = await node.app.vault.readBinary(file);
		return {
			kind: "image",
			data: new Uint8Array(buffer),
			mimeType,
			filename: file.basename,
		};
	}

	if (file.stat?.size && file.stat.size > MAX_INLINE_MEDIA_BYTES) {
		return {
			kind: "too-large",
			filename: file.basename,
			size: file.stat.size,
			limit: MAX_INLINE_MEDIA_BYTES,
		};
	}

	const buffer = await node.app.vault.readBinary(file);
	return {
		kind: "file",
		data: arrayBufferToBase64(buffer),
		mimeType,
		filename: file.basename,
		size: file.stat?.size || buffer.byteLength,
	};
}

export const getFilesContent = async (app: App, files: TFile[]) => {
	let content = "";

	for (const file of files) {
		const fileContent = await readFileContent(app, file);

		content += `# ${file.basename}

${fileContent}

`;
	}

	return content;
};

export const updateNodeAndSave = async (
	canvas: Canvas,
	node: CanvasNode,
	// TODO: only accepts .text .size not working (is it Obsidian API?)
	nodeOptions: CreateNodeOptions
) => {
	// console.log({ nodeOptions });
	// node.setText(nodeOptions.text);
	// @ts-expect-error
	node.setData(nodeOptions);
	await canvas.requestSave();
};

export const generateFileName = (prefix: string = "file"): string => {
	const now = new Date();
	const year = now.getUTCFullYear();
	const month = (now.getUTCMonth() + 1).toString().padStart(2, "0");
	const day = now.getUTCDate().toString().padStart(2, "0");
	const hours = now.getUTCHours().toString().padStart(2, "0");
	const minutes = now.getUTCMinutes().toString().padStart(2, "0");
	const seconds = now.getUTCSeconds().toString().padStart(2, "0");

	return `${prefix}_${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
};

/*
 * Will read canvas node content || md note content
 * TODO add backlinks reading
 */
export const cachedReadFile = async (app: App, file: TFile) => {
	if (file.path.endsWith(".canvas")) {
		const canvasJson = JSON.parse(await app.vault.cachedRead(file));
		console.log({ canvasJson });

		const nodesContent: string[] = [];

		if (canvasJson.nodes) {
			for await (const node of canvasJson.nodes) {
				if (node.type === "text") {
					nodesContent.push(node.text!);
				} else if (node.type === "file") {
					nodesContent.push(
						await cachedReadFile(
							app,
							app.vault.getAbstractFileByPath(node.file!) as TFile
						)
					);
				}
			}
		}

		// console.log({ canvas: { file, nodesContent } });

		return nodesContent.join("\n\n");
	} else {
		return await app.vault.cachedRead(file);
	}
};

// TODO : if there is a canvas which link to a file in the same folder then the folder can be read two times
export const readFolderMarkdownContent = async (app: App, folder: TFolder) => {
	// console.log({ folder });

	const filesContent: string[] = [];
	for await (const fileOrFolder of folder.children) {
		if (fileOrFolder instanceof TFile) {
			// TODO special parsing for .canvas
			filesContent.push(
				`
# ${fileOrFolder.path}

${await cachedReadFile(app, fileOrFolder)}
`.trim()
			);
		} else {
			filesContent.push(
				`${await readFolderMarkdownContent(
					app,
					fileOrFolder as TFolder
				)}`
			);
		}
	}

	return filesContent.join("\n\n");
};

/**
 * Converts a base64 string to an ArrayBuffer
 */
export function getImageBuffer(base64String: string): ArrayBuffer {
	const sanitized = base64String.replace(/\s/g, "");
	const byteCharacters = atob(sanitized);
	const byteNumbers = new Array(byteCharacters.length);
	
	for (let i = 0; i < byteCharacters.length; i++) {
		byteNumbers[i] = byteCharacters.charCodeAt(i);
	}
	
	return new Uint8Array(byteNumbers).buffer;
}

/**
 * Saves an image buffer to a file in the specified folder
 */
export async function saveImageToFile(
	app: App,
	buffer: ArrayBuffer,
	folderPath: string,
	mimeType?: string,
	fileNameOverride?: string
): Promise<TFile | null> {
	const normalizedFolderPath = folderPath.replace(/\/+$/, "");
	if (normalizedFolderPath) {
		// Create folder if it doesn't exist
		const folderExists = app.vault.getAbstractFileByPath(normalizedFolderPath) instanceof TFolder;
		if (!folderExists) {
			await app.vault.createFolder(normalizedFolderPath);
		}
	}

	const fileName = fileNameOverride || buildImageFileName("image", mimeType);
	const filePath = normalizedFolderPath
		? `${normalizedFolderPath}/${fileName}`
		: fileName;

	// Create the file
	const file = await app.vault.createBinary(filePath, buffer);
	return file;
}

export async function saveImageToAttachment(
	app: App,
	buffer: ArrayBuffer,
	mimeType?: string,
	sourcePath?: string,
	fileNameOverride?: string,
	filePathOverride?: string
): Promise<TFile | null> {
	const fileName = fileNameOverride || buildImageFileName("image", mimeType);
	const filePath =
		filePathOverride ||
		(await app.fileManager.getAvailablePathForAttachment(
			fileName,
			sourcePath
	));
	return await app.vault.createBinary(filePath, buffer);
}

export async function saveTextToFile(
	app: App,
	text: string,
	folderPath: string,
	fileNameOverride?: string
): Promise<TFile | null> {
	const normalizedFolderPath = folderPath.replace(/\/+$/, "");
	if (normalizedFolderPath) {
		const folderExists = app.vault.getAbstractFileByPath(normalizedFolderPath) instanceof TFolder;
		if (!folderExists) {
			await app.vault.createFolder(normalizedFolderPath);
		}
	}

	const fileName = fileNameOverride || buildResponseFileName("response");
	const filePath = normalizedFolderPath
		? `${normalizedFolderPath}/${fileName}`
		: fileName;

	return await app.vault.create(filePath, text);
}

export async function saveTextToAttachment(
	app: App,
	text: string,
	sourcePath?: string,
	fileNameOverride?: string,
	filePathOverride?: string
): Promise<TFile | null> {
	const fileName = fileNameOverride || buildResponseFileName("response");
	const filePath =
		filePathOverride ||
		(await app.fileManager.getAvailablePathForAttachment(
			fileName,
			sourcePath
		));
	return await app.vault.create(filePath, text);
}
