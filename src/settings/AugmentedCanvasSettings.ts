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
	 * The Youtube API Key
	 */
	youtubeApiKey: string;

	/**
	 * Currently active provider (empty string means default OpenAI)
	 */
	activeProvider: string;
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

// Default providers that come built-in
const DEFAULT_PROVIDERS: LLMProvider[] = [
	{
		id: "openai",
		type: "OpenAI",
		baseUrl: "https://api.openai.com/v1",
		apiKey: "",
		enabled: true
	},
	{
		id: "anthropic",
		type: "Anthropic",
		baseUrl: "https://api.anthropic.com/v1",
		apiKey: "",
		enabled: true
	},
	{
		id: "groq",
		type: "Groq",
		baseUrl: "https://api.groq.com/v1",
		apiKey: "",
		enabled: true
	},
	{
		id: "openrouter",
		type: "OpenRouter",
		baseUrl: "https://openrouter.ai/api/v1",
		apiKey: "",
		enabled: true
	},
	{
		id: "ollama",
		type: "Ollama",
		baseUrl: "http://localhost:11434/v1",
		apiKey: "",
		enabled: false
	}
];

// Default models that come built-in
const DEFAULT_MODELS: LLMModel[] = [
	{
		id: "default",
		providerId: "openai",
		model: "default",
		enabled: true
	},
	{
		id: "default-mini",
		providerId: "openai", 
		model: "default-mini",
		enabled: true
	},
	{
		id: "claude-3-sonnet",
		providerId: "anthropic",
		model: "claude-3-sonnet-latest",
		enabled: true
	},
	{
		id: "claude-3-opus",
		providerId: "anthropic",
		model: "claude-3-opus-latest",
		enabled: true
	},
	{
		id: "gemini-pro",
		providerId: "openrouter",
		model: "google/gemini-pro",
		enabled: true
	}
];

export const DEFAULT_SETTINGS: AugmentedCanvasSettings = {
	apiKey: "",
	apiModel: "default",
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
	youtubeApiKey: "",
	providers: DEFAULT_PROVIDERS,
	models: DEFAULT_MODELS,
	activeProvider: "openai"
};


