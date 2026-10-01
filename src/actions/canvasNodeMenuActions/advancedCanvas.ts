import { App, setIcon, setTooltip } from "obsidian";
import { noteGenerator } from "./noteGenerator";
import { AugmentedCanvasSettings } from "../../settings/AugmentedCanvasSettings";
import { CanvasNode } from "../../obsidian/canvas-internal";
import { getActiveCanvasNodes } from "src/utils";
import { CustomQuestionModal } from "../../Modals/CustomQuestionModal";
import { countNodeAndAncestors } from "../../obsidian/canvasUtil";

const contextTooltip = (label: string, node: CanvasNode, maxDepth: number) => {
	const count = countNodeAndAncestors(node, maxDepth);
	return `${label} (${count} ${count === 1 ? "card" : "cards"})`;
};


export const addAskAIButton = async (
	app: App,
	settings: AugmentedCanvasSettings,
	menuEl: HTMLElement,
	node?: CanvasNode
) => {
	const buttonEl_AskAI = createEl("button", "clickable-icon ai-menu-item");
	const targetNode = node || getActiveCanvasNodes(app)?.[0];
	setTooltip(buttonEl_AskAI, targetNode
		? contextTooltip("Ask AI", targetNode, settings.maxDepth)
		: "Ask AI", {
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
	question: string,
	provider?: any,
	model?: any
) => {
	// Get the current active provider and model for default behavior
	provider ||= settings.providers.find(p => p.id === settings.activeProvider);
	model ||= settings.models.find(m => m.id === settings.apiModel && m.providerId === provider?.id && m.enabled) || settings.models.find(m => m.providerId === provider?.id && m.enabled);
	
	const { generateNote } = noteGenerator(app, settings, node, undefined, provider, model);
	await generateNote(question);
};

export const addAskQuestionButton = (
	app: App,
	settings: AugmentedCanvasSettings,
	menuEl: HTMLElement,
	node: CanvasNode
) => {
	const buttonEl = createEl("button", "clickable-icon ai-menu-item");
	setTooltip(
		buttonEl,
		contextTooltip("Ask a question…", node, settings.maxDepth),
		{ placement: "top" }
	);
	setIcon(buttonEl, "lucide-message-square-plus");
	menuEl.appendChild(buttonEl);

	buttonEl.addEventListener("click", () => {
		new CustomQuestionModal(app, settings, (question, selection) => {
			void handleCallAI_Question(
				app,
				settings,
				node,
				question,
				selection.provider,
				selection.model
			);
		}).open();
	});
};


const handleRegenerateResponse = async (
	app: App,
	settings: AugmentedCanvasSettings,
	chooseContext = false
) => {
	const activeNode = getActiveCanvasNodes(app)![0];

	// const canvas = getActiveCanvas(app);

	// // @ts-expect-error
	// const toNode = activeNode.to.node;

	// logDebug({ toNode });

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

	await generateNote(undefined, undefined, chooseContext);
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

	const contextButton = createEl("button", "clickable-icon ai-menu-item");
	setTooltip(contextButton, "Regenerate with chosen context…", { placement: "top" });
	setIcon(contextButton, "lucide-list-filter");
	menuEl.appendChild(contextButton);
	contextButton.addEventListener("click", () =>
		handleRegenerateResponse(app, settings, true)
	);
};
