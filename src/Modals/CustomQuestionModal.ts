import { Modal, App } from "obsidian";
import {
	AugmentedCanvasSettings,
	LLMModel,
	LLMProvider,
} from "../settings/AugmentedCanvasSettings";

export interface QuestionModelSelection {
	provider: LLMProvider;
	model: LLMModel;
}

export class CustomQuestionModal extends Modal {
	private settings: AugmentedCanvasSettings;
	onSubmit: (input: string, selection: QuestionModelSelection) => void;

	constructor(
		app: App,
		settings: AugmentedCanvasSettings,
		onSubmit: (input: string, selection: QuestionModelSelection) => void,
		private readonly initialSelection?: QuestionModelSelection
	) {
		super(app);
		this.settings = settings;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.className = "augmented-canvas-modal-container";
		const choices = this.settings.providers
			.filter(provider => provider.enabled)
			.flatMap(provider =>
				this.settings.models
					.filter(model => model.providerId === provider.id && model.enabled)
					.map(model => ({ provider, model }))
			);
		// Same default as plain Ask AI: the active model, else the active
		// provider's first enabled model.
		const preferredProviderId =
			this.initialSelection?.provider.id || this.settings.activeProvider;
		const preferredModelId =
			this.initialSelection?.model.id || this.settings.apiModel;
		const exactIndex = choices.findIndex(({ provider, model }) =>
			provider.id === preferredProviderId &&
			model.id === preferredModelId
		);
		const defaultIndex = Math.max(
			0,
			exactIndex >= 0
				? exactIndex
				: choices.findIndex(({ provider }) => provider.id === preferredProviderId)
		);

		const modelLabel = contentEl.createEl("label", {
			text: "Model",
			cls: "augmented-canvas-modal-model",
		});
		const modelSelect = modelLabel.createEl("select", { cls: "dropdown" });
		modelSelect.setAttribute("aria-label", "Model");
		choices.forEach(({ provider, model }, index) => {
			const option = modelSelect.createEl("option", {
				text: `${provider.type} · ${model.model}`,
			});
			option.value = String(index);
		});
		modelSelect.value = String(defaultIndex);
		modelSelect.disabled = choices.length === 0;

		const textareaEl = contentEl.createEl("textarea");
		textareaEl.className = "augmented-canvas-modal-textarea";
		textareaEl.placeholder = "Write your question here";

		// Add keydown event listener to the textarea
		textareaEl.addEventListener("keydown", (event) => {
			// Check if Ctrl + Enter is pressed
			if (event.ctrlKey && event.key === "Enter") {
				// Prevent default action to avoid any unwanted behavior
				event.preventDefault();
				// Call the onSubmit function and close the modal
				const selection = choices[Number(modelSelect.value)];
				if (selection) this.onSubmit(textareaEl.value, selection);
				this.close();
			}
		});

		contentEl.createEl("div", { cls: "augmented-canvas-modal-hint", text: "Ctrl+Enter to send" });
		const actions = contentEl.createDiv({ cls: "augmented-canvas-modal-actions" });
		actions.createEl("button", { text: "Cancel" }).onClickEvent(() => this.close());

		// Create and append a submit button
		const submitBtn = actions.createEl("button", { text: "Ask AI" });
		submitBtn.disabled = choices.length === 0;
		submitBtn.onClickEvent(() => {
			const selection = choices[Number(modelSelect.value)];
			if (selection) this.onSubmit(textareaEl.value, selection);
			this.close();
		});
		textareaEl.focus();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
