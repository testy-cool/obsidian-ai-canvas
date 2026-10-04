import { logDebug } from "src/logDebug";
let encodingForModel: any;

// Dynamically import js-tiktoken
import("js-tiktoken").then(module => {
    encodingForModel = module.encodingForModel;
});
import { App, ItemView, Notice } from "obsidian";
import { CanvasNode } from "../../obsidian/canvas-internal";
import {
	CanvasView,
	createNode,
	getIncomingEdgeDirection,
} from "../../obsidian/canvas-patches";
import {
	AugmentedCanvasSettings,
	} from "../../settings/AugmentedCanvasSettings";
// import { Logger } from "./util/logging";
import {
	collectNodeAndAncestors,
	isPromptContextNodeIncluded,
	visitNodeAndAncestors,
} from "../../obsidian/canvasUtil";
import { getMediaMimeType, readNodeContent, readNodeMediaData } from "../../obsidian/fileUtil";
import { handleGenerateImage } from "../canvasNodeContextMenuActions/generateImage";
import { streamResponse, ToolEvent } from "../../utils/llm";
import { addModelIndicator, setModelIndicatorText, getYouTubeVideoId } from "../../utils";
import { maybeAutoGenerateCardTitle } from "./titleGenerator";
import { createGenerationStatus } from "../../utils/generationStatus";
import { costForModel } from "../../utils/cost";
import { canvasFolderPath } from "../../utils/canvasFolder";
import { PI_FRESH_SESSION_NOTE, PI_PROVIDER_TYPE, PI_SESSION_KEY, planPiContinuation } from "../../utils/piSessions";
import { CLI_DEFAULT_MODEL } from "../../utils/localCli";
import { isImageModel } from "../../utils/modelKind";
import { getAllMCPTools } from "../../utils/mcpClient";
import { getProviderCapabilities, providerLabel, supportsGoogleTools } from "../../utils/providerCapabilities";
import { extractHtmlCodeBlocks, addHtmlPreviewToNode } from "../../utils/htmlPreview";
import {
	PromptContextModal,
	type PromptContextOption,
} from "../../Modals/PromptContextModal";

/**
 * Color for assistant notes: 6 == purple
 */
const assistantColor = "6";

/**
 * Height to use for placeholder note
 */

/**
 * Height to use for new empty note
 */

export const NOTE_MIN_HEIGHT = 400;
export const NOTE_INCR_HEIGHT_STEP = 150;

const YOUTUBE_URL_PATTERN =
	/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/)[^\s)]+/gi;
const MAX_YOUTUBE_URLS = 10;

