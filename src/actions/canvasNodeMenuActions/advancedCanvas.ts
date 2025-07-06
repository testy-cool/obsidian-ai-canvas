import { App, setIcon, setTooltip, Notice } from "obsidian";
import { getTokenLimit, noteGenerator } from "./noteGenerator";
import { AugmentedCanvasSettings } from "../../settings/AugmentedCanvasSettings";
import { CanvasNode } from "../../obsidian/canvas-internal";
import { getResponse } from "../../utils/llm";
import { getActiveCanvas, getActiveCanvasNodes } from "src/utils";
import { ModelSelectionModal, ModelSelection } from "../../Modals/ModelSelectionModal";
import { CustomQuestionModal } from "../../Modals/CustomQuestionModal";

const SYSTEM_PROMPT_QUESTIONS = `
You must respond in this JSON format: {
	"questions": Follow up questions the user could ask based on the chat history, must be an array
}
The questions must be asked in the same language the user used, default to English.
`.trim();

export const addAskAIButton = async (
	app: App,
	settings: AugmentedCanvasSettings,
	menuEl: HTMLElement
) => {
	const buttonEl_AskAI = createEl("button", "clickable-icon ai-menu-item");
	setTooltip(buttonEl_AskAI, "Ask AI", {
		placement: "top",
	});
	setIcon(buttonEl_AskAI, "lucide-sparkles");
	menuEl.appendChild(buttonEl_AskAI);

	buttonEl_AskAI.addEventListener("click", async () => {
		// Get the current active provider and model for default behavior
		const provider = settings.providers.find(p => p.id === settings.activeProvider);
		const model = settings.models.find(m => m.id === settings.apiModel && m.providerId === provider?.id && m.enabled) || settings.models.find(m => m.providerId === provider?.id && m.enabled);
		
		const { generateNote } = noteGenerator(app, settings, undefined, undefined, provider, model);

		await generateNote();
	});
};

export const handleCallAI_Question = async (
	app: App,
	settings: AugmentedCanvasSettings,
	node: CanvasNode,
	question: string
) => {
	if (node.unknownData.type === "group") {
		return;
	}

	// Get the current active provider and model for default behavior
	const provider = settings.providers.find(p => p.id === settings.activeProvider);
	const model = settings.models.find(m => m.id === settings.apiModel && m.providerId === provider?.id && m.enabled) || settings.models.find(m => m.providerId === provider?.id && m.enabled);
	
	const { generateNote } = noteGenerator(app, settings, node, undefined, provider, model);
	await generateNote(question);
};

export const handleCallAI_Questions = async (
	app: App,
	settings: AugmentedCanvasSettings,
	node: CanvasNode
) => {
	// Get the current active provider and model for default behavior
	const provider = settings.providers.find(p => p.id === settings.activeProvider);
	const model = settings.models.find(m => m.id === settings.apiModel && m.providerId === provider?.id && m.enabled) || settings.models.find(m => m.providerId === provider?.id && m.enabled);

	const { buildMessages } = noteGenerator(app, settings, undefined, undefined, provider, model);
	const { messages, tokenCount } = await buildMessages(node, {
		systemPrompt: SYSTEM_PROMPT_QUESTIONS,
	});
	if (messages.length <= 1) return;
	if (!provider) {
		new Notice("No active provider found. Please check your settings.");
		return;
	}

	const aiResponse = await getResponse(
		provider,
		// settings.apiModel,
		messages,
		{
			model: settings.apiModel,
			max_tokens: settings.maxResponseTokens || undefined,
			// max_tokens: getTokenLimit(settings) - tokenCount - 1,
			temperature: settings.temperature,
			isJSON: true,
		}
	);

	return aiResponse.questions;
};

const handleRegenerateResponse = async (
	app: App,
	settings: AugmentedCanvasSettings
) => {
	const activeNode = getActiveCanvasNodes(app)![0];

	// const canvas = getActiveCanvas(app);

	// // @ts-expect-error
	// const toNode = activeNode.to.node;

	// console.log({ toNode });

	// canvas!.removeNode(toNode);
	// canvas?.requestSave();

	// Get the current active provider and model for default behavior
	const provider = settings.providers.find(p => p.id === settings.activeProvider);
	const model = settings.models.find(m => m.id === settings.apiModel && m.providerId === provider?.id && m.enabled) || settings.models.find(m => m.providerId === provider?.id && m.enabled);

	const { generateNote } = noteGenerator(
		app,
		settings,
		// @ts-expect-error
		activeNode.from.node,
		// @ts-expect-error
		activeNode.to.node,
		provider,
		model
	);

	await generateNote();
};

export const addRegenerateResponse = async (
	app: App,
	settings: AugmentedCanvasSettings,
	menuEl: HTMLElement
) => {
	const buttonEl_AskAI = createEl("button", "clickable-icon ai-menu-item");
	setTooltip(buttonEl_AskAI, "Regenerate response", {
		placement: "top",
	});
	// TODO
	setIcon(buttonEl_AskAI, "lucide-rotate-cw");
	menuEl.appendChild(buttonEl_AskAI);

	buttonEl_AskAI.addEventListener("click", () =>
		handleRegenerateResponse(app, settings)
	);
};

// New functions for model selection

export const addAskAIWithModelButton = async (
	app: App,
	settings: AugmentedCanvasSettings,
	menuEl: HTMLElement
) => {
	const buttonEl_AskAI = createEl("button", "clickable-icon ai-menu-item");
	setTooltip(buttonEl_AskAI, "Ask AI (Select Model)", {
		placement: "top",
	});
	setIcon(buttonEl_AskAI, "lucide-brain-circuit");
	menuEl.appendChild(buttonEl_AskAI);

	buttonEl_AskAI.addEventListener("click", async () => {
		const modal = new ModelSelectionModal(app, settings, async (selection: ModelSelection) => {
			const { generateNote } = noteGenerator(app, settings, undefined, undefined, selection.provider, selection.model);
			await generateNote();
		});
		modal.open();
	});
};

export const addAskQuestionWithModelButton = async (
	app: App,
	settings: AugmentedCanvasSettings,
	menuEl: HTMLElement
) => {
	const buttonEl_AskQuestion = createEl("button", "clickable-icon ai-menu-item");
	setTooltip(buttonEl_AskQuestion, "Ask Question (Select Model)", {
		placement: "top",
	});
	setIcon(buttonEl_AskQuestion, "lucide-settings-2");
	menuEl.appendChild(buttonEl_AskQuestion);

	buttonEl_AskQuestion.addEventListener("click", async () => {
		const modal = new ModelSelectionModal(app, settings, async (selection: ModelSelection) => {
			const questionModal = new CustomQuestionModal(app, async (question: string) => {
				const { generateNote } = noteGenerator(app, settings, undefined, undefined, selection.provider, selection.model);
				await generateNote(question);
			});
			questionModal.open();
		});
		modal.open();
	});
};

export const handleCallAI_QuestionWithModel = async (
	app: App,
	settings: AugmentedCanvasSettings,
	node: CanvasNode,
	question: string,
	provider: any,
	model: any
) => {
	if (node.unknownData.type === "group") {
		return;
	}

	const { generateNote } = noteGenerator(app, settings, node, undefined, provider, model);
	await generateNote(question);
};
