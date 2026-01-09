let encodingForModel: any;

// Dynamically import js-tiktoken
import("js-tiktoken").then(module => {
    encodingForModel = module.encodingForModel;
});
import { App, ItemView, Notice } from "obsidian";
import { CanvasNode } from "../../obsidian/canvas-internal";
import {
	CanvasView,
	calcHeight,
	createNode,
	DirectionBias,
	getIncomingEdgeDirection,
} from "../../obsidian/canvas-patches";
import {
	AugmentedCanvasSettings,
	DEFAULT_SETTINGS,
} from "../../settings/AugmentedCanvasSettings";
// import { Logger } from "./util/logging";
import { visitNodeAndAncestors } from "../../obsidian/canvasUtil";
import { readNodeContent, readNodeMediaData } from "../../obsidian/fileUtil";
import { handleGenerateImage } from "../canvasNodeContextMenuActions/generateImage";
import { getResponse, streamResponse } from "../../utils/llm";
import { addModelIndicator, getYouTubeVideoId } from "../../utils";
import { maybeAutoGenerateCardTitle } from "./titleGenerator";

/**
 * Color for assistant notes: 6 == purple
 */
const assistantColor = "6";

/**
 * Height to use for placeholder note
 */
const placeholderNoteHeight = 60;

/**
 * Height to use for new empty note
 */
const emptyNoteHeight = 100;

const NOTE_MAX_WIDTH = 400;
export const NOTE_MIN_HEIGHT = 400;
export const NOTE_INCR_HEIGHT_STEP = 150;

const YOUTUBE_URL_PATTERN =
	/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/)[^\s)]+/gi;
const MAX_YOUTUBE_URLS = 10;

// TODO : remove
const logDebug = (text: any) => null;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Calculate optimal note dimensions maintaining 3:5 aspect ratio
 */
const calculateNoteDimensions = (text: string, minWidth = 300, maxWidth = 800, padding = 40) => {
	// Estimate text metrics
	const avgCharWidth = 8; // Average character width in pixels
	const lineHeight = 24; // Line height in pixels
	const charsPerLine = 50; // Average characters per line for readable text
	
	// Calculate ideal width based on content
	const textLength = text.length;
	const estimatedLines = Math.max(3, Math.ceil(textLength / charsPerLine));
	
	// Calculate width based on content, constrained by min/max
	let idealWidth = Math.min(maxWidth, Math.max(minWidth, Math.sqrt(textLength * avgCharWidth * lineHeight) * 1.2));
	
	// Ensure 3:5 aspect ratio (width:height = 3:5, so height = width * 5/3)
	const aspectRatio = 5 / 3;
	let idealHeight = idealWidth * aspectRatio;
	
	// Ensure minimum height for readability (respecting 3:5 aspect ratio)
	const minHeight = Math.max(minWidth * aspectRatio, estimatedLines * lineHeight + padding);
	if (idealHeight < minHeight) {
		idealHeight = minHeight;
		idealWidth = idealHeight / aspectRatio; // Adjust width to maintain ratio
	}
	
	// Ensure reasonable maximums (for 3:5 aspect ratio)
	const maxHeight = 1000;
	if (idealHeight > maxHeight) {
		idealHeight = maxHeight;
		idealWidth = idealHeight / aspectRatio;
	}
	
	return {
		width: Math.round(idealWidth),
		height: Math.round(idealHeight)
	};
};

const extractYouTubeUrls = (text: string) => {
	if (!text) return [];
	const urls = new Set<string>();
	const matcher = new RegExp(YOUTUBE_URL_PATTERN.source, "gi");
	for (const match of text.matchAll(matcher)) {
		const rawUrl = match[0];
		const videoId = getYouTubeVideoId(rawUrl);
		if (!videoId) continue;
		urls.add(`https://www.youtube.com/watch?v=${videoId}`);
		if (urls.size >= MAX_YOUTUBE_URLS) break;
	}
	return Array.from(urls);
};

const isImageModel = (providerType: string, modelId: string) => {
	const normalizedType = providerType.toLowerCase();
	if (normalizedType !== "gemini" && normalizedType !== "google") return false;
	const normalizedModel = modelId.toLowerCase();
	return (
		normalizedModel.includes("nano-banana") ||
		normalizedModel.includes("imagen") ||
		normalizedModel.includes("image")
	);
};

