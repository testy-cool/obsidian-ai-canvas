import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI, google } from "@ai-sdk/google";
import { streamText, generateText } from "ai";
import { ModelMessage } from "@ai-sdk/provider-utils";
import { logDebug } from "src/logDebug";
import { LLMProvider } from "src/settings/AugmentedCanvasSettings";
import { requestUrl } from "obsidian";
import { getToolSchema, convertToGeminiSchema } from "./mcpClient";

// Cache for access tokens: serviceAccountEmail -> { token, expiresAt }
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

// Track if fetch has been patched
let fetchPatched = false;

/**
 * Patch global fetch to fix @ai-sdk/google tool schema bug
 * The AI SDK sends broken schemas (missing type, empty properties) to Gemini
 * This patch intercepts requests and fixes the schemas before sending
 */
const patchFetchForGemini = () => {
	if (fetchPatched) return;
	fetchPatched = true;

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

		// Only intercept Gemini API requests
		if (url.includes('generativelanguage.googleapis.com') || url.includes('aiplatform.googleapis.com')) {
			if (init?.body && typeof init.body === 'string') {
				try {
					const body = JSON.parse(init.body);

					// Fix tool schemas
					if (body.tools) {
						for (const toolGroup of body.tools) {
							if (toolGroup.functionDeclarations) {
								for (const func of toolGroup.functionDeclarations) {
									// Get the stored schema for this tool
									const storedSchema = getToolSchema(func.name);
									if (storedSchema) {
										func.parameters = convertToGeminiSchema(storedSchema);
										logDebug(`[AI] Fixed schema for tool: ${func.name}`);
									}
								}
							}
						}
						init.body = JSON.stringify(body);
					}
				} catch (e) {
					// Not JSON or parsing failed, pass through
				}
			}
		}

		return originalFetch(input, init);
	};
};

const base64UrlEncode = (data: ArrayBuffer | string): string => {
	const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const pemToArrayBuffer = (pem: string): ArrayBuffer => {
	const base64 = pem
		.replace(/-----BEGIN PRIVATE KEY-----/, "")
		.replace(/-----END PRIVATE KEY-----/, "")
		.replace(/\s/g, "");
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
};

const signJwt = async (payload: object, privateKeyPem: string): Promise<string> => {
	const header = { alg: "RS256", typ: "JWT" };
	const encodedHeader = base64UrlEncode(JSON.stringify(header));
	const encodedPayload = base64UrlEncode(JSON.stringify(payload));
	const signingInput = `${encodedHeader}.${encodedPayload}`;

	const keyData = pemToArrayBuffer(privateKeyPem);
	const cryptoKey = await crypto.subtle.importKey(
		"pkcs8",
		keyData,
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["sign"]
	);

	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		cryptoKey,
		new TextEncoder().encode(signingInput)
	);

	return `${signingInput}.${base64UrlEncode(signature)}`;
};

