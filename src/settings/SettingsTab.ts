import { App, PluginSettingTab, Setting, ButtonComponent, Notice, TextAreaComponent } from "obsidian";
import AugmentedCanvasPlugin from "./../AugmentedCanvasPlugin";
import { DEFAULT_SETTINGS } from "./AugmentedCanvasSettings";
import { EditProviderModal } from "src/Modals/EditProviderModal";
import { EditModelModal } from "src/Modals/EditModelModal";
import "../styles/settings.css";

export default class SettingsTab extends PluginSettingTab {
    plugin: AugmentedCanvasPlugin;

    constructor(app: App, plugin: AugmentedCanvasPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass("augmented-canvas-settings");

        this.renderGeneralSettings(containerEl);
        this.renderProviders(containerEl);
        this.renderModels(containerEl);
        this.renderGenerationSettings(containerEl);
        this.renderPromptManagement(containerEl);
    }

    private renderGeneralSettings(containerEl: HTMLElement) {
        new Setting(containerEl).setHeading().setName("General Settings");

        new Setting(containerEl)
            .setName("Default Provider")
            .setDesc("Select the default AI provider for all actions.")
            .addDropdown((dropdown) => {
                this.plugin.settings.providers.forEach((provider) => {
                    dropdown.addOption(provider.id, provider.type);
                });
                dropdown
                    .setValue(this.plugin.settings.activeProvider)
                    .onChange(async (value) => {
                        this.plugin.settings.activeProvider = value;
                        await this.plugin.saveSettings();
                        this.display();
                    });
            });

        const availableModels = this.plugin.settings.models.filter(
            (model) =>
                model.providerId === this.plugin.settings.activeProvider && model.enabled
        );

        new Setting(containerEl)
            .setName("Default Model")
            .setDesc("The default model to use for API calls.")
            .addDropdown((dropdown) => {
                availableModels
                    .forEach((model) => {
                        dropdown.addOption(model.id, model.id);
                    });
                dropdown
                    .setValue(this.plugin.settings.apiModel)
                    .onChange(async (value) => {
                        this.plugin.settings.apiModel = value;
                        await this.plugin.saveSettings();
                    });
            });
    }

    private renderProviders(containerEl: HTMLElement) {
        const header = new Setting(containerEl).setHeading().setName("Providers");
        header.addButton(button => button
            .setButtonText("Add New Provider")
            .setCta()
            .onClick(() => {
                new EditProviderModal(this.app, this.plugin, null, async (newProvider) => {
                    if (this.plugin.settings.providers.some(p => p.id === newProvider.id)) {
                        new Notice("A provider with this ID already exists");
                        return;
                    }
                    this.plugin.settings.providers.push(newProvider);
                    await this.plugin.saveSettings();
                    this.display();
                }).open();
            }));

        const cardsContainer = containerEl.createDiv("cards-container");
        this.plugin.settings.providers.forEach(provider => {
            const card = new Setting(cardsContainer).setClass("setting-card");
            card.setName(provider.type);
            card.setDesc(`ID: ${provider.id} | URL: ${provider.baseUrl}`);
            
            card.addToggle(toggle => toggle
                .setValue(provider.enabled)
                .onChange(async value => {
                    provider.enabled = value;
                    await this.plugin.saveSettings();
                })
            );

            card.addButton(button => button
                .setIcon("pencil")
                .setTooltip("Edit")
                .onClick(() => {
                    new EditProviderModal(this.app, this.plugin, provider, async (updated) => {
                        const index = this.plugin.settings.providers.findIndex(p => p.id === provider.id);
                        if (index > -1) {
                            this.plugin.settings.providers[index] = updated;
                            await this.plugin.saveSettings();
                            this.display();
                        }
                    }).open();
                })
            );

            // Allow deletion of all providers, but prevent deletion of the last provider
            const isLastProvider = this.plugin.settings.providers.length === 1;
            card.addButton(button => button
                .setIcon("trash")
                .setTooltip(isLastProvider ? "Cannot delete the last provider" : "Delete")
                .setDisabled(isLastProvider)
                .onClick(async () => {
                    if (isLastProvider) {
                        new Notice("Cannot delete the last provider. Add another provider first.");
                        return;
                    }
                    
                    // If we're deleting the active provider, switch to another one
                    if (this.plugin.settings.activeProvider === provider.id) {
                        const remainingProviders = this.plugin.settings.providers.filter(p => p.id !== provider.id);
                        if (remainingProviders.length > 0) {
                            this.plugin.settings.activeProvider = remainingProviders[0].id;
                            // Also update the default model to one from the new provider
                            const modelsForNewProvider = this.plugin.settings.models.filter(m => m.providerId === remainingProviders[0].id && m.enabled);
                            if (modelsForNewProvider.length > 0) {
                                this.plugin.settings.apiModel = modelsForNewProvider[0].id;
                            }
                        }
                    }
                    
                    // Remove the provider
                    this.plugin.settings.providers = this.plugin.settings.providers.filter(p => p.id !== provider.id);
                    
                    // Remove associated models
                    this.plugin.settings.models = this.plugin.settings.models.filter(m => m.providerId !== provider.id);
                    
                    await this.plugin.saveSettings();
                    this.display();
                })
            );
        });
    }