const extractTextFromContent = (content: any) => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part: any) => {
			if (typeof part === "string") return part;
			if (part?.type === "text" && typeof part.text === "string") {
				return part.text;
			}
			return "";
		})
		.filter(Boolean)
		.join("\n");
};

const buildImagePromptFromMessages = (messages: any[]) =>
	messages
		.filter((message) => message?.role !== "system")
		.map((message) => {
			const text = extractTextFromContent(message?.content);
			if (!text) return "";
			const roleLabel =
				typeof message?.role === "string" && message.role.length > 0
					? `${message.role.toUpperCase()}: `
					: "";
			return `${roleLabel}${text}`;
		})
		.filter(Boolean)
		.join("\n\n");

const toBase64 = (value: unknown) => {
	if (typeof value === "string") return value;
	let bytes: Uint8Array | null = null;
	if (value instanceof Uint8Array) {
		bytes = value;
	} else if (value instanceof ArrayBuffer) {
		bytes = new Uint8Array(value);
	} else if (typeof Buffer !== "undefined" && value instanceof Buffer) {
		bytes = new Uint8Array(value);
	}
	if (!bytes) return "";

	const chunkSize = 0x8000;
	let binary = "";
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}
	return btoa(binary);
};

const buildGeminiImagePartsFromMessages = (messages: any[]) => {
	const parts: { text?: string; inlineData?: { data: string; mimeType: string } }[] = [];

	for (const message of messages) {
		if (message?.role === "system") continue;
		const roleLabel =
			typeof message?.role === "string" && message.role.length > 0
				? message.role.toUpperCase()
				: "USER";
		const content = message?.content;

		if (typeof content === "string") {
			const text = content.trim();
			if (text) {
				parts.push({ text: `${roleLabel}: ${text}` });
			}
			continue;
		}

		if (!Array.isArray(content)) continue;
		let hasRolePrefix = false;

		for (const part of content) {
			if (part?.type === "text" && typeof part.text === "string") {
				const text = part.text.trim();
				if (!text) continue;
				const prefix = hasRolePrefix ? "" : `${roleLabel}: `;
				parts.push({ text: `${prefix}${text}` });
				hasRolePrefix = true;
				continue;
			}

			if (part?.type === "image" && part.image) {
				const base64 = toBase64(part.image);
				if (!base64) continue;
				parts.push({
					inlineData: {
						data: base64,
						mimeType: part.mimeType || "image/png",
					},
				});
			}
		}
	}

	return parts;
};

// const SYSTEM_PROMPT2 = `
// You must respond in this JSON format: {
// 	"response": Your response, must be in markdown,
// 	"questions": Follow up questions the user could ask based on your response, must be an array
// }
// The response must be in the same language the user used.
// `.trim();

const SYSTEM_PROMPT = `
You must respond in markdown.
The response must be in the same language the user used.
`.trim();