export const getVertexAccessToken = async (serviceAccountJson: string): Promise<string> => {
	const sa = JSON.parse(serviceAccountJson);
	const email = sa.client_email;
	const privateKey = sa.private_key;

	if (!email || !privateKey) {
		throw new Error("Invalid service account JSON: missing client_email or private_key");
	}

	// Check cache
	const cached = tokenCache.get(email);
	if (cached && cached.expiresAt > Date.now() + 60000) {
		return cached.token;
	}

	const now = Math.floor(Date.now() / 1000);
	const jwtPayload = {
		iss: email,
		scope: "https://www.googleapis.com/auth/cloud-platform",
		aud: "https://oauth2.googleapis.com/token",
		iat: now,
		exp: now + 3600,
	};

	const signedJwt = await signJwt(jwtPayload, privateKey);

	const response = await requestUrl({
		url: "https://oauth2.googleapis.com/token",
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${signedJwt}`,
	});

	const tokenData = response.json;
	if (!tokenData.access_token) {
		throw new Error(`Failed to get access token: ${JSON.stringify(tokenData)}`);
	}

	// Cache the token
	tokenCache.set(email, {
		token: tokenData.access_token,
		expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
	});

	return tokenData.access_token;
};

const createVertexProvider = (provider: LLMProvider) => {
	const location = provider.location || "us-central1";
	const baseURL = `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${provider.projectId}/locations/${location}/publishers/google/models`;

	// Create a fetch wrapper that adds the Authorization header
	const vertexFetch: typeof fetch = async (input, init) => {
		const token = await getVertexAccessToken(provider.serviceAccountJson!);
		const headers = new Headers(init?.headers);
		headers.set("Authorization", `Bearer ${token}`);
		headers.delete("x-goog-api-key"); // Remove API key header
		return fetch(input, { ...init, headers });
	};

	return createGoogleGenerativeAI({
		baseURL,
		apiKey: "vertex", // Dummy value - will be replaced by Authorization header
		fetch: vertexFetch,
	});
};

const getLlm = (provider: LLMProvider) => {
	switch (provider.type) {
		case "Vertex": {
			if (!provider.serviceAccountJson) {
				throw new Error("Vertex AI requires service account JSON credentials");
			}
			if (!provider.projectId) {
				throw new Error("Vertex AI requires a project ID");
			}
			return createVertexProvider(provider);
		}
		case "Gemini":
		case "Google":
			return createGoogleGenerativeAI({
				apiKey: provider.apiKey,
			});
		case "OpenAI":
		case "OpenRouter":
		case "Groq":
		case "Anthropic":
		case "Ollama":
		case "Custom":
		case "LiteLLM":
		case "Azure":
		case "Together":
		case "Perplexity":
		case "Claude":
		case "Mistral":
		case "Cohere":
		case "Replicate":
		case "HuggingFace":
		case "Fireworks":
		case "DeepSeek":
		case "xAI":
		case "Other":
			return createOpenAI({
				apiKey: provider.apiKey,
				baseURL: provider.baseUrl,
			});
		default:
			throw new Error(`Unsupported provider: ${provider.type}`);
	}
};

const isGoogleProvider = (provider: LLMProvider) =>
	provider.type === "Gemini" || provider.type === "Google" || provider.type === "Vertex";

const supportsSearchGrounding = (modelId: string) =>
	/^(?:models\/)?gemini-2\.5-/.test(modelId);

const supportsUrlContext = (modelId: string) =>
	/^(?:models\/)?gemini-(?:2\.5|3)-/.test(modelId);

export interface StreamOptions {
	max_tokens?: number;
	model?: string;
	temperature?: number;
	tools?: Record<string, any>;
	maxSteps?: number;
}

export type ToolEvent = {
	type: 'tool-call' | 'tool-result';
	toolName?: string;
	toolCallId?: string;
	args?: any;
	result?: any;
};

export const streamResponse = async (
	provider: LLMProvider,
	messages: ModelMessage[],
	{
		max_tokens,
		model,
		temperature,
		tools: mcpTools,
		maxSteps = 10,
	}: StreamOptions = {},
	cb: (chunk: string | null, final: any, tool: ToolEvent | null, reasoningDelta: any) => void
) => {
	// Patch fetch for Gemini API requests (fixes broken tool schemas in @ai-sdk/google)
	patchFetchForGemini();

	const mcpToolCount = mcpTools ? Object.keys(mcpTools).length : 0;
	console.log("[AI Canvas] Stream request:", {
		model,
		provider: provider.type,
		mcpToolCount,
		maxSteps,
		toolNames: mcpTools ? Object.keys(mcpTools).slice(0, 5) : [],
	});

	const llm = getLlm(provider) as any;
	const modelId = model || "gemini-3-flash-preview";
	const useGoogle = isGoogleProvider(provider);
	const canUseSearch = useGoogle && supportsSearchGrounding(modelId);
	const canUseUrlContext = useGoogle && supportsUrlContext(modelId);

	// Build tools - can't mix url_context with MCP tools (Gemini limitation)
	const buildTools = (useUrlContext: boolean) => {
		const allTools: Record<string, any> = {};
		const hasMcpTools = mcpTools && Object.keys(mcpTools).length > 0;

		// Only use url_context if there are no MCP tools (Gemini doesn't support mixing them)
		if (useUrlContext && !hasMcpTools) {
			allTools.url_context = google.tools.urlContext({});
		}
		if (mcpTools) {
			Object.assign(allTools, mcpTools);
		}
		return Object.keys(allTools).length > 0 ? allTools : undefined;
	};

	const runStream = (useSearchGrounding: boolean, useUrlContext: boolean) => {
		const tools = buildTools(useUrlContext);
		const hasTools = tools && Object.keys(tools).length > 0;

		console.log("[AI Canvas] Calling streamText:", {
			modelId,
			useSearchGrounding,
			useUrlContext,
			hasTools,
			toolCount: tools ? Object.keys(tools).length : 0,
			toolNames: tools ? Object.keys(tools).slice(0, 10) : [],
			maxSteps,
		});

		const streamConfig: any = {
			model: useSearchGrounding ? llm(modelId, { useSearchGrounding: true }) : llm(modelId),
			messages,
			maxOutputTokens: max_tokens,
			temperature,
		};

		if (hasTools) {
			streamConfig.tools = tools;
			streamConfig.maxSteps = maxSteps;
			console.log("[AI Canvas] Adding tools to request, first tool:", Object.keys(tools!)[0], tools![Object.keys(tools!)[0]]);
		}

		return streamText(streamConfig);
	};

	let result;

	try {
		result = await runStream(canUseSearch, canUseUrlContext);
	} catch (error: any) {
		console.error("[AI Canvas] Stream error:", {
			message: error?.message,
			cause: error?.cause,
			responseBody: error?.responseBody,
			data: error?.data,
		});
		if (!canUseSearch && !canUseUrlContext) {
			throw error;
		}
		console.log("[AI Canvas] Retrying without Google features...");
		result = await runStream(false, false);
	}

	try {
		for await (const part of result.fullStream) {
			console.log("[AI Canvas] Stream event:", part.type, part.type === 'text-delta' ? (part as any).textDelta?.substring(0, 50) : '');
			switch (part.type) {
				case 'text-delta':
					cb((part as any).text || (part as any).textDelta, null, null, null);
					break;
				case 'tool-call':
					console.log("[AI Canvas] Tool call:", (part as any).toolName, (part as any).args);
					cb(null, null, {
						type: 'tool-call',
						toolName: (part as any).toolName,
						toolCallId: (part as any).toolCallId,
						args: (part as any).args,
					}, null);
					break;
				case 'tool-result':
					console.log("[AI Canvas] Tool result:", (part as any).toolName, "length:", String((part as any).result)?.length);
					cb(null, null, {
						type: 'tool-result',
						toolName: (part as any).toolName,
						toolCallId: (part as any).toolCallId,
						result: (part as any).result,
					}, null);
					break;
				case 'error':
					logDebug("Stream error part:", part);
					throw (part as any).error || new Error("Stream error");
				default:
					// Log other event types for debugging
					console.log("[AI Canvas] Other event:", part.type);
					break;
			}
		}
		const finalResult = await result;
		const finalText = await finalResult.text;
		console.log("[AI Canvas] Final result text length:", finalText?.length);
		cb(null, finalResult, null, null);
	} catch (streamError: any) {
		logDebug("Error during streaming:", {
			message: streamError?.message,
			cause: streamError?.cause,
			responseBody: streamError?.responseBody,
			data: streamError?.data,
			fullError: streamError,
		});
		throw streamError;
	}
};

export const getResponse = async (
	provider: LLMProvider,
	messages: ModelMessage[],
	{
		model,
		max_tokens,
		temperature,
		isJSON,
	}: {
		model?: string;
		max_tokens?: number;
		temperature?: number;
		isJSON?: boolean;
	} = {}
) => {
	logDebug("Calling AI (non-stream):", {
		messages,
		model,
		max_tokens,
		temperature,
		isJSON,
		provider,
	});

	const llm = getLlm(provider) as any;
	const modelId = model || "gemini-3-flash-preview";
	const useGoogle = isGoogleProvider(provider);
	const canUseSearch = useGoogle && supportsSearchGrounding(modelId);
	const canUseUrlContext = useGoogle && supportsUrlContext(modelId);

	const runGenerate = (useSearchGrounding: boolean, useUrlContext: boolean) =>
		generateText({
			model: useSearchGrounding ? llm(modelId, { useSearchGrounding: true }) : llm(modelId),
			messages,
			maxOutputTokens: max_tokens,
			temperature,
			...(useUrlContext && { tools: { url_context: google.tools.urlContext({}) } }),
		});

	let textResult;
	try {
		textResult = await runGenerate(canUseSearch, canUseUrlContext);
	} catch (error: any) {
		logDebug("AI generate error:", {
			message: error?.message,
			cause: error?.cause,
			responseBody: error?.responseBody,
			data: error?.data,
			fullError: error,
		});
		if (!canUseSearch && !canUseUrlContext) {
			throw error;
		}
		logDebug("Google features failed, retrying without them.", { error });
		textResult = await runGenerate(false, false);
	}

	const { text } = textResult;

	logDebug("AI response", { text });
	if (isJSON) {
		try {
			return JSON.parse(text as string);
		} catch (e) {
			logDebug("Error parsing JSON response:", e);
			return {}; // Return empty object on parse error
		}
	} else {
		return text ?? ""; // Ensure it's always a string
	}
};
