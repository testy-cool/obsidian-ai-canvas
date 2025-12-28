import { App, Modal, Notice, Setting } from "obsidian";
import AugmentedCanvasPlugin from "../AugmentedCanvasPlugin";
import { LLMModel, LLMProvider } from "../settings/AugmentedCanvasSettings";
import { fetchProviderModels } from "../utils/modelFetch";

export class EditModelModal extends Modal {
    plugin: AugmentedCanvasPlugin;
    model: LLMModel | null;
    onSubmit: (models: LLMModel[]) => void;
    idInput: string = "";
    providerIdInput: string = "";
    modelInput: string = "";
    customModelInput: string = "";
    enabledInput: boolean = true;
    providers: LLMProvider[];
    availableModels: string[] = [];
    selectedModelIds = new Set<string>();

    constructor(
        app: App, 
        plugin: AugmentedCanvasPlugin, 
        model: LLMModel | null,
        providers: LLMProvider[],
        onSubmit: (models: LLMModel[]) => void,
        prefillProviderId?: string
    ) {
        super(app);
        this.plugin = plugin;
        this.model = model;
        this.providers = providers;
        this.onSubmit = onSubmit;

        // Initialize inputs with model values if editing
        if (model) {
            this.idInput = model.id;
            this.providerIdInput = model.providerId;
            this.modelInput = model.model;
            this.enabledInput = model.enabled;
        } else {
            // For new models, default to first available provider
            this.providerIdInput = prefillProviderId || providers[0]?.id || "";
        }
    }

    onOpen() {
        this.contentEl.empty();
        this.contentEl.addClass("augmented-canvas-modal-container");

        // Title
        this.contentEl.createEl("h3", { 
            text: this.model ? "Edit Model" : "Add Models" 
        });

        if (this.model) {
            this.renderEditFields();
        } else {
            this.renderAddFields();
        }

        // Submit button
        const footerEl = this.contentEl.createDiv("modal-button-container");
        
        const cancelBtn = footerEl.createEl("button", { text: "Cancel" });
        cancelBtn.onClickEvent(() => {
            this.close();
        });

        const submitBtn = footerEl.createEl("button", { 
            text: this.model ? "Save" : "Add Selected",
            cls: "mod-cta"
        });
        
        submitBtn.onClickEvent(() => {
            if (this.model) {
                if (!this.idInput.trim() || !this.modelInput.trim() || !this.providerIdInput) {
                    new Notice("Model ID, name, and provider are required.");
                    return;
                }

                const updatedModel: LLMModel = {
                    id: this.idInput.trim(),
                    providerId: this.providerIdInput,
                    model: this.modelInput.trim(),
                    enabled: this.enabledInput
                };

                this.onSubmit([updatedModel]);
                this.close();
                return;
            }

            const selections = Array.from(this.selectedModelIds);
            if (this.customModelInput.trim()) {
                selections.push(this.customModelInput.trim());
            }

            if (!this.providerIdInput) {
                new Notice("Select a provider first.");
                return;
            }

            if (!selections.length) {
                new Notice("Select at least one model or enter a custom model.");
                return;
            }

            const newModels = selections.map((modelId) => ({
                id: modelId,
                providerId: this.providerIdInput,
                model: modelId,
                enabled: true
            }));

            this.onSubmit(newModels);
            this.close();
        });
    }

    private renderEditFields() {
        new Setting(this.contentEl)
            .setName("Model ID")
            .setDesc("A unique identifier for this model")
            .addText((text) => {
                text.setValue(this.idInput)
                    .setPlaceholder("e.g., claude-3-sonnet")
                    .onChange((value) => {
                        this.idInput = value;
                    });
            });

        new Setting(this.contentEl)
            .setName("Provider")
            .setDesc("Select the provider for this model")
            .addDropdown((dropdown) => {
                this.providers.forEach(provider => {
                    dropdown.addOption(provider.id, provider.type);
                });

                dropdown.setValue(this.providerIdInput)
                    .onChange((value) => {
                        this.providerIdInput = value;
                    });
            });

        new Setting(this.contentEl)
            .setName("Model Name")
            .setDesc("The full model identifier")
            .addText((text) => {
                text.setValue(this.modelInput)
                    .setPlaceholder("e.g., claude-3-sonnet-latest")
                    .onChange((value) => {
                        this.modelInput = value;
                    });
            });

        new Setting(this.contentEl)
            .setName("Enabled")
            .setDesc("Whether this model is enabled")
            .addToggle((toggle) => {
                toggle.setValue(this.enabledInput)
                    .onChange((value) => {
                        this.enabledInput = value;
                    });
            });
    }

    private renderAddFields() {
        new Setting(this.contentEl)
            .setName("Provider")
            .setDesc("Select a provider and fetch its models.")
            .addDropdown((dropdown) => {
                this.providers.forEach(provider => {
                    dropdown.addOption(provider.id, provider.type);
                });

                dropdown.setValue(this.providerIdInput)
                    .onChange((value) => {
                        this.providerIdInput = value;
                        this.availableModels = [];
                        this.selectedModelIds.clear();
                        this.refresh();
                    });
            });

        new Setting(this.contentEl)
            .setName("Available Models")
            .setDesc("Fetch the provider's model list to choose from.")
            .addButton(button => button
                .setButtonText("Fetch")
                .setCta()
                .onClick(async () => {
                    const provider = this.providers.find(p => p.id === this.providerIdInput);
                    if (!provider) {
                        new Notice("Select a provider first.");
                        return;
                    }

                    try {
                        const apiKey = provider.apiKey || this.plugin.settings.apiKey;
                        const modelIds = await fetchProviderModels(provider, apiKey);
                        this.availableModels = modelIds.sort((a, b) => a.localeCompare(b));
                        this.selectedModelIds.clear();
                        this.refresh();
                        new Notice(`Fetched ${modelIds.length} models from ${provider.type}.`);
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        new Notice(`Failed to fetch models: ${message}`);
                    }
                })
            );

        const listContainer = this.contentEl.createDiv({ cls: "model-selection-list" });

        if (!this.availableModels.length) {
            listContainer.createEl("div", {
                text: "No models fetched yet.",
                cls: "mod-muted"
            });
        } else {
            this.availableModels.forEach((modelId) => {
                const row = listContainer.createEl("label", { cls: "model-selection-item" });
                const checkbox = row.createEl("input", { type: "checkbox" });
                checkbox.checked = this.selectedModelIds.has(modelId);
                checkbox.addEventListener("change", () => {
                    if (checkbox.checked) {
                        this.selectedModelIds.add(modelId);
                    } else {
                        this.selectedModelIds.delete(modelId);
                    }
                });
                row.createEl("span", { text: modelId });
            });
        }

        new Setting(this.contentEl)
            .setName("Custom Model")
            .setDesc("Optional: add a model ID not listed above.")
            .addText((text) => {
                text.setValue(this.customModelInput)
                    .setPlaceholder("e.g., gemini-1.5-pro-latest")
                    .onChange((value) => {
                        this.customModelInput = value;
                    });
            });
    }

    private refresh() {
        this.contentEl.empty();
        this.onOpen();
    }
} 