// Gemini returns an empty answer when the conversation ends on the model's own turn.
const CONTINUE_PROMPT = "Continue.";

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
						mimeType: part.mediaType || "image/png",
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
	
	/** Where the canvas file lives on disk, so a CLI that works on files runs next to it. Desktop only. */
	const getCanvasFolder = (): string | undefined => {
		const view = app.workspace.getActiveViewOfType(ItemView) as { file?: { parent?: { path?: string } | null } } | null;
		const basePath = (app.vault?.adapter as { getBasePath?: () => string } | undefined)?.getBasePath?.();
		return basePath ? canvasFolderPath(basePath, view?.file?.parent?.path ?? "") : undefined;
	};

	const getActiveCanvas = () => {
		const maybeCanvasView = app.workspace.getActiveViewOfType(
			ItemView
		) as CanvasView | null;
		return maybeCanvasView ? maybeCanvasView["canvas"] : null;
	};

	const isSystemPromptNode = (text: string) =>
		text.trim().startsWith("SYSTEM PROMPT");

	const getSystemPrompt = async (
		node: CanvasNode,
		selectedNodeIds?: ReadonlySet<string>
	) => {
		let foundPrompt: string | null = null;
		let sourceNodeId: string | undefined;

		await visitNodeAndAncestors(node, async (n: CanvasNode, depth) => {
			if (settings.maxDepth && depth > settings.maxDepth) return false;
			if (!isPromptContextNodeIncluded(n.id, selectedNodeIds)) return true;
			const text = await readNodeContent(n);
			if (text && isSystemPromptNode(text)) {
				foundPrompt = text.replace("SYSTEM PROMPT", "").trim();
				sourceNodeId = n.id;
				return false;
			}
			return true;
		});

		return {
			prompt: foundPrompt || settings.systemPrompt,
			sourceNodeId,
		};
	};

	const buildMessages = async (
		node: CanvasNode,
		{
			systemPrompt,
			prompt,
			selectedNodeIds,
			continuing,
		}: {
			systemPrompt?: string;
			prompt?: string;
			selectedNodeIds?: ReadonlySet<string>;
			// The provider already holds the earlier cards in a session, and the system prompt with them.
			continuing?: boolean;
		} = {}
	) => {
		const messages: any[] = [];
		const notes: string[] = [];
		const contributedNodeIds = new Set<string>();
		let tokenCount = 0;

		const provider = resolveProvider();
		const model = resolveModel(provider);
		const isGpt = provider?.type === "OpenAI";
		const capabilities = getProviderCapabilities(provider, model?.model);
		const warnedMedia = new Set<string>();
		const warnUnsupportedMedia = (media: "video files" | "YouTube links") => {
			if (warnedMedia.has(media)) return;
			warnedMedia.add(media);
			notes.push(`${media === "YouTube links" ? "YouTube link" : "Video file"} not sent to ${provider ? providerLabel(provider) : "this provider"}`);
			new Notice(`${provider ? providerLabel(provider) : "This provider"} cannot take ${media}. Use a Gemini provider for this card.`);
		};
		const canCountTokens = isGpt && typeof encodingForModel === "function";
		const modelName = model?.model || settings.apiModel;
		const resolvedSystemPrompt = systemPrompt
			? { prompt: systemPrompt, sourceNodeId: undefined }
			: await getSystemPrompt(node, selectedNodeIds);
		if (continuing && !resolvedSystemPrompt.sourceNodeId) resolvedSystemPrompt.prompt = "";

		if (canCountTokens) {
			const encoding = encodingForModel(modelName as any);

			// Note: We are not checking for system prompt longer than context window.
			// That scenario makes no sense, though.
			const systemPrompt2 = resolvedSystemPrompt.prompt;
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
			if (!isPromptContextNodeIncluded(node.id, selectedNodeIds)) return true;

			const nodeData = node.getData();
			let nodeText = (await readNodeContent(node))?.trim() || "";
			const nodeLinkUrl =
				typeof (nodeData as { url?: string }).url === "string"
					? (nodeData as { url?: string }).url!
					: "";
			const filePath = (nodeData as { file?: string }).file;
			const isUnsupportedVideo = !capabilities.video &&
				getMediaMimeType(filePath?.split(".").pop() || "")?.startsWith("video/");
			if (isUnsupportedVideo) warnUnsupportedMedia("video files");
			let nodeMedia = !isUnsupportedVideo && (capabilities.image || capabilities.pdf)
				? await readNodeMediaData(node)
				: null;
			const inputLimit = getTokenLimit(settings);

			let shouldContinue = true;

			if (nodeText) {
				if (isSystemPromptNode(nodeText)) return true;

				if (canCountTokens) {
					const encoding = encodingForModel(modelName as any);
					const nodeTokens = encoding.encode(nodeText);
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
				contributedNodeIds.add(node.id);
			}

			const youtubeUrls = extractYouTubeUrls(`${nodeLinkUrl}\n${nodeText}`);
			if (youtubeUrls.length && !capabilities.youtube) warnUnsupportedMedia("YouTube links");
			if (nodeMedia?.kind === "file" && nodeMedia.mimeType.startsWith("video/") && !capabilities.video) {
				warnUnsupportedMedia("video files");
				nodeMedia = null;
			}

			if (nodeMedia?.kind === "too-large") {
				const sizeMb = (nodeMedia.size / (1024 * 1024)).toFixed(1);
				const limitMb = (nodeMedia.limit / (1024 * 1024)).toFixed(1);
				notes.push(`Skipped ${filePath?.split("/").pop() || nodeMedia.filename || "media"}, ${sizeMb} MB exceeds the ${limitMb} MB limit`);
				new Notice(
					`Skipping ${nodeMedia.filename || "media"} (${sizeMb} MB). Limit is ${limitMb} MB.`
				);
				nodeMedia = null;
			}

			if (nodeMedia?.kind === "image" && capabilities.image) {
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
					mediaType: nodeMedia.mimeType,
				});
				messages.unshift({
					content: parts,
					role: role === "assistant" ? "user" : role,
				});
				contributedNodeIds.add(node.id);
			} else if (nodeMedia?.kind === "file" && (nodeMedia.mimeType !== "application/pdf" || capabilities.pdf)) {
				const parts: any[] = [];
				parts.push({
					type: "file",
					data: nodeMedia.data,
					mediaType: nodeMedia.mimeType,
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
				contributedNodeIds.add(node.id);
			} else if (youtubeUrls.length && capabilities.youtube) {
				const parts: any[] = [];
				for (const url of youtubeUrls) {
					try {
						parts.push({
							type: "file",
							data: url,
							mediaType: "video/mp4",
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
					contributedNodeIds.add(node.id);
				} else if (nodeText) {
					messages.unshift({
						content: nodeText,
						role,
					});
					contributedNodeIds.add(node.id);
				}
			} else if (nodeText) {
				messages.unshift({
					content: nodeText,
					role,
				});
				contributedNodeIds.add(node.id);
			} else if (nodeLinkUrl) {
				messages.unshift({
					content: nodeLinkUrl,
					role,
				});
				contributedNodeIds.add(node.id);
			}

			return shouldContinue;
		};

		await visitNodeAndAncestors(node, visit);

		const systemPrompt2 = resolvedSystemPrompt.prompt;
		if (systemPrompt2)
			messages.unshift({
				role: "system",
				content: systemPrompt2,
			});
		if (resolvedSystemPrompt.sourceNodeId) {
			contributedNodeIds.add(resolvedSystemPrompt.sourceNodeId);
		}

		if (prompt)
			messages.push({
				role: "user",
				content: prompt,
			});

		return { messages, tokenCount, notes, contributedNodeIds };
	};

	const generateNote = async (
		question?: string,
		selectedNodeIds?: ReadonlySet<string>,
		chooseContext = false
	) => {
		const provider = resolveProvider();
		if (!provider) {
			new Notice("No active provider found. Please check your settings.");
			return;
		}

		const model = resolveModel(provider);
		if (!model) {
			new Notice(`No enabled models found for ${providerLabel(provider)}. Please check your settings.`);
			return;
		}

		if (!canCallAI()) return;

		logDebug("Creating AI note");

		const canvas = getActiveCanvas();
		if (!canvas) {
			logDebug("No active canvas");
			return;
		}
		// logDebug({ canvas });

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

			const contextEntries = await collectNodeAndAncestors(node);
			const savedExcludedNodeIds = new Set<string>(
				Array.isArray(toNode?.getData()?.ai_context_excluded)
					? toNode.getData().ai_context_excluded
					: []
			);
			if (!selectedNodeIds) {
				if (chooseContext || (settings.alwaysAskPromptContext && contextEntries.length > 1)) {
					const contextOptions: PromptContextOption[] = await Promise.all(
						contextEntries.map(async ({ node: contextNode, depth }) => {
							const canvasNode = contextNode as CanvasNode;
							const nodeData = canvasNode.getData() as {
								type?: string;
								file?: string;
								url?: string;
							};
							const text = (await readNodeContent(canvasNode))?.trim();
							const fallback =
								nodeData.file ||
								nodeData.url ||
								`${nodeData.type || "Canvas"} card`;
							const preview = (text || fallback)
								.replace(/\s+/g, " ")
								.slice(0, 220);
							return { id: canvasNode.id, depth, preview };
						})
					);
					new PromptContextModal(
						app,
						contextOptions,
						(selection) => {
							void generateNote(question, selection);
						},
						savedExcludedNodeIds
					).open();
					return;
				}
				selectedNodeIds = new Set(
					contextEntries
						.filter(({ node }) => !savedExcludedNodeIds.has(node.id))
						.map(({ node }) => node.id)
				);
			}
			const excludedNodeIds = contextEntries
				.filter(({ node }) => !selectedNodeIds!.has(node.id))
				.map(({ node }) => node.id);
			const trimmedQuestion = question?.trim();
			// A Pi card carries its own Pi session. Continue the nearest one above
			// and send only the cards added since, because Pi remembers the rest.
			const piSession = provider.type === PI_PROVIDER_TYPE
				? await planPiContinuation(contextEntries, selectedNodeIds, contextNode => (contextNode as CanvasNode).getData())
				: undefined;
			const { messages, tokenCount, notes, contributedNodeIds } = await buildMessages(node, {
				prompt: trimmedQuestion ? question : undefined,
				selectedNodeIds: piSession?.newNodeIds ?? selectedNodeIds,
				continuing: !!piSession,
			});
			const contextCount = contributedNodeIds.size + (piSession?.coveredCount ?? 0);
			// Should Pi no longer have that session, the whole chain starts a fresh one.
			const fullChain = piSession
				? await buildMessages(node, { prompt: trimmedQuestion ? question : undefined, selectedNodeIds })
				: undefined;
			const contextTotal = contextEntries.length;

			if (isImageModel(provider.type, model)) {
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
			if (!trimmedQuestion && fullChain?.messages[fullChain.messages.length - 1]?.role === "assistant") {
				fullChain.messages.push({ role: "user", content: CONTINUE_PROMPT });
			}
			if (!trimmedQuestion && (messages[messages.length - 1]?.role === "assistant" || (piSession && !messages.length))) {
				messages.push({ role: "user", content: CONTINUE_PROMPT });
			}
			// logDebug({ messages });
			if (!messages.length) return;

			let created: CanvasNode;
			const isNewNode = !toNode;
			if (!toNode) {
				// Loading UI is separate from the persisted markdown body.
				const initialText = "";
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
						ai_provider: providerLabel(provider),
						ai_context_count: contextCount,
						ai_context_total: contextTotal,
						...(excludedNodeIds.length
							? { ai_context_excluded: excludedNodeIds }
							: {}),
						ai_notes: notes,
					},
					question,
					directionBias
				);
			} else {
				created = toNode;
				const initialText = "";
				created.setText(initialText);
				
				// Update the node data with model info
				const nodeData = created.getData();
				created.setData({
					...nodeData,
					ai_model: model.model,
					ai_provider: providerLabel(provider),
					ai_context_count: contextCount,
					ai_context_total: contextTotal,
					ai_context_excluded: excludedNodeIds.length
						? excludedNodeIds
						: undefined,
					ai_notes: notes,
					// The previous run's numbers, until this run reports its own.
					ai_cost: undefined,
					ai_usage: undefined,
					ai_duration_ms: undefined,
					[PI_SESSION_KEY]: undefined,
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

			const controller = new AbortController();
			let shownModel = model.model;
			let generationStatus: ReturnType<typeof createGenerationStatus> | undefined;
			try {
				// Unfocused cards can lack contentEl until Canvas renders them.
				// Render this card before attaching UI, without selecting or focusing it.
				created.render();
				addModelIndicator(created, providerLabel(provider), model.model, true);
				generationStatus = createGenerationStatus(created, controller);

				const isGpt = provider?.type === "OpenAI";
				let noticeMessage = `Sending ${messages.length} notes to the AI`;
				if (isGpt) {
					noticeMessage = `Sending ${messages.length} notes with ${tokenCount} tokens to the AI`;
				}
				new Notice(noticeMessage);

				// logDebug("messages", messages);

				// Get MCP tools if enabled
				let mcpTools: Record<string, any> | undefined;
				if (settings.mcpEnabled && settings.mcpServers.length > 0) {
					try {
						generationStatus.setPhase("Connecting tools…");
						let stopLoading: () => void;
						const stopped = new Promise<never>((_, reject) => {
							stopLoading = () => reject(new DOMException("Generation stopped", "AbortError"));
							controller.signal.addEventListener("abort", stopLoading, { once: true });
						});
						try {
							mcpTools = await Promise.race([getAllMCPTools(settings.mcpServers), stopped]);
						} finally {
							controller.signal.removeEventListener("abort", stopLoading!);
						}
						generationStatus.setPhase("Generating…");
						const toolCount = Object.keys(mcpTools).length;
						if (toolCount > 0) {
							new Notice(`Loaded ${toolCount} MCP tools`);
						}
					} catch (error) {
						if (controller.signal.aborted) throw error;
						new Notice(`Failed to load MCP tools: ${error}`);
					}
				}

				let reasoningEl: HTMLElement;
				let reasoningDetails: HTMLElement | undefined;
				let toolsContainer: HTMLElement;
				let featuresEl: HTMLElement | undefined;
				let mcpFeature: HTMLElement | undefined;
				let urlFeature: HTMLElement | undefined;
				let searchFeature: HTMLElement | undefined;
				let featureUpdate: Promise<void> | undefined;
				let mcpCallCount = 0;
				const countedCalls = new Set<string>();
				let firstDelta = true;
				let lastResizeAt = Date.now();
				const toolRefs = new Map<string, HTMLElement>();
				// The first text, or the first rewrite of it, clears the card and
				// makes room for the tool calls.
				const startWriting = () => {
					if (!firstDelta) return;
					created.setText("");
					// Create tools container for MCP tool calls
					toolsContainer = created.contentEl.createEl("div", { cls: "mcp-tools-container" });
					firstDelta = false;
				};

				// Determine what features are active
				const hasMcpTools = mcpTools && Object.keys(mcpTools).length > 0;
				const mcpToolCount = hasMcpTools ? Object.keys(mcpTools!).length : 0;
				const capabilities = getProviderCapabilities(provider, model?.model);
				const canUseGoogleTools = supportsGoogleTools(model.model) && !hasMcpTools;
				const usesUrlContext = capabilities.urlContext && canUseGoogleTools;
				const usesSearchGrounding = capabilities.search && canUseGoogleTools;

				if (hasMcpTools || usesUrlContext || usesSearchGrounding) {
					featuresEl = created.contentEl.createEl("div", { cls: "ai-features-indicator" });
					if (hasMcpTools) mcpFeature = featuresEl.createEl("span", { text: `🔧 MCP (${mcpToolCount} tools, 0 calls)` });
					if (usesUrlContext) urlFeature = featuresEl.createEl("span", { text: "🌐 URL Context: enabled" });
					if (usesSearchGrounding) searchFeature = featuresEl.createEl("span", { text: "🔍 Search: enabled" });
				}

				const truncateText = (text: string, maxLen = 100) => {
					if (!text) return "";
					const str = typeof text === "string" ? text : JSON.stringify(text);
					return str.length > maxLen ? str.slice(0, maxLen) + "..." : str;
				};

				const requestStartedAt = Date.now();
				await streamResponse(
					provider,
					messages,
					{
						model: model.model,
						max_tokens: settings.maxResponseTokens || undefined,
						tools: mcpTools,
						maxSteps: settings.mcpMaxSteps || 5,
						providerParams: model.providerParams,
						timeoutMs: model.timeoutMs,
						abortSignal: controller.signal,
						cwd: getCanvasFolder(),
						forkSession: piSession?.sessionId,
						fallbackMessages: fullChain?.messages.length ? fullChain.messages : undefined,
						onComplete: usage => {
							// Show what the card cost and how much came from the cache next
							// to the model it used. Cost is undefined when the model has no
							// prices, so the badge leaves it out. A provider that reports its
							// own cost, such as Pi, wins over the price list.
							const cost = usage.costUsd ?? costForModel(settings.models, provider.id, model.model, usage);
							const { inputTokens, outputTokens, cachedInputTokens } = usage;
							// "default" says nothing about which model answered.
							if (usage.model && model.model === CLI_DEFAULT_MODEL) shownModel = usage.model;
							created.setData({
								...created.getData(),
								ai_usage: { inputTokens, outputTokens, cachedInputTokens: cachedInputTokens ?? 0 },
								ai_duration_ms: Date.now() - requestStartedAt,
								...(cost == null ? {} : { ai_cost: cost }),
								...(shownModel === model.model ? {} : { ai_model: shownModel }),
								...(usage.sessionId ? { [PI_SESSION_KEY]: usage.sessionId } : {}),
								...(usage.startedFreshSession ? { ai_notes: [...(created.getData().ai_notes ?? []), PI_FRESH_SESSION_NOTE] } : {}),
							});
						},
						onReplaceText: text => {
							if (controller.signal.aborted) return;
							startWriting();
							created.setText(text);
						},
						onPhase: phase => generationStatus?.setPhase(phase),
					},
					(delta: string | null, final: any, tool: ToolEvent | null, reasoningDelta: any) => {
						if (controller.signal.aborted) return;
						startWriting();

						if (reasoningDelta) {
							generationStatus?.setPhase("Thinking…");
							if (!reasoningDetails) {
								reasoningDetails = created.contentEl.createEl("details");
								reasoningDetails.createEl("summary", { text: "Reasoning" });
								reasoningEl = reasoningDetails.createEl("div", { cls: "reasoning" });
							}
							reasoningEl.setText(reasoningEl.getText() + reasoningDelta);
						}

						// Handle MCP tool events
						if (tool) {
							generationStatus?.setPhase(tool.type === "tool-call" ? `Using ${tool.toolName || "tool"}…` : "Generating…");
							if (tool.type === "tool-call" && tool.toolName && mcpTools?.[tool.toolName] &&
								(!tool.toolCallId || !countedCalls.has(tool.toolCallId))) {
								mcpCallCount++;
								if (tool.toolCallId) countedCalls.add(tool.toolCallId);
							}
							mcpFeature?.setText(`🔧 MCP (${mcpToolCount} tools, ${mcpCallCount} calls)`);
							switch (tool.type) {
								case 'tool-call': {
									const toolEl = toolsContainer.createEl("details", { cls: "mcp-tool-call" });
									toolEl.setAttribute("open", "");
									const summary = toolEl.createEl("summary");
									summary.createEl("span", { text: `🔧 ${tool.toolName}`, cls: "mcp-tool-name" });
									const argsText = truncateText(JSON.stringify(tool.args), 50);
									summary.createEl("span", { text: `(${argsText})`, cls: "mcp-tool-args" });
									const statusEl = toolEl.createEl("div", { cls: "mcp-tool-status" });
									statusEl.createEl("span", { text: "⏳", cls: "mcp-tool-status-glyph" });
									statusEl.createEl("span", { text: "Running...", cls: "mcp-tool-status-text" });
									if (tool.toolCallId) {
										toolRefs.set(tool.toolCallId, toolEl);
									}
									break;
								}
								case 'tool-result': {
									const toolEl = tool.toolCallId ? toolRefs.get(tool.toolCallId) : null;
									if (toolEl) {
										const statusEl = toolEl.querySelector(".mcp-tool-status");
										if (statusEl) {
											const resultText = truncateText(
												typeof tool.result === "string" ? tool.result : JSON.stringify(tool.result),
												200
											);
											const isError = tool.isError || tool.result?.isError || tool.result?.error;
											statusEl.querySelector(".mcp-tool-status-glyph")!.setText(isError ? "✗" : "✓");
											statusEl.querySelector(".mcp-tool-status-text")!.setText(resultText);
											statusEl.removeClass("mcp-tool-success", "mcp-tool-error");
											statusEl.addClass(isError ? "mcp-tool-error" : "mcp-tool-success");
										}
									}
									break;
								}
							}
						}

						if (delta) {
							generationStatus?.showStreaming();
							created.setText(created.text + delta);

							const now = Date.now();
							if (now - lastResizeAt >= 500) {
								const dimensions = calculateNoteDimensions(created.text);
								const widthDiff = Math.abs(dimensions.width - created.width);
								const heightDiff = dimensions.height - created.height;
								if (heightDiff > 0 && (widthDiff > 20 || heightDiff > 15)) {
									lastResizeAt = now;
									created.moveAndResize({
										height: dimensions.height,
										width: Math.max(created.width, dimensions.width),
										x: created.x,
										y: created.y,
									});
									void created.canvas?.requestFrame?.();
								}
							}
						}

						if (final) {
							generationStatus?.destroy();
							featureUpdate = Promise.resolve(final.providerMetadata).then((metadata) => {
								const google = metadata?.google;
								const grounding = google?.groundingMetadata;
								const searchUsed = grounding?.webSearchQueries?.length > 0 ||
									grounding?.groundingChunks?.some((chunk: any) => chunk.web);
								const searchState = google && "groundingMetadata" in google
									? (searchUsed ? "used" : "not used") : "usage unknown";
								const urls = google?.urlContextMetadata?.urlMetadata;
								const urlState = google && "urlContextMetadata" in google
									? (urls?.some((url: any) => url.urlRetrievalStatus === "URL_RETRIEVAL_STATUS_SUCCESS")
										? "used" : urls?.length ? "retrieval failed" : "not used") : "usage unknown";
								searchFeature?.setText(`🔍 Search: ${searchState}`);
								urlFeature?.setText(`🌐 URL Context: ${urlState}`);
							}).catch(() => {
								searchFeature?.setText("🔍 Search: usage unknown");
								urlFeature?.setText("🌐 URL Context: usage unknown");
							});
							created.nodeEl?.removeClass("ai-generating");
							// Final resize to ensure optimal dimensions
							const finalDimensions = calculateNoteDimensions(created.text);
							created.moveAndResize({
								height: finalDimensions.height,
								width: finalDimensions.width,
								x: created.x,
								y: created.y
							});
							void created.canvas?.requestFrame?.();

							// Add HTML preview if there are HTML code blocks
							const htmlBlocks = extractHtmlCodeBlocks(created.text);
							logDebug("[HTML Preview] Text length:", created.text?.length, "HTML blocks found:", htmlBlocks.length);
							if (htmlBlocks.length > 0) {
								logDebug("[HTML Preview] Adding preview to node, contentEl:", !!created.contentEl);
								const previewEl = addHtmlPreviewToNode(created, htmlBlocks, settings.autoPreviewHtml ?? false);
								logDebug("[HTML Preview] Preview element created:", !!previewEl);
							}
						}
						if (reasoningDetails && !created.contentEl.contains(reasoningDetails)) created.contentEl.appendChild(reasoningDetails);
						if (featuresEl && !created.contentEl.contains(featuresEl)) created.contentEl.appendChild(featuresEl);
						if (!created.contentEl.contains(toolsContainer)) created.contentEl.appendChild(toolsContainer);
						setModelIndicatorText(created, providerLabel(provider), shownModel, !final);
					}
				);

				if (!controller.signal.aborted && !created.text.trim()) {
					created.setText("The model returned an empty answer.");
					const emptyAnswerDimensions = calculateNoteDimensions(created.text, 300, 500);
					created.moveAndResize({
						height: emptyAnswerDimensions.height,
						width: emptyAnswerDimensions.width,
						x: created.x,
						y: created.y,
					});
				}

				await featureUpdate;

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
			} catch (error: any) {
				if (controller.signal.aborted) {
					if (!created.text.trim()) created.setText("Generation stopped.");
					const data = created.getData();
					created.setData({ ...data, ai_notes: [...(data.ai_notes ?? []), "Generation stopped"] });
				} else {
					// Extract detailed error info from AI SDK errors
					let errorDetail = error.message || String(error);

					// AI SDK errors often have nested details
					if (error.cause?.message) {
						errorDetail = error.cause.message;
					}
					if (error.responseBody) {
						try {
							const body = typeof error.responseBody === 'string'
								? JSON.parse(error.responseBody)
								: error.responseBody;
							if (body?.error?.message) {
								errorDetail = body.error.message;
							}
						} catch { /* the card is already gone */ }
					}
					// Gemini specific error format
					if (error.data?.error?.message) {
						errorDetail = error.data.error.message;
					}
					if (error.statusCode && error.message?.startsWith(`HTTP ${error.statusCode}:`)) {
						errorDetail = error.message;
					}

					new Notice(`Error calling the AI: ${errorDetail}`, 10000);

					// Show the error in the node instead of removing it. Text that already
					// streamed stays, with the error as its last line.
					if (created.text.trim()) {
						created.setText(`${created.text}\n\n**Error:** ${errorDetail}`);
					} else {
						created.setText(`**Error:** ${errorDetail}`);
						const errorDimensions = calculateNoteDimensions(created.text, 300, 500);
						created.moveAndResize({
							height: errorDimensions.height,
							width: errorDimensions.width,
							x: created.x,
							y: created.y
						});
					}
				}
			} finally {
				generationStatus?.destroy();
				created.nodeEl?.removeClass("ai-generating");
				if (created.contentEl) addModelIndicator(created, providerLabel(provider), shownModel);
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

	// logDebug({ settings, tokenLimit });
	return tokenLimit;
}
