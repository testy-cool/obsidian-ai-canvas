let FuseIndex: any;

// Dynamically import fuse.js
import("fuse.js").then(module => {
    FuseIndex = module.FuseIndex;
});


export interface SystemPrompt {
	id: number;
	act: string;
	prompt: string;
}

export interface LLMModel {
	/**
	 * Unique identifier for the model
	 */
	id: string;

	/**
	 * ID of the provider this model belongs to
	 */
	providerId: string;

	/**
	 * Full model name/identifier
	 */
	model: string;

	/**
	 * Whether this model is enabled
	 */
	enabled: boolean;
}

export type MCPTransportType = 'http' | 'sse' | 'websocket';

export interface MCPServer {
	/**
	 * Unique identifier for the server
	 */
	id: string;

	/**
	 * Display name for the server
	 */
	name: string;

	/**
	 * Server URL endpoint
	 */
	url: string;

	/**
	 * Transport type (http, sse, websocket)
	 */
	transport: MCPTransportType;

	/**
	 * Optional API key for authentication
	 */
	apiKey?: string;

	/**
	 * Optional custom headers
	 */
	headers?: Record<string, string>;

	/**
	 * Whether this server is enabled
	 */
	enabled: boolean;

	/**
	 * Cached tool count (updated on test/connect)
	 */
	toolCount?: number;
}

export interface LLMProvider {
	/**
	 * Unique identifier for the provider
	 */
	id: string;

	/**
	 * Display name for the provider
	 */
	type: string;

	/**
	 * Base URL for the provider's API
	 */
	baseUrl: string;

	/**
	 * API key for the provider
	 */
	apiKey: string;

	/**
	 * Whether this provider is enabled
	 */
	enabled: boolean;

	/**
	 * Google Cloud project ID (for Vertex AI)
	 */
	projectId?: string;

	/**
	 * Google Cloud location/region (for Vertex AI)
	 */
	location?: string;

	/**
	 * Service account JSON credentials (for Vertex AI)
	 */
	serviceAccountJson?: string;
}

export interface AugmentedCanvasSettings {
	/**
	 * List of configured LLM providers
	 */
	providers: LLMProvider[];

	/**
	 * List of available models
	 */
	models: LLMModel[];

	/**
	 * The API key to use when making requests (legacy)
	 */
	apiKey: string;

	/**
	 * The AI model to use (legacy)
	 */
	apiModel: string;

	/**
	 * The temperature to use when generating responses (0-2). 0 means no randomness.
	 */
	temperature: number;

	/**
	 * The system prompt sent with each request to the API
	 */
	systemPrompt: string;

	/**
	 * Enable debug output in the console
	 */
	debug: boolean;

	/**
	 * The maximum number of tokens to send (up to model limit). 0 means as many as possible.
	 */
	maxInputTokens: number;

	/**
	 * The maximum number of tokens to return from the API. 0 means no limit. (A token is about 4 characters).
	 */
	maxResponseTokens: number;

	/**
	 * The maximum depth of ancestor notes to include. 0 means no limit.
	 */
	maxDepth: number;

	/**
	 * System prompt list fetch from github
	 */
	systemPrompts: SystemPrompt[];

	/**
	 * User system prompts
	 */
	userSystemPrompts: SystemPrompt[];

	/**
	 * System prompt used to generate flashcards file
	 */
	flashcardsSystemPrompt: string;

	/**
	 * System prompt used to generate flashcards file
	 */
	insertRelevantQuestionsFilesCount: number;

	/**
	 * System prompt used to generate flashcards file
	 */
	relevantQuestionsSystemPrompt: string;

	/**
	 * The path where generated images are stored
	 */
	imagesPath?: string;

	/**
	 * Provider used for image generation (empty means default provider).
	 */
	imageProviderId: string;

	/**
	 * Model used for image generation (empty means default image model).
	 */
	imageModelId: string;

	/**
	 * The Youtube API Key
	 */
	youtubeApiKey: string;

	/**
	 * Currently active provider (empty string means default OpenAI)
	 */
	activeProvider: string;

	/**
	 * Enable AI card title generation.
	 */
	enableCardTitleGeneration: boolean;

	/**
	 * Provider used for AI card titles.
	 */
	cardTitleProviderId: string;

	/**
	 * Model used for AI card titles.
	 */
	cardTitleModelId: string;

