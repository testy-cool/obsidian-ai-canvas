import { App, PluginSettingTab, Setting, ButtonComponent, Notice, TextAreaComponent, TextComponent, ToggleComponent } from "obsidian";
import AugmentedCanvasPlugin from "./../AugmentedCanvasPlugin";
import { EditProviderModal } from "src/Modals/EditProviderModal";
import { ModelFetchModal } from "src/Modals/ModelFetchModal";
import { LLMModel, LLMProvider } from "./AugmentedCanvasSettings";

export default class SettingsTab extends PluginSettingTab {
    plugin: AugmentedCanvasPlugin;
    private modelFilters: Record<string, string> = {};
    private modelEnabledOnly: Record<string, boolean> = {};

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
        this.renderGenerationSettings(containerEl);
		this.renderImageSettings(containerEl);
		this.renderNamingSettings(containerEl);
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
                        dropdown.addOption(model.id, model.model);
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

        const cardsContainer = containerEl.createDiv("provider-list");
        this.plugin.settings.providers.forEach(provider => {
            const providerBlock = cardsContainer.createDiv("provider-block");

            const headerRow = providerBlock.createDiv("provider-header");
            const titleCol = headerRow.createDiv("provider-title");
            titleCol.createEl("div", { text: provider.type, cls: "provider-name" });

            const controls = headerRow.createDiv("provider-controls");
            const toggleWrap = controls.createDiv("provider-toggle");
            toggleWrap.createEl("span", { text: "Enabled" });
            const toggle = new ToggleComponent(toggleWrap);
            toggle.setValue(provider.enabled);
            toggle.onChange(async value => {
                provider.enabled = value;
                await this.plugin.saveSettings();
            });

            const editBtn = new ButtonComponent(controls);
            editBtn.setButtonText("Edit");
            editBtn.onClick(() => {
                new EditProviderModal(this.app, this.plugin, provider, async (updated) => {
                    const index = this.plugin.settings.providers.findIndex(p => p.id === provider.id);
                    if (index > -1) {
                        this.plugin.settings.providers[index] = updated;
                        await this.plugin.saveSettings();
                        this.display();
                    }
                }).open();
            });

            const isLastProvider = this.plugin.settings.providers.length === 1;
            const deleteBtn = new ButtonComponent(controls);
            deleteBtn.setButtonText("Delete");
            deleteBtn.setDisabled(isLastProvider);
            if (isLastProvider) {
                deleteBtn.setTooltip("Cannot delete the last provider");
            }
            deleteBtn.onClick(async () => {
                if (isLastProvider) {
                    new Notice("Cannot delete the last provider. Add another provider first.");
                    return;
                }

                if (this.plugin.settings.activeProvider === provider.id) {
                    const remainingProviders = this.plugin.settings.providers.filter(p => p.id !== provider.id);
                    if (remainingProviders.length > 0) {
                        this.plugin.settings.activeProvider = remainingProviders[0].id;
                        const modelsForNewProvider = this.plugin.settings.models.filter(
                            m => m.providerId === remainingProviders[0].id && m.enabled
                        );
                        if (modelsForNewProvider.length > 0) {
                            this.plugin.settings.apiModel = modelsForNewProvider[0].id;
                        }
                    }
                }

                this.plugin.settings.providers = this.plugin.settings.providers.filter(p => p.id !== provider.id);
                this.plugin.settings.models = this.plugin.settings.models.filter(m => m.providerId !== provider.id);

                await this.plugin.saveSettings();
                this.display();
            });

            const metaRow = providerBlock.createDiv("provider-meta");
            metaRow.createEl("span", { text: `ID: ${provider.id}` });
            if (this.isGeminiProvider(provider)) {
                metaRow.createEl("span", { text: "Endpoint: Google SDK (fixed)" });
            } else {
                metaRow.createEl("span", { text: `URL: ${provider.baseUrl}` });
            }
            const hasKey = provider.apiKey && provider.apiKey.trim().length > 0;
            metaRow.createEl("span", {
                text: hasKey ? "API key: set" : "API key: missing",
                cls: hasKey ? "" : "mod-warning",
            });

            this.renderProviderModels(provider, providerBlock);
        });
    }

    private renderProviderModels(provider: LLMProvider, container: HTMLElement) {
        const modelsWrapper = container.createDiv("provider-models");
        const getProviderModels = () =>
            this.plugin.settings.models.filter(m => m.providerId === provider.id);

        const header = modelsWrapper.createDiv("provider-models-header");
        const title = header.createDiv("provider-models-title");
        const titleText = title.createEl("span");
        title.createEl("span", { text: "Use Add Model to fetch and enable models.", cls: "provider-models-desc" });
        const actions = header.createDiv("provider-models-actions");

        const updateHeader = () => {
            const providerModels = getProviderModels();
            const enabledCount = providerModels.filter(m => m.enabled).length;
            titleText.setText(`Models (${enabledCount}/${providerModels.length})`);
        };

        const addBtn = new ButtonComponent(actions);
        addBtn.setButtonText("Add Model");
        addBtn.setCta();
        addBtn.onClick(() => {
            const providerModels = getProviderModels();
            const enabledIds = providerModels.filter(m => m.enabled).map(m => m.id);

            new ModelFetchModal(
                this.app,
                provider,
                enabledIds,
                async (selectedIds) => {
                    const existing = new Map(
                        getProviderModels().map(m => [m.id, m])
                    );
                    const additions: LLMModel[] = [];

                    selectedIds.forEach(modelId => {
                        const existingModel = existing.get(modelId);
                        if (existingModel) {
                            existingModel.enabled = true;
                        } else {
                            additions.push({
                                id: modelId,
                                providerId: provider.id,
                                model: modelId,
                                enabled: true,
                            });
                        }
                    });

                    if (additions.length) {
                        this.plugin.settings.models.push(...additions);
                    }

                    this.ensureActiveModelForProvider(this.plugin.settings.activeProvider);
                    await this.plugin.saveSettings();
                    updateHeader();
                    renderModelList();
                    new Notice(`Enabled ${selectedIds.length} model(s) for ${provider.type}.`);
                }
            ).open();
        });

        updateHeader();

        let filterText = this.modelFilters[provider.id] || "";
        let enabledOnly = this.modelEnabledOnly[provider.id] || false;

        const filterRow = modelsWrapper.createDiv("provider-models-filter");
        filterRow.createEl("span", { text: "Filter" });
        const filterInput = new TextComponent(filterRow);
        filterInput.setPlaceholder("Type to filter");
        filterInput.inputEl.type = "search";
        filterInput.setValue(filterText);
        filterInput.onChange(value => {
            filterText = value;
            this.modelFilters[provider.id] = value;
            renderModelList();
        });

        const enabledWrap = filterRow.createDiv("provider-models-toggle");
        const enabledToggle = new ToggleComponent(enabledWrap);
        enabledToggle.setValue(enabledOnly);
        enabledToggle.onChange(value => {
            enabledOnly = value;
            this.modelEnabledOnly[provider.id] = value;
            renderModelList();
        });
        enabledWrap.createEl("span", { text: "Enabled only" });

        const listContainer = modelsWrapper.createDiv("provider-model-list");
        const renderModelList = () => {
            listContainer.empty();
            const providerModels = getProviderModels();
            const normalizedFilter = filterText.toLowerCase();

            const filteredModels = providerModels
                .filter(model => !enabledOnly || model.enabled)
                .filter(model => {
                    if (!normalizedFilter) return true;
                    const label = `${model.model} ${model.id}`.toLowerCase();
                    return label.includes(normalizedFilter);
                })
                .sort((a, b) => a.model.localeCompare(b.model));

            if (!providerModels.length) {
                listContainer.createDiv({ text: "No models yet. Use Add Model to fetch and enable.", cls: "mod-muted" });
                return;
            }

            if (!filteredModels.length) {
                listContainer.createDiv({ text: "No models match the current filter.", cls: "mod-muted" });
                return;
            }

            filteredModels.forEach(model => {
                const row = listContainer.createDiv("provider-model-row");
                const checkbox = row.createEl("input", { type: "checkbox" });
                checkbox.checked = model.enabled;
                checkbox.addEventListener("change", async () => {
                    model.enabled = checkbox.checked;
                    this.ensureActiveModelForProvider(this.plugin.settings.activeProvider);
                    await this.plugin.saveSettings();
                    updateHeader();
                    renderModelList();
                });

                const label = model.model === model.id
                    ? model.model
                    : `${model.model} (${model.id})`;
                row.createEl("span", { text: label });
            });
        };

        renderModelList();

    }

    private isGeminiProvider(provider: LLMProvider) {
        const id = provider.id.trim().toLowerCase();
        const type = provider.type.trim().toLowerCase();
        return id === "gemini" || type === "gemini" || type === "google";
    }

    private ensureActiveModelForProvider(providerId?: string) {
        if (!providerId) return;

        const currentModelId = this.plugin.settings.apiModel;
        const enabledModels = this.plugin.settings.models.filter(
            model => model.providerId === providerId && model.enabled
        );

        if (!enabledModels.length) return;

        const activeModelStillEnabled = enabledModels.some(model => model.id === currentModelId);
        if (!activeModelStillEnabled) {
            this.plugin.settings.apiModel = enabledModels[0].id;
        }
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

	private renderImageSettings(containerEl: HTMLElement) {
		new Setting(containerEl).setHeading().setName("Image Generation");

		new Setting(containerEl)
			.setName("Image provider")
			.setDesc("Provider used for image generation.")
			.addDropdown(dropdown => {
				dropdown.addOption("", "Default (active provider)");
				this.plugin.settings.providers.forEach(provider => {
					dropdown.addOption(provider.id, provider.type);
				});
				dropdown
					.setValue(this.plugin.settings.imageProviderId || "")
					.onChange(async value => {
						this.plugin.settings.imageProviderId = value;
						const providerId = value || this.plugin.settings.activeProvider;
						const models = this.plugin.settings.models.filter(
							model => model.providerId === providerId && model.enabled
						);
						if (
							this.plugin.settings.imageModelId &&
							!models.some(model => model.id === this.plugin.settings.imageModelId)
						) {
							this.plugin.settings.imageModelId = models[0]?.id || "";
						}
						await this.plugin.saveSettings();
						this.display();
					});
			});

		const imageProviderId =
			this.plugin.settings.imageProviderId || this.plugin.settings.activeProvider;
		const imageModels = this.plugin.settings.models.filter(
			model => model.providerId === imageProviderId && model.enabled
		);
		const imageModelValue =
			imageModels.find(model => model.id === this.plugin.settings.imageModelId)
				?.id || "";
		if (imageModelValue !== this.plugin.settings.imageModelId) {
			this.plugin.settings.imageModelId = imageModelValue;
			void this.plugin.saveSettings();
		}

		new Setting(containerEl)
			.setName("Image model")
			.setDesc("Model used for image generation (e.g., Gemini NanoBanana).")
			.addDropdown(dropdown => {
				dropdown.addOption("", "Default (dall-e-3)");
				imageModels.forEach(model => {
					dropdown.addOption(model.id, model.model);
				});
				dropdown
					.setValue(imageModelValue)
					.onChange(async value => {
						this.plugin.settings.imageModelId = value;
						await this.plugin.saveSettings();
					});
			});
	}

	private renderNamingSettings(containerEl: HTMLElement) {
		new Setting(containerEl).setHeading().setName("Naming Settings");

		new Setting(containerEl)
			.setName("Enable AI card titles")
			.setDesc("Auto-generate titles for new AI cards over 200 characters, plus manual regeneration.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableCardTitleGeneration)
				.onChange(async value => {
					this.plugin.settings.enableCardTitleGeneration = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Card title provider")
			.setDesc("Provider used for AI card titles.")
			.addDropdown(dropdown => {
				this.plugin.settings.providers.forEach(provider => {
					dropdown.addOption(provider.id, provider.type);
				});
				dropdown
					.setValue(this.plugin.settings.cardTitleProviderId)
					.onChange(async value => {
						this.plugin.settings.cardTitleProviderId = value;
						const models = this.plugin.settings.models.filter(
							model => model.providerId === value && model.enabled
						);
						if (!models.some(model => model.id === this.plugin.settings.cardTitleModelId)) {
							this.plugin.settings.cardTitleModelId = models[0]?.id || "";
						}
						await this.plugin.saveSettings();
						this.display();
					});
			});

		const cardModels = this.plugin.settings.models.filter(
			model =>
				model.providerId === this.plugin.settings.cardTitleProviderId &&
				model.enabled
		);
		const cardModelValue =
			cardModels.find(model => model.id === this.plugin.settings.cardTitleModelId)
				?.id || cardModels[0]?.id || "";
		if (cardModelValue && cardModelValue !== this.plugin.settings.cardTitleModelId) {
			this.plugin.settings.cardTitleModelId = cardModelValue;
			void this.plugin.saveSettings();
		}

		new Setting(containerEl)
			.setName("Card title model")
			.setDesc("Model used for AI card titles.")
			.addDropdown(dropdown => {
				if (!cardModels.length) {
					dropdown.addOption("", "No enabled models");
					dropdown.setValue("");
					return;
				}
				cardModels.forEach(model => {
					dropdown.addOption(model.id, model.model);
				});
				dropdown
					.setValue(cardModelValue)
					.onChange(async value => {
						if (!value) return;
						this.plugin.settings.cardTitleModelId = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Card title prompt")
			.setDesc("System prompt used to generate card titles.")
			.addTextArea(text => {
				text.inputEl.rows = 4;
				text.setValue(this.plugin.settings.cardTitleSystemPrompt)
					.onChange(async value => {
						this.plugin.settings.cardTitleSystemPrompt = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Enable AI group names")
			.setDesc("Allow AI-generated names for groups on demand.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableGroupTitleGeneration)
				.onChange(async value => {
					this.plugin.settings.enableGroupTitleGeneration = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Group name provider")
			.setDesc("Provider used for AI group naming.")
			.addDropdown(dropdown => {
				this.plugin.settings.providers.forEach(provider => {
					dropdown.addOption(provider.id, provider.type);
				});
				dropdown
					.setValue(this.plugin.settings.groupTitleProviderId)
					.onChange(async value => {
						this.plugin.settings.groupTitleProviderId = value;
						const models = this.plugin.settings.models.filter(
							model => model.providerId === value && model.enabled
						);
						if (!models.some(model => model.id === this.plugin.settings.groupTitleModelId)) {
							this.plugin.settings.groupTitleModelId = models[0]?.id || "";
						}
						await this.plugin.saveSettings();
						this.display();
					});
			});

		const groupModels = this.plugin.settings.models.filter(
			model =>
				model.providerId === this.plugin.settings.groupTitleProviderId &&
				model.enabled
		);
		const groupModelValue =
			groupModels.find(model => model.id === this.plugin.settings.groupTitleModelId)
				?.id || groupModels[0]?.id || "";
		if (groupModelValue && groupModelValue !== this.plugin.settings.groupTitleModelId) {
			this.plugin.settings.groupTitleModelId = groupModelValue;
			void this.plugin.saveSettings();
		}

		new Setting(containerEl)
			.setName("Group name model")
			.setDesc("Model used for AI group naming.")
			.addDropdown(dropdown => {
				if (!groupModels.length) {
					dropdown.addOption("", "No enabled models");
					dropdown.setValue("");
					return;
				}
				groupModels.forEach(model => {
					dropdown.addOption(model.id, model.model);
				});
				dropdown
					.setValue(groupModelValue)
					.onChange(async value => {
						if (!value) return;
						this.plugin.settings.groupTitleModelId = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Group name prompt")
			.setDesc("System prompt used to generate group names.")
			.addTextArea(text => {
				text.inputEl.rows = 4;
				text.setValue(this.plugin.settings.groupTitleSystemPrompt)
					.onChange(async value => {
						this.plugin.settings.groupTitleSystemPrompt = value;
						await this.plugin.saveSettings();
					});
			});
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