    private renderModels(containerEl: HTMLElement) {
        const header = new Setting(containerEl).setHeading().setName("Models");
        header.addButton(button => button
            .setButtonText("Add New Model")
            .setCta()
            .onClick(() => {
                new EditModelModal(this.app, this.plugin, null, this.plugin.settings.providers, async (newModel) => {
                    if (this.plugin.settings.models.some(m => m.id === newModel.id)) {
                        new Notice("A model with this ID already exists");
                        return;
                    }
                    this.plugin.settings.models.push(newModel);
                    await this.plugin.saveSettings();
                    this.display();
                }).open();
            }));

        const cardsContainer = containerEl.createDiv("cards-container");
        this.plugin.settings.models.forEach(model => {
            const card = new Setting(cardsContainer).setClass("setting-card");
            card.setName(model.id);
            card.setDesc(`Provider: ${model.providerId}`);

            card.addToggle(toggle => toggle
                .setValue(model.enabled)
                .onChange(async value => {
                    model.enabled = value;
                    await this.plugin.saveSettings();
                })
            );

            card.addButton(button => button
                .setIcon("pencil")
                .setTooltip("Edit")
                .onClick(() => {
                    new EditModelModal(this.app, this.plugin, model, this.plugin.settings.providers, async (updated) => {
                        const index = this.plugin.settings.models.findIndex(m => m.id === model.id);
                        if (index > -1) {
                            this.plugin.settings.models[index] = updated;
                            await this.plugin.saveSettings();
                            this.display();
                        }
                    }).open();
                })
            );

            // Allow deletion of all models, but prevent deletion of the last model
            const isLastModel = this.plugin.settings.models.length === 1;
            card.addButton(button => button
                .setIcon("trash")
                .setTooltip(isLastModel ? "Cannot delete the last model" : "Delete")
                .setDisabled(isLastModel)
                .onClick(async () => {
                    if (isLastModel) {
                        new Notice("Cannot delete the last model. Add another model first.");
                        return;
                    }
                    
                    // If we're deleting the currently selected model, switch to another one
                    if (this.plugin.settings.apiModel === model.id) {
                        const remainingModels = this.plugin.settings.models.filter(m => m.id !== model.id && m.enabled);
                        if (remainingModels.length > 0) {
                            this.plugin.settings.apiModel = remainingModels[0].id;
                        } else {
                            // Fallback to any remaining model (even if disabled)
                            const anyRemainingModel = this.plugin.settings.models.filter(m => m.id !== model.id)[0];
                            if (anyRemainingModel) {
                                this.plugin.settings.apiModel = anyRemainingModel.id;
                            }
                        }
                    }
                    
                    // Remove the model
                    this.plugin.settings.models = this.plugin.settings.models.filter(m => m.id !== model.id);
                    
                    await this.plugin.saveSettings();
                    this.display();
                })
            );
        });
    }

    private renderGenerationSettings(containerEl: HTMLElement) {
        new Setting(containerEl).setHeading().setName("Generation Settings");

        new Setting(containerEl)
            .setName("Temperature")
            .setDesc("Controls the randomness of the AI's responses. Higher values are more creative.")
            .addSlider(slider => slider
                .setLimits(0, 2, 0.1)
                .setValue(this.plugin.settings.temperature)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.temperature = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Max Response Tokens")
            .setDesc("The maximum number of tokens to generate. (0 for unlimited)")
            .addText(text => text
                .setValue(this.plugin.settings.maxResponseTokens.toString())
                .onChange(async (value) => {
                    const parsed = parseInt(value);
                    if (!isNaN(parsed)) {
                        this.plugin.settings.maxResponseTokens = parsed;
                        await this.plugin.saveSettings();
                    }
                }));
    }

    private renderPromptManagement(containerEl: HTMLElement) {
        new Setting(containerEl).setHeading().setName("Prompt Management");

        new Setting(containerEl)
            .setName("Default System Prompt")
            .addTextArea(text => {
                text.inputEl.rows = 6;
                text.setValue(this.plugin.settings.systemPrompt)
                    .onChange(async (value) => {
                        this.plugin.settings.systemPrompt = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Flashcards System Prompt")
            .addTextArea(text => {
                text.inputEl.rows = 6;
                text.setValue(this.plugin.settings.flashcardsSystemPrompt)
                    .onChange(async (value) => {
                        this.plugin.settings.flashcardsSystemPrompt = value;
                        await this.plugin.saveSettings();
                    });
            });
    }
}