	/**
	 * System prompt used to generate card titles.
	 */
	cardTitleSystemPrompt: string;

	/**
	 * Enable AI group naming.
	 */
	enableGroupTitleGeneration: boolean;

	/**
	 * Provider used for AI group naming.
	 */
	groupTitleProviderId: string;

	/**
	 * Model used for AI group naming.
	 */
	groupTitleModelId: string;

	/**
	 * System prompt used to generate group names.
	 */
	groupTitleSystemPrompt: string;

	/**
	 * List of configured MCP servers
	 */
	mcpServers: MCPServer[];

	/**
	 * Whether MCP tools are enabled globally
	 */
	mcpEnabled: boolean;

	/**
	 * Maximum number of agentic steps (tool call iterations)
	 */
	mcpMaxSteps: number;

	/**
	 * Whether to require approval before executing MCP tools
	 */
	mcpRequireApproval: boolean;
}

const DEFAULT_SYSTEM_PROMPT = `
You must respond in markdown.
The response must be in the same language the user used, default to english.
`.trim();

const FLASHCARDS_SYSTEM_PROMPT = `
You will create a file containing flashcards.

The front of the flashcard must be a question.

The question must not give the answer, If the question is too precise, ask a more general question.

If there is a list in the text given by the user. Start by creating a flashcard asking about this list.

The filename, can be written with spaces, must not contain the word "flashcard", must tell the subjects of the flashcards.
`.trim();

const RELEVANT_QUESTION_SYSTEM_PROMPT = `
You will ask relevant questions based on the user input.

These questions must be opened questions.

Priories questions that connect different topics together.
`.trim();

const DEFAULT_CARD_TITLE_PROMPT = `
You are naming a canvas card.
Return a short, descriptive title in the same language as the content.
Keep it under 8 words.
Return only the title text with no quotes or markdown.
`.trim();

const DEFAULT_GROUP_TITLE_PROMPT = `
You are naming a canvas group.
Return a short, descriptive name in the same language as the content.
Keep it under 6 words.
Return only the name text with no quotes or markdown.
`.trim();

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

// Default providers that come built-in
const DEFAULT_PROVIDERS: LLMProvider[] = [
	{
		id: "gemini",
		type: "Gemini",
		baseUrl: GEMINI_BASE_URL,
		apiKey: "",
		enabled: true
	},
	{
		id: "vertex",
		type: "Vertex",
		baseUrl: "",
		apiKey: "",
		enabled: false,
		projectId: "",
		location: "us-central1"
	}
];

// Default models that come built-in
const DEFAULT_MODELS: LLMModel[] = [
	{
		id: "gemini-3-flash-preview",
		providerId: "gemini",
		model: "gemini-3-flash-preview",
		enabled: true
	},
	{
		id: "gemini-3-pro-preview",
		providerId: "gemini",
		model: "gemini-3-pro-preview",
		enabled: true
	}
];

export const DEFAULT_SETTINGS: AugmentedCanvasSettings = {
	apiKey: "",
	apiModel: "gemini-3-flash-preview",
	temperature: 1,
	systemPrompt: DEFAULT_SYSTEM_PROMPT,
	debug: true,
	maxInputTokens: 0,
	maxResponseTokens: 0,
	maxDepth: 0,
	systemPrompts: [],
	userSystemPrompts: [],
	flashcardsSystemPrompt: FLASHCARDS_SYSTEM_PROMPT,
	insertRelevantQuestionsFilesCount: 10,
	relevantQuestionsSystemPrompt: RELEVANT_QUESTION_SYSTEM_PROMPT,
	imagesPath: undefined,
	imageProviderId: "",
	imageModelId: "",
	youtubeApiKey: "",
	providers: DEFAULT_PROVIDERS,
	models: DEFAULT_MODELS,
	activeProvider: "gemini",
	enableCardTitleGeneration: true,
	cardTitleProviderId: "gemini",
	cardTitleModelId: "gemini-3-flash-preview",
	cardTitleSystemPrompt: DEFAULT_CARD_TITLE_PROMPT,
	enableGroupTitleGeneration: true,
	groupTitleProviderId: "gemini",
	groupTitleModelId: "gemini-3-flash-preview",
	groupTitleSystemPrompt: DEFAULT_GROUP_TITLE_PROMPT,
	mcpServers: [],
	mcpEnabled: true,
	mcpMaxSteps: 5,
	mcpRequireApproval: false
};


