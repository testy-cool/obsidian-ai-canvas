import { App, Modal, Notice, Setting } from "obsidian";
import AugmentedCanvasPlugin from "../AugmentedCanvasPlugin";
import { LLMModel, LLMProvider } from "../settings/AugmentedCanvasSettings";
import { fetchProviderModels } from "../utils/modelFetch";
import { getParamsForProvider } from "../utils/providerParams";

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
                    enabled: this.enabledInput,
                    timeoutMs: this.model!.timeoutMs,
                    maxRetries: this.model!.maxRetries,
                    inputCostPerMillion: this.model!.inputCostPerMillion,
                    outputCostPerMillion: this.model!.outputCostPerMillion,
                    costOverridden: this.model!.costOverridden,
                    providerParams: this.model!.providerParams,
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

        // Universal fields
        new Setting(this.contentEl)
            .setName("Timeout (ms)")
            .setDesc("Request timeout in milliseconds. Leave empty for default.")
            .addText((text) => {
                text.setValue(this.model!.timeoutMs?.toString() ?? "")
                    .setPlaceholder("e.g., 30000")
                    .onChange((value) => {
                        const parsed = parseInt(value);
                        this.model!.timeoutMs = isNaN(parsed) ? undefined : parsed;
                    });
                text.inputEl.type = "number";
            });

        new Setting(this.contentEl)
            .setName("Max Retries")
            .setDesc("Maximum number of retries on failure.")
            .addText((text) => {
                text.setValue(this.model!.maxRetries?.toString() ?? "")
                    .setPlaceholder("e.g., 2")
                    .onChange((value) => {
                        const parsed = parseInt(value);
                        this.model!.maxRetries = isNaN(parsed) ? undefined : parsed;
                    });
                text.inputEl.type = "number";
            });

        new Setting(this.contentEl)
            .setName("Input Cost (per 1M tokens)")
            .setDesc("Cost per million input tokens, for tracking.")
            .addText((text) => {
                text.setValue(this.model!.inputCostPerMillion?.toString() ?? "")
                    .setPlaceholder("e.g., 0.25")
                    .onChange((value) => {
                        const parsed = parseFloat(value);
                        this.model!.inputCostPerMillion = isNaN(parsed) ? undefined : parsed;
                        this.model!.costOverridden = !isNaN(parsed);
                    });
                text.inputEl.type = "number";
                text.inputEl.step = "0.01";
            });

        new Setting(this.contentEl)
            .setName("Output Cost (per 1M tokens)")
            .setDesc("Cost per million output tokens, for tracking.")
            .addText((text) => {
                text.setValue(this.model!.outputCostPerMillion?.toString() ?? "")
                    .setPlaceholder("e.g., 1.25")
                    .onChange((value) => {
                        const parsed = parseFloat(value);
                        this.model!.outputCostPerMillion = isNaN(parsed) ? undefined : parsed;
                        this.model!.costOverridden = !isNaN(parsed);
                    });
                text.inputEl.type = "number";
                text.inputEl.step = "0.01";
            });

        // Provider-specific params
        const provider = this.providers.find(p => p.id === this.model!.providerId);
        if (provider) {
            const params = getParamsForProvider(provider.type);
            if (params.length) {
                new Setting(this.contentEl).setHeading().setName(`${provider.type} Settings`);

                for (const def of params) {
                    const currentVal = this.model!.providerParams?.[def.key] ?? def.default;

                    if (def.type === "select" && def.options) {
                        new Setting(this.contentEl)
                            .setName(def.label)
                            .setDesc(def.description)
                            .addDropdown((dropdown) => {
                                dropdown.addOption("", "(default)");
                                for (const opt of def.options!) {
                                    dropdown.addOption(opt, opt);
                                }
                                dropdown.setValue((currentVal as string) ?? "")
                                    .onChange((value) => {
                                        if (!this.model!.providerParams) this.model!.providerParams = {};
                                        this.model!.providerParams[def.key] = value || undefined;
                                    });
                            });
                    } else if (def.type === "boolean") {
                        new Setting(this.contentEl)
                            .setName(def.label)
                            .setDesc(def.description)
                            .addToggle((toggle) => {
                                toggle.setValue(!!currentVal)
                                    .onChange((value) => {
                                        if (!this.model!.providerParams) this.model!.providerParams = {};
                                        this.model!.providerParams[def.key] = value;
                                    });
                            });
                    } else if (def.type === "number") {
                        new Setting(this.contentEl)
                            .setName(def.label)
                            .setDesc(def.description)
                            .addText((text) => {
                                text.setValue(currentVal != null ? String(currentVal) : "")
                                    .onChange((value) => {
                                        if (!this.model!.providerParams) this.model!.providerParams = {};
                                        const parsed = parseFloat(value);
                                        this.model!.providerParams[def.key] = isNaN(parsed) ? undefined : parsed;
                                    });
                                text.inputEl.type = "number";
                            });
                    }
                }
            }
        }
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