export function noteGenerator(
	app: App,
	settings: AugmentedCanvasSettings,
	fromNode?: CanvasNode,
	toNode?: CanvasNode,
	customProvider?: any,
	customModel?: any
	// logDebug: Logger
) {
	const resolveProvider = () =>
		customProvider ||
		settings.providers.find(provider => provider.id === settings.activeProvider);

	const resolveModel = (provider?: any) =>
		customModel ||
		settings.models.find(
			model =>
				model.id === settings.apiModel &&
				model.providerId === provider?.id &&
				model.enabled
		) ||
		settings.models.find(model => model.providerId === provider?.id && model.enabled);

	const canCallAI = () => {
		// return true;
		if (!settings.apiKey && !getActiveProviderApiKey()) {
			new Notice("Please set your OpenAI API key in the plugin settings");
			return false;
		}

		return true;
	};

	const getActiveProviderApiKey = () => {
		// Use custom provider if provided, otherwise use settings
		const activeProvider = resolveProvider();
		
		if (!activeProvider) return null;
		
		// Just use the main API key since we've simplified the interface
		return settings.apiKey || activeProvider.apiKey || null;
	};
	
	const getActiveProviderBaseUrl = () => {
		// Use custom provider if provided, otherwise use settings
		const activeProvider = resolveProvider();
		
		return activeProvider?.baseUrl || undefined;
	};

	const getActiveCanvas = () => {
		const maybeCanvasView = app.workspace.getActiveViewOfType(
			ItemView
		) as CanvasView | null;
		return maybeCanvasView ? maybeCanvasView["canvas"] : null;
	};

	const isSystemPromptNode = (text: string) =>
		text.trim().startsWith("SYSTEM PROMPT");

	const getSystemPrompt = async (node: CanvasNode) => {
		// TODO
		let foundPrompt: string | null = null;

		await visitNodeAndAncestors(node, async (n: CanvasNode) => {
			const text = await readNodeContent(n);
			if (text && isSystemPromptNode(text)) {
				foundPrompt = text.replace("SYSTEM PROMPT", "").trim();
				return false;
			} else {
				return true;
			}
		});

		return foundPrompt || settings.systemPrompt;
	};

	const buildMessages = async (
		node: CanvasNode,
		{
			systemPrompt,
			prompt,
		}: {
			systemPrompt?: string;
			prompt?: string;
		} = {}
	) => {
		const messages: any[] = [];
		let tokenCount = 0;

		const provider = resolveProvider();
		const model = resolveModel(provider);
		const isGpt = provider?.type === "OpenAI";
		const supportsVisionInput =
			provider?.type === "Gemini" || provider?.type === "Google";
		const canCountTokens = isGpt && typeof encodingForModel === "function";
		const modelName = model?.model || settings.apiModel;

		if (canCountTokens) {
			const encoding = encodingForModel(modelName as any);

			// Note: We are not checking for system prompt longer than context window.
			// That scenario makes no sense, though.
			const systemPrompt2 = systemPrompt || (await getSystemPrompt(node));
			if (systemPrompt2) {
				tokenCount += encoding.encode(systemPrompt2).length;
			}
		}

		const visit = async (
			node: CanvasNode,
			depth: number,
			edgeLabel?: string
		) => {
			if (settings.maxDepth && depth > settings.maxDepth) return false;

			const nodeData = node.getData();
			let nodeText = (await readNodeContent(node))?.trim() || "";
			const nodeLinkUrl =
				typeof (nodeData as { url?: string }).url === "string"
					? (nodeData as { url?: string }).url!
					: "";
			let nodeMedia = supportsVisionInput
				? await readNodeMediaData(node)
				: null;
			const inputLimit = getTokenLimit(settings);

			let shouldContinue = true;

			if (nodeText) {
				if (isSystemPromptNode(nodeText)) return true;

				if (canCountTokens) {
					const encoding = encodingForModel(modelName as any);
					let nodeTokens = encoding.encode(nodeText);
					let keptNodeTokens: number;

					if (tokenCount + nodeTokens.length > inputLimit) {
						// will exceed input limit

						shouldContinue = false;

						// Leaving one token margin, just in case
						const keepTokens = nodeTokens.slice(
							0,
							inputLimit - tokenCount - 1
						);
						const truncateTextTo = encoding.decode(keepTokens).length;
						logDebug(
							`Truncating node text from ${nodeText.length} to ${truncateTextTo} characters`
						);
						new Notice(
							`Truncating node text from ${nodeText.length} to ${truncateTextTo} characters`
						);
						nodeText = nodeText.slice(0, truncateTextTo);
						keptNodeTokens = keepTokens.length;
					} else {
						keptNodeTokens = nodeTokens.length;
					}

					tokenCount += keptNodeTokens;
				}
			}

			const role: any =
				nodeData.chat_role === "assistant" ? "assistant" : "user";

			if (edgeLabel) {
				messages.unshift({
					content: edgeLabel,
					role: "user",
				});
			}

			const youtubeUrls =
				supportsVisionInput && !nodeMedia
					? extractYouTubeUrls(`${nodeLinkUrl}\n${nodeText}`)
					: [];

			if (nodeMedia?.kind === "too-large") {
				const sizeMb = (nodeMedia.size / (1024 * 1024)).toFixed(1);
				const limitMb = (nodeMedia.limit / (1024 * 1024)).toFixed(1);
				new Notice(
					`Skipping ${nodeMedia.filename || "media"} (${sizeMb} MB). Limit is ${limitMb} MB.`
				);
				nodeMedia = null;
			}

			if (nodeMedia?.kind === "image") {
				const parts: any[] = [];
				if (nodeText) {
					parts.push({ type: "text", text: nodeText });
				} else if (nodeMedia.filename) {
					parts.push({
						type: "text",
						text: `Image: ${nodeMedia.filename}`,
					});
				}
				parts.push({
					type: "image",
					image: nodeMedia.data,
					mimeType: nodeMedia.mimeType,
				});
				messages.unshift({
					content: parts,
					role: role === "assistant" ? "user" : role,
				});
			} else if (nodeMedia?.kind === "file") {
				const parts: any[] = [];
				parts.push({
					type: "file",
					data: nodeMedia.data,
					mimeType: nodeMedia.mimeType,
					filename: nodeMedia.filename,
				});
				if (nodeText) {
					parts.push({ type: "text", text: nodeText });
				} else if (nodeMedia.filename) {
					parts.push({
						type: "text",
						text: `File: ${nodeMedia.filename}`,
					});
				}
				messages.unshift({
					content: parts,
					role: role === "assistant" ? "user" : role,
				});
			} else if (youtubeUrls.length) {
				const parts: any[] = [];
				for (const url of youtubeUrls) {
					try {
						parts.push({
							type: "file",
							data: new URL(url),
							mimeType: "video/mp4",
						});
					} catch {
						continue;
					}
				}
				if (nodeText) {
					parts.push({ type: "text", text: nodeText });
				}
				if (parts.length) {
					messages.unshift({
						content: parts,
						role: role === "assistant" ? "user" : role,
					});
				} else if (nodeText) {
					messages.unshift({
						content: nodeText,
						role,
					});
				}
			} else if (nodeText) {
				messages.unshift({
					content: nodeText,
					role,
				});
			} else if (nodeLinkUrl) {
				messages.unshift({
					content: nodeLinkUrl,
					role,
				});
			}

			return shouldContinue;
		};

		await visitNodeAndAncestors(node, visit);

		const systemPrompt2 = systemPrompt || (await getSystemPrompt(node));
		if (systemPrompt2)
			messages.unshift({
				role: "system",
				content: systemPrompt2,
			});

		if (prompt)
			messages.push({
				role: "user",
				content: prompt,
			});

		return { messages, tokenCount };
	};

	const generateNote = async (question?: string) => {
		const provider = resolveProvider();
		if (!provider) {
			new Notice("No active provider found. Please check your settings.");
			return;
		}

		const model = resolveModel(provider);
		if (!model) {
			new Notice(`No enabled models found for ${provider.type}. Please check your settings.`);
			return;
		}

		if (!canCallAI()) return;

		logDebug("Creating AI note");

		const canvas = getActiveCanvas();
		if (!canvas) {
			logDebug("No active canvas");
			return;
		}
		// console.log({ canvas });

		await canvas.requestFrame();

		let node: CanvasNode;
		if (!fromNode) {
			const selection = canvas.selection;
			if (selection?.size !== 1) return;
			const values = Array.from(selection.values());
			node = values[0];
		} else {
			node = fromNode;
		}

		if (node) {
			// Last typed characters might not be applied to note yet
			await canvas.requestSave();
			await sleep(200);

			const trimmedQuestion = question?.trim();
			const { messages, tokenCount } = await buildMessages(node, {
				prompt: question,
			});

			if (isImageModel(provider.type, model.model)) {
				const promptOverride = buildImagePromptFromMessages(messages);
				const parts = buildGeminiImagePartsFromMessages(messages);
				await handleGenerateImage(app, settings, node, {
					provider,
					model: model.model,
					prompt: promptOverride || node.text,
					edgeLabel: trimmedQuestion || undefined,
					parts: parts.length ? parts : undefined,
				});
				return;
			}
			// console.log({ messages });
			if (!messages.length) return;

			let created: CanvasNode;
			const isNewNode = !toNode;
			if (!toNode) {
				// Calculate initial dimensions for placeholder text
				const initialText = `Calling AI (${model.model})...`;
				const initialDimensions = calculateNoteDimensions(initialText, 300, 500);
				
				// Determine directional bias from the source node's incoming edges
				const directionBias = getIncomingEdgeDirection(node);
				
				created = createNode(
					canvas,
					{
						// text: "```loading...```",
						text: initialText,
						size: { 
							height: initialDimensions.height,
							width: initialDimensions.width
						},
					},
					node,
					{
						color: assistantColor,
						chat_role: "assistant",
						ai_model: model.model,
						ai_provider: provider.type,
					},
					question,
					directionBias
				);
			} else {
				created = toNode;
				const initialText = `Calling AI (${model.model})...`;
				created.setText(initialText);
				
				// Update the node data with model info
				const nodeData = created.getData();
				created.setData({
					...nodeData,
					ai_model: model.model,
					ai_provider: provider.type,
				});
				
				// Resize existing node to proper initial dimensions
				const initialDimensions = calculateNoteDimensions(initialText, 300, 500);
				created.moveAndResize({
					height: initialDimensions.height,
					width: initialDimensions.width,
					x: created.x,
					y: created.y
				});
			}

			const isGpt = provider?.type === "OpenAI";
			let noticeMessage = `Sending ${messages.length} notes to the AI`;
			if (isGpt) {
				noticeMessage = `Sending ${messages.length} notes with ${tokenCount} tokens to the AI`;
			}
			new Notice(noticeMessage);

			try {
				// logDebug("messages", messages);

				let reasoning = "";
				let reasoningEl: HTMLElement;
				let firstDelta = true;
				await streamResponse(
					provider,
					messages,
					{
						model: model.model,
						max_tokens: settings.maxResponseTokens || undefined,
					},
					(delta: string | null, final: any, tool: any, reasoningDelta: any) => {
						if (firstDelta) {
							created.setText("");
							const details = created.contentEl.createEl("details");
							details.createEl("summary", { text: "Reasoning" });
							reasoningEl = details.createEl("div", { cls: "reasoning" });
							firstDelta = false;
						}

						if (reasoningDelta) {
							reasoningEl.setText(reasoningEl.getText() + reasoningDelta);
						}

						if (delta) {
							created.setText(created.text + delta);
							
							// Calculate optimal dimensions maintaining 3:5 aspect ratio
							const dimensions = calculateNoteDimensions(created.text);
							
							// Only resize if dimensions have changed significantly (avoid constant tiny adjustments)
							const currentWidth = created.width;
							const currentHeight = created.height;
							const widthDiff = Math.abs(dimensions.width - currentWidth);
							const heightDiff = Math.abs(dimensions.height - currentHeight);
							
							if (widthDiff > 20 || heightDiff > 15) {
								created.moveAndResize({ 
									height: dimensions.height, 
									width: dimensions.width, 
									x: created.x, 
									y: created.y 
								});
								void created.canvas?.requestFrame?.();
							}
						}

						if (final) {
							// Final resize to ensure optimal dimensions
							const finalDimensions = calculateNoteDimensions(created.text);
							created.moveAndResize({ 
								height: finalDimensions.height, 
								width: finalDimensions.width, 
								x: created.x, 
								y: created.y 
							});
							void created.canvas?.requestFrame?.();
							
							// Add subtle model indicator to the note
							addModelIndicator(created, provider.type, model.model);
						}
					}
				);

				if (isNewNode) {
					await maybeAutoGenerateCardTitle(app, settings, created);
				}

				// if (generated == null) {
				// 	new Notice(`Empty or unreadable response from the AI`);
				// 	canvas.removeNode(created);
				// 	return;
				// }

				// * Update Node
				// created.setText(generated.response);
				// const nodeData = created.getData();
				// created.setData({
				// 	...nodeData,
				// 	questions: generated.questions,
				// });
				// const height = calcHeight({
				// 	text: generated.response,
				// 	parentHeight: node.height,
				// });
				// created.moveAndResize({
				// 	height,
				// 	width: created.width,
				// 	x: created.x,
				// 	y: created.y,
				// });

				// const selectedNoteId =
				// 	canvas.selection?.size === 1
				// 		? Array.from(canvas.selection.values())?.[0]?.id
				// 		: undefined;

				// if (selectedNoteId === node?.id || selectedNoteId == null) {
				// 	// If the user has not changed selection, select the created node
				// 	canvas.selectOnly(created, false /* startEditing */);
				// }
			} catch (error) {
				new Notice(`Error calling the AI: ${error.message || error}`);
				if (!toNode) {
					canvas.removeNode(created);
				}
			}

			await canvas.requestSave();
		}
	};

	// return { nextNote, generateNote };
	return { generateNote, buildMessages };
}

export function getTokenLimit(settings: AugmentedCanvasSettings) {
	// TODO: Implement a more robust solution for getting token limits
	const tokenLimit = settings.maxInputTokens
		? Math.min(settings.maxInputTokens, 4096)
		: 4096;

	// console.log({ settings, tokenLimit });
	return tokenLimit;
}
