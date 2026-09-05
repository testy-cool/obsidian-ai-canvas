import { App, Modal, Setting, Notice, DropdownComponent } from "obsidian";
import { AugmentedCanvasSettings, LLMProvider, LLMModel } from "../settings/AugmentedCanvasSettings";

export interface ModelSelection {
	provider: LLMProvider;
	model: LLMModel;
}

export class ModelSelectionModal extends Modal {
	private settings: AugmentedCanvasSettings;
	private onSelect: (selection: ModelSelection) => void;
	private selectedProvider: LLMProvider | null = null;
	private selectedModel: LLMModel | null = null;
	private availableModels: LLMModel[] = [];
	private modelDropdown: DropdownComponent;

	constructor(
		app: App,
		settings: AugmentedCanvasSettings,
		onSelect: (selection: ModelSelection) => void
	) {
		super(app);
		this.settings = settings;
		this.onSelect = onSelect;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Select AI Model" });

		// Initialize with current active provider and model
		this.selectedProvider = this.settings.providers.find(p => p.id === this.settings.activeProvider) || null;
		this.updateAvailableModels();
		this.selectedModel = this.availableModels.find(m => m.id === this.settings.apiModel) || this.availableModels[0] || null;

		this.createProviderSetting();
		this.createModelSetting();
		this.createButtons();
		contentEl.querySelector<HTMLSelectElement>("select")?.focus();
	}

	private createProviderSetting() {
		const enabledProviders = this.settings.providers.filter(p => p.enabled);
		
		if (enabledProviders.length === 0) {
			this.contentEl.createEl("p", { 
				text: "No providers configured. Please configure providers in settings first.",
				cls: "mod-warning"
			});
			return;
		}

		new Setting(this.contentEl)
			.setName("Provider")
			.setDesc("Select the AI provider to use")
			.addDropdown(dropdown => {
				enabledProviders.forEach(provider => {
					dropdown.addOption(provider.id, provider.type);
				});
				
				if (this.selectedProvider) {
					dropdown.setValue(this.selectedProvider.id);
				}
				
				dropdown.onChange(value => {
					this.selectedProvider = this.settings.providers.find(p => p.id === value) || null;
					this.updateAvailableModels();
					this.selectedModel = this.availableModels[0] || null;
					this.updateModelOptions();
				});
			});
	}

	private createModelSetting() {

		new Setting(this.contentEl)
			.setName("Model")
			.setDesc("Select the AI model to use")
			.addDropdown(dropdown => {
				this.modelDropdown = dropdown;
				this.updateModelOptions();

				dropdown.onChange(value => {
					this.selectedModel = this.availableModels.find(m => m.id === value) || null;
				});
			});
	}

	private createButtons() {
		const buttonContainer = this.contentEl.createDiv({ cls: "modal-button-container" });
		
		const selectButton = buttonContainer.createEl("button", { 
			text: "Select", 
			cls: "mod-cta" 
		});
		selectButton.addEventListener("click", () => {
			if (this.selectedProvider && this.selectedModel) {
				this.onSelect({
					provider: this.selectedProvider,
					model: this.selectedModel
				});
				this.close();
			} else {
				new Notice("Please select both a provider and model");
			}
		});

		const cancelButton = buttonContainer.createEl("button", { 
			text: "Cancel" 
		});
		cancelButton.addEventListener("click", () => {
			this.close();
		});
	}

	private updateAvailableModels() {
		if (this.selectedProvider) {
			this.availableModels = this.settings.models.filter(
				m => m.providerId === this.selectedProvider!.id && m.enabled
			);
		} else {
			this.availableModels = [];
		}
	}

	private updateModelOptions() {
		const dropdown = this.modelDropdown;
		dropdown.selectEl.empty();
		if (this.availableModels.length) {
			for (const model of this.availableModels) dropdown.addOption(model.id, model.model);
			dropdown.setValue(this.selectedModel?.id || this.availableModels[0].id);
		} else {
			dropdown.addOption("", "No models available for this provider");
		}
		dropdown.setDisabled(this.availableModels.length === 0);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
} 