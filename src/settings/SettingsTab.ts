import { App, PluginSettingTab, Setting, ButtonComponent, Notice, TextAreaComponent, TextComponent, ToggleComponent, Modal, requestUrl, setIcon, debounce } from "obsidian";
import AugmentedCanvasPlugin from "./../AugmentedCanvasPlugin";
import { UnifiedProviderModal } from "src/Modals/UnifiedProviderModal";
import { LLMModel, LLMProvider, MCPServer, MCPTransportType } from "./AugmentedCanvasSettings";
import { testMCPServer } from "src/utils/mcpClient";
import { getParamsForModel, detectProviderLabel } from "src/utils/providerParams";
import { getProviderCapabilities, providerCapabilityKeys, type ProviderCapability, type ProviderCapabilityReport } from "src/utils/providerCapabilities";
import { probeProviderCapabilities } from "src/utils/capabilityProbe";

interface SettingsSection {
    id: string;
    label: string;
    icon: string;
    render: (containerEl: HTMLElement) => void;
}

/**
 * Hide everything in a rendered section that does not match the query.
 * Headings stay put so a surviving section keeps its title. Returns whether
 * anything survived, so the caller can drop empty sections entirely.
 */
const filterSection = (sectionEl: HTMLElement, query: string): boolean => {
    let matches = 0;
    for (const child of Array.from(sectionEl.children)) {
        const el = child as HTMLElement;
        if (el.classList.contains("setting-item-heading")) continue;
        const hit = (el.textContent || "").toLowerCase().includes(query);
        el.style.display = hit ? "" : "none";
        if (hit) matches++;
    }
    return matches > 0;
};

export default class SettingsTab extends PluginSettingTab {
	private capabilityTests = new Set<string>();
	private capabilityProgress = new Map<string, ProviderCapabilityReport>();
	private capabilityViews = new Map<string, () => void>();
    plugin: AugmentedCanvasPlugin;
    private modelFilters: Record<string, string> = {};
    private modelEnabledOnly: Record<string, boolean> = {};
    private activeSectionId = "general";
    private searchQuery = "";

    constructor(app: App, plugin: AugmentedCanvasPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private get sections(): SettingsSection[] {
        return [
            { id: "general", label: "General", icon: "lucide-sliders-horizontal", render: el => this.renderGeneralSettings(el) },
            { id: "providers", label: "Providers", icon: "lucide-plug", render: el => this.renderProviders(el) },
            { id: "mcp", label: "MCP servers", icon: "lucide-server", render: el => this.renderMCPServers(el) },
            { id: "generation", label: "Generation", icon: "lucide-message-square", render: el => this.renderGenerationSettings(el) },
            { id: "image", label: "Images", icon: "lucide-image", render: el => this.renderImageSettings(el) },
            { id: "naming", label: "Naming", icon: "lucide-type", render: el => this.renderNamingSettings(el) },
            { id: "prompts", label: "Prompts", icon: "lucide-book-open", render: el => this.renderPromptManagement(el) },
            { id: "observability", label: "Observability", icon: "lucide-activity", render: el => this.renderObservability(el) },
        ];
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass("augmented-canvas-settings");

        const sections = this.sections;
        if (!sections.some(section => section.id === this.activeSectionId)) {
            this.activeSectionId = sections[0].id;
        }

        const header = containerEl.createDiv("ac-settings-header");
        header.createSpan({ cls: "ac-settings-title", text: "AI Canvas" });
        header.createSpan({
            cls: "ac-settings-version",
            text: `v${this.plugin.manifest.version}`,
        });

        const search = new TextComponent(header.createDiv("ac-settings-search"));
        search.setPlaceholder("Search all settings…");
        search.setValue(this.searchQuery);

        const nav = containerEl.createDiv("ac-settings-nav");
        const content = containerEl.createDiv("ac-settings-content");
        const navButtons = new Map<string, HTMLElement>();

        const renderContent = () => {
            content.empty();
			content.scrollTop = 0;
            const query = this.searchQuery.trim().toLowerCase();

            navButtons.forEach((button, id) =>
                button.classList.toggle(
                    "is-active",
                    !query && id === this.activeSectionId
                )
            );

            if (!query) {
                sections
                    .find(section => section.id === this.activeSectionId)!
                    .render(content);
                return;
            }

            // Searching cuts across every section, so the nav selection is
            // irrelevant until the query is cleared.
            for (const section of sections) {
                const sectionEl = content.createDiv("ac-settings-section");
                section.render(sectionEl);
                if (!filterSection(sectionEl, query)) sectionEl.remove();
            }

            if (!content.firstChild) {
                content.createDiv({
                    cls: "ac-settings-empty",
                    text: `No settings match “${this.searchQuery.trim()}”.`,
                });
            }
        };

        for (const section of sections) {
            const button = nav.createEl("button", { cls: "ac-settings-nav-item" });
            setIcon(button.createSpan("ac-settings-nav-icon"), section.icon);
            button.createSpan({ cls: "ac-settings-nav-label", text: section.label });
            button.addEventListener("click", () => {
                this.activeSectionId = section.id;
                this.searchQuery = "";
                search.setValue("");
                renderContent();
            });
            navButtons.set(section.id, button);
        }

        // A query renders every section, so keep keystrokes from rebuilding the
        // whole tab eight times over.
        const onQueryChange = debounce(
            (value: string) => {
                this.searchQuery = value;
                renderContent();
            },
            150,
            true
        );
        search.onChange(onQueryChange);

        renderContent();
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
                        this.display();
                    });
            });

        // Provider-specific params for active model
        const activeProvider = this.plugin.settings.providers.find(
            p => p.id === this.plugin.settings.activeProvider
        );
        const activeModel = availableModels.find(
            m => m.id === this.plugin.settings.apiModel
        ) ?? availableModels.find(
            m => m.model === this.plugin.settings.apiModel
        );

        const paramsProvider = this.plugin.settings.providers.find(
            p => p.id === activeModel?.providerId
        ) ?? activeProvider;

        if (paramsProvider && activeModel) {
            const params = getParamsForModel(activeModel.model, paramsProvider.type);
            if (params.length) {
                const label = detectProviderLabel(activeModel.model, paramsProvider.type);
                new Setting(containerEl).setHeading().setName(`${label} Settings`);

                for (const def of params) {
                    const currentVal = activeModel.providerParams?.[def.key] ?? def.default;

                    if (def.type === "select" && def.options) {
                        new Setting(containerEl)
                            .setName(def.label)
                            .setDesc(def.description)
                            .addDropdown((dropdown) => {
                                dropdown.addOption("", "(default)");
                                for (const opt of def.options!) {
                                    dropdown.addOption(opt, opt);
                                }
                                dropdown.setValue((currentVal as string) ?? "")
                                    .onChange(async (value) => {
                                        if (!activeModel.providerParams) activeModel.providerParams = {};
                                        activeModel.providerParams[def.key] = value || undefined;
                                        await this.plugin.saveSettings();
                                    });
                            });
                    } else if (def.type === "boolean") {
                        new Setting(containerEl)
                            .setName(def.label)
                            .setDesc(def.description)
                            .addToggle((toggle) => {
                                toggle.setValue(!!currentVal)
                                    .onChange(async (value) => {
                                        if (!activeModel.providerParams) activeModel.providerParams = {};
                                        activeModel.providerParams[def.key] = value;
                                        await this.plugin.saveSettings();
                                    });
                            });
                    } else if (def.type === "number") {
                        new Setting(containerEl)
                            .setName(def.label)
                            .setDesc(def.description)
                            .addText((text) => {
                                text.setValue(currentVal != null ? String(currentVal) : "")
                                    .onChange(async (value) => {
                                        if (!activeModel.providerParams) activeModel.providerParams = {};
                                        const parsed = parseFloat(value);
                                        activeModel.providerParams[def.key] = isNaN(parsed) ? undefined : parsed;
                                        await this.plugin.saveSettings();
                                    });
                                text.inputEl.type = "number";
                            });
                    }
                }
            }
        }
    }

    private renderProviders(containerEl: HTMLElement) {
        const header = new Setting(containerEl).setHeading().setName("Providers");
        header.addButton(button => button
            .setButtonText("Add New Provider")
            .setCta()
            .onClick(() => {
                new UnifiedProviderModal(
                    this.app,
                    async (provider, models) => {
                        if (this.plugin.settings.providers.some(p => p.id === provider.id)) {
                            new Notice("A provider with this ID already exists");
                            return;
                        }
                        this.plugin.settings.providers.push(provider);
                        this.plugin.settings.models.push(...models);
                        if (this.plugin.settings.providers.filter(p => p.enabled).length === 1) {
                            this.plugin.settings.activeProvider = provider.id;
                            if (models.length > 0) {
                                this.plugin.settings.apiModel = models[0].id;
                            }
                        }
                        await this.plugin.saveSettings();
                        this.display();
                    }
                ).open();
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
                new UnifiedProviderModal(
                    this.app,
                    async (updated, models) => {
                        const index = this.plugin.settings.providers.findIndex(p => p.id === provider.id);
                        if (index > -1) {
                            this.plugin.settings.providers[index] = updated;
                        }
                        this.plugin.settings.models = this.plugin.settings.models.filter(
                            m => m.providerId !== provider.id
                        );
                        this.plugin.settings.models.push(...models);
                        this.ensureActiveModelForProvider(this.plugin.settings.activeProvider);
                        await this.plugin.saveSettings();
                        this.display();
                    },
                    provider,
                    this.plugin.settings.models.filter(m => m.providerId === provider.id)
                ).open();
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

				const providerIndex = this.plugin.settings.providers.indexOf(provider);
				const removedModels = this.plugin.settings.models
					.map((model, index) => ({ model, index }))
					.filter(({ model }) => model.providerId === provider.id);
				const previousActiveProvider = this.plugin.settings.activeProvider;
				const previousApiModel = this.plugin.settings.apiModel;

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
				this.showUndoNotice(`Deleted ${provider.type}.`, () => {
					this.plugin.settings.providers.splice(providerIndex, 0, provider);
					for (const { model, index } of removedModels) {
						this.plugin.settings.models.splice(index, 0, model);
					}
					this.plugin.settings.activeProvider = previousActiveProvider;
					this.plugin.settings.apiModel = previousApiModel;
				});
            });

            const metaRow = providerBlock.createDiv("provider-meta");
            metaRow.createEl("span", { text: `ID: ${provider.id}` });
            if (this.isVertexProvider(provider)) {
                metaRow.createEl("span", { text: `Project: ${provider.projectId || "(not set)"}` });
                metaRow.createEl("span", { text: `Location: ${provider.location || "us-central1"}` });
                const hasCredentials = provider.serviceAccountJson && provider.serviceAccountJson.trim().length > 0;
                metaRow.createEl("span", {
                    text: hasCredentials ? "Credentials: set" : "Credentials: missing",
                    cls: hasCredentials ? "" : "mod-warning",
                });
            } else if (this.isGeminiProvider(provider)) {
                metaRow.createEl("span", { text: "Endpoint: Google SDK (fixed)" });
                const hasKey = provider.apiKey && provider.apiKey.trim().length > 0;
                metaRow.createEl("span", {
                    text: hasKey ? "API key: set" : "API key: missing",
                    cls: hasKey ? "" : "mod-warning",
                });
            } else {
                metaRow.createEl("span", { text: `URL: ${provider.baseUrl}` });
                const hasKey = provider.apiKey && provider.apiKey.trim().length > 0;
                metaRow.createEl("span", {
                    text: hasKey ? "API key: set" : "API key: missing",
                    cls: hasKey ? "" : "mod-warning",
                });
            }

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
            new UnifiedProviderModal(
                this.app,
                async (updated, models) => {
                    const index = this.plugin.settings.providers.findIndex(p => p.id === provider.id);
                    if (index > -1) {
                        this.plugin.settings.providers[index] = updated;
                    }
                    this.plugin.settings.models = this.plugin.settings.models.filter(
                        m => m.providerId !== provider.id
                    );
                    this.plugin.settings.models.push(...models);
                    this.ensureActiveModelForProvider(this.plugin.settings.activeProvider);
                    await this.plugin.saveSettings();
                    updateHeader();
                    renderModelList();
                    new Notice(`Updated models for ${provider.type}.`);
                },
                provider,
                this.plugin.settings.models.filter(m => m.providerId === provider.id)
            ).open();
        });

		const reportEl = modelsWrapper.createDiv("provider-capability-report");
		const chips = reportEl.createDiv("provider-meta");
		const chipElements = new Map<ProviderCapability, HTMLButtonElement>();
		const testedLine = reportEl.createDiv({ cls: "provider-models-desc provider-capability-tested", text: "Not tested yet" });
		const noteLine = reportEl.createDiv("provider-capability-note");
		noteLine.setAttribute("aria-live", "polite");
		let selectedCapability: ProviderCapability | undefined;
		for (const capability of providerCapabilityKeys) {
			const chip = chips.createEl("button", { cls: "provider-capability-chip" });
			chip.type = "button";
			chip.addEventListener("click", () => {
				selectedCapability = selectedCapability === capability ? undefined : capability;
				renderReport();
			});
			chipElements.set(capability, chip);
		}
		const renderReport = () => {
			const current = this.plugin.settings.providers.find(item => item.id === provider.id);
			const report = this.capabilityProgress.get(provider.id) ?? current?.capabilityReport;
			for (const [capability, chip] of chipElements) {
				const verdict = report?.[capability] ?? "untested";
				const symbol = verdict === "yes" ? "✓" : verdict === "no" ? "✗" : "?";
				chip.setText(`${capability === "urlContext" ? "url" : capability} ${symbol}`);
				chip.setAttribute("title", report?.notes?.[capability] ?? "Not tested.");
				chip.setAttribute("aria-expanded", String(selectedCapability === capability));
			}
			testedLine.setText(report?.testedAt
				? `Tested ${new Date(report.testedAt).toLocaleString()} with ${report.model ?? "unknown model"}`
				: "Not tested yet");
			noteLine.setText(selectedCapability ? report?.notes?.[selectedCapability] ?? "Not tested." : "");
		};
		renderReport();
		const testBtn = new ButtonComponent(actions);
		testBtn.buttonEl.addClass("provider-capability-test-button");
		const updateTestButton = () => testBtn
			.setButtonText(this.capabilityTests.has(provider.id) ? "Testing…" : "Test capabilities")
			.setDisabled(this.capabilityTests.has(provider.id));
		updateTestButton();
		this.capabilityViews.set(provider.id, () => { renderReport(); updateTestButton(); });
		testBtn.onClick(async () => {
			if (this.capabilityTests.has(provider.id)) return;
			const model = getProviderModels().find(item => item.enabled);
			if (!model) {
				new Notice(`Enable a model for ${provider.type} before testing capabilities.`);
				return;
			}
			const current = this.plugin.settings.providers.find(item => item.id === provider.id);
			if (!current) return;
			this.capabilityTests.add(provider.id);
			updateTestButton();
			try {
				const report = await probeProviderCapabilities(current, model.model, this.plugin.settings, progress => {
					this.capabilityProgress.set(provider.id, progress);
					renderReport();
					this.capabilityViews.get(provider.id)?.();
				});
				const saved = this.plugin.settings.providers.find(item => item.id === provider.id);
				if (saved) {
					saved.capabilityReport = report;
					await this.plugin.saveSettings();
				}
			} catch (error) {
				new Notice(`Capability test failed: ${error instanceof Error ? error.message : String(error)}`);
			} finally {
				this.capabilityTests.delete(provider.id);
				this.capabilityProgress.delete(provider.id);
				renderReport();
				updateTestButton();
				this.capabilityViews.get(provider.id)?.();
			}
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

    private renderMCPServers(containerEl: HTMLElement) {
        const header = new Setting(containerEl).setHeading().setName("MCP Servers");
		header.settingEl.addClass("mcp-section-header");
        header.setDesc("Connect to Model Context Protocol servers to add tools for the AI.");

        header.addToggle(toggle => toggle
            .setValue(this.plugin.settings.mcpEnabled)
            .setTooltip("Enable MCP tools globally")
            .onChange(async value => {
                this.plugin.settings.mcpEnabled = value;
                await this.plugin.saveSettings();
            }));

		const actions = new Setting(containerEl);
		actions.settingEl.addClass("mcp-server-actions");
		actions.infoEl.remove();

		actions.addButton(button => button
            .setButtonText("Add Server")
            .setCta()
            .onClick(() => {
                this.openMCPServerModal(null, async (server) => {
                    if (this.plugin.settings.mcpServers.some(s => s.id === server.id)) {
                        new Notice("A server with this ID already exists");
                        return;
                    }
                    this.plugin.settings.mcpServers.push(server);
                    await this.plugin.saveSettings();
                    this.display();
                });
            }));

		actions.addButton(button => button
            .setButtonText("Import JSON")
            .onClick(() => {
                const modal = new MCPImportModal(this.app, async (servers) => {
                    let added = 0;
                    for (const server of servers) {
                        if (!this.plugin.settings.mcpServers.some(s => s.id === server.id)) {
                            this.plugin.settings.mcpServers.push(server);
                            added++;
                        }
                    }
                    await this.plugin.saveSettings();
                    new Notice(`Imported ${added} server(s)`);
                    this.display();
                });
                modal.open();
            }));

		actions.addButton(button => button
            .setButtonText("Export JSON")
            .onClick(() => {
                // Convert to standard mcpServers format
                const mcpServers: Record<string, any> = {};
                for (const server of this.plugin.settings.mcpServers) {
                    const config: any = {
                        type: server.transport,
                        url: server.url,
                    };
                    if (server.apiKey) {
                        config.headers = { Authorization: `Bearer ${server.apiKey}` };
                    }
                    if (server.headers) {
                        config.headers = { ...config.headers, ...server.headers };
                    }
                    mcpServers[server.id] = config;
                }
                const json = JSON.stringify({ mcpServers }, null, 2);
                navigator.clipboard.writeText(json);
                new Notice("MCP servers copied to clipboard");
            }));

        // MCP Settings
        const settingsRow = containerEl.createDiv("mcp-settings-row");

		this.addIntegerInput(
			new Setting(settingsRow).setName("Max agent steps")
				.setDesc("Maximum tool call iterations before stopping."),
			this.plugin.settings.mcpMaxSteps,
			"Enter an integer from 1 to 20.",
			value => value >= 1 && value <= 20,
			async value => {
				this.plugin.settings.mcpMaxSteps = value;
				await this.plugin.saveSettings();
			}
		);

        // Server list
        const serversContainer = containerEl.createDiv("mcp-server-list");

        if (!this.plugin.settings.mcpServers.length) {
            serversContainer.createDiv({
                text: "No MCP servers configured. Add a server to enable AI tools.",
                cls: "mod-muted"
            });
            return;
        }

        this.plugin.settings.mcpServers.forEach(server => {
            const serverBlock = serversContainer.createDiv("mcp-server-block");

            const headerRow = serverBlock.createDiv("mcp-server-header");
            const titleCol = headerRow.createDiv("mcp-server-title");
            titleCol.createEl("div", { text: server.name, cls: "mcp-server-name" });

            const controls = headerRow.createDiv("mcp-server-controls");

            const toggleWrap = controls.createDiv("mcp-server-toggle");
            toggleWrap.createEl("span", { text: "Enabled" });
            const toggle = new ToggleComponent(toggleWrap);
            toggle.setValue(server.enabled);
            toggle.onChange(async value => {
                server.enabled = value;
                await this.plugin.saveSettings();
            });

            const testBtn = new ButtonComponent(controls);
			testBtn.buttonEl.addClass("mcp-test-button");
            testBtn.setButtonText("Test");
            testBtn.onClick(async () => {
                testBtn.setButtonText("Testing…");
                testBtn.setDisabled(true);
                const result = await testMCPServer(server);
                if (result.success) {
                    server.toolCount = result.toolCount;
                    await this.plugin.saveSettings();
                    new Notice(`Connected! Found ${result.toolCount} tools.`);
                    this.display();
                } else {
                    new Notice(`Failed: ${result.error}`, 5000);
                }
                testBtn.setButtonText("Test");
                testBtn.setDisabled(false);
            });

            const editBtn = new ButtonComponent(controls);
            editBtn.setButtonText("Edit");
            editBtn.onClick(() => {
                this.openMCPServerModal(server, async (updated) => {
                    const index = this.plugin.settings.mcpServers.findIndex(s => s.id === server.id);
                    if (index > -1) {
                        this.plugin.settings.mcpServers[index] = updated;
                        await this.plugin.saveSettings();
                        this.display();
                    }
                });
            });

            const deleteBtn = new ButtonComponent(controls);
            deleteBtn.setButtonText("Delete");
            deleteBtn.onClick(async () => {
				const serverIndex = this.plugin.settings.mcpServers.indexOf(server);
                this.plugin.settings.mcpServers = this.plugin.settings.mcpServers.filter(s => s.id !== server.id);
                await this.plugin.saveSettings();
                this.display();
				this.showUndoNotice(`Deleted ${server.name}.`, () => {
					this.plugin.settings.mcpServers.splice(serverIndex, 0, server);
				});
            });

            const metaRow = serverBlock.createDiv("mcp-server-meta");
            metaRow.createEl("span", { text: `ID: ${server.id}` });
            metaRow.createEl("span", { text: `Transport: ${server.transport.toUpperCase()}` });
            metaRow.createEl("span", { text: `URL: ${server.url}` });
            const hasKey = server.apiKey && server.apiKey.trim().length > 0;
            metaRow.createEl("span", { text: hasKey ? "Auth: set" : "Auth: none" });
            if (server.toolCount !== undefined) {
                metaRow.createEl("span", { text: `Tools: ${server.toolCount}`, cls: "mcp-tool-count" });
            }
        });
    }

	private showUndoNotice(message: string, undo: () => void) {
		const notice = new Notice(message, 8000);
		const button = new ButtonComponent(notice.noticeEl).setButtonText("Undo");
		button.buttonEl.style.fontSize = "max(12px, var(--font-ui-small))";
		let undone = false;
		button.onClick(async () => {
			if (undone) return;
			undone = true;
			button.setDisabled(true);
			undo();
			notice.hide();
			await this.plugin.saveSettings();
			this.display();
		});
	}

    private openMCPServerModal(server: MCPServer | null, onSave: (server: MCPServer) => void) {
        const modal = new MCPServerModal(this.app, server, onSave);
        modal.open();
    }

    private isGeminiProvider(provider: LLMProvider) {
        const id = provider.id.trim().toLowerCase();
        const type = provider.type.trim().toLowerCase();
        return id === "gemini" || type === "gemini" || type === "google";
    }

    private isVertexProvider(provider: LLMProvider) {
        const id = provider.id.trim().toLowerCase();
        const type = provider.type.trim().toLowerCase();
        return id === "vertex" || type === "vertex";
    }

    private isAzureProvider(provider: LLMProvider) {
        const id = provider.id.trim().toLowerCase();
        const type = provider.type.trim().toLowerCase();
        return id === "azure" || type === "azure";
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
		const activeProvider = this.plugin.settings.providers.find(provider => provider.id === this.plugin.settings.activeProvider);
		if (activeProvider && !getProviderCapabilities(activeProvider).search) {
			containerEl.createDiv({
				cls: "provider-capability-note",
				text: `The active provider (${activeProvider.type}) cannot do search grounding. Use a Gemini provider or Bifrost with the Gemini-native API.`,
			});
		}

		new Setting(containerEl)
			.setName("Always ask which cards to include")
			.setDesc("Open the context picker before every request when a card has more than one connected card.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.alwaysAskPromptContext)
				.onChange(async (value) => {
					this.plugin.settings.alwaysAskPromptContext = value;
					await this.plugin.saveSettings();
				}));

        new Setting(containerEl)
            .setName("Render HTML previews by default")
            .setDesc("Open fenced HTML cards in Render mode instead of showing their code.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoPreviewHtml)
                .onChange(async (value) => {
                    this.plugin.settings.autoPreviewHtml = value;
                    await this.plugin.saveSettings();
                }));

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

		this.addIntegerInput(
			new Setting(containerEl).setName("Max Response Tokens")
				.setDesc("The maximum number of tokens to generate. (0 for unlimited)"),
			this.plugin.settings.maxResponseTokens,
			"Enter any integer; 0 means unlimited.",
			() => true,
			async value => {
				this.plugin.settings.maxResponseTokens = value;
				await this.plugin.saveSettings();
			}
		);
    }

	private addIntegerInput(
		setting: Setting,
		value: number,
		hint: string,
		inRange: (value: number) => boolean,
		onChange: (value: number) => Promise<void>
	) {
		const field = setting.controlEl.createDiv("ac-settings-field");
		const text = new TextComponent(field).setValue(String(value));
		field.createDiv({ cls: "ac-setting-hint", text: hint });
		const error = field.createDiv("ac-setting-error");
		error.setAttribute("aria-live", "polite");
		text.onChange(async input => {
			const parsed = Number(input);
			const valid = /^[+-]?\d+$/.test(input.trim()) && Number.isInteger(parsed) && inRange(parsed);
			text.inputEl.classList.toggle("mod-warning", !valid);
			text.inputEl.setAttribute("aria-invalid", String(!valid));
			error.setText(valid ? "" : hint);
			if (valid) await onChange(parsed);
		});
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

		const imageProvider = this.plugin.settings.providers.find(
			provider => provider.id === imageProviderId
		);
		if (imageProvider && this.isAzureProvider(imageProvider)) {
			new Setting(containerEl)
				.setName("Quality")
				.setDesc("Azure gpt-image-2 quality: low ~15s, medium ~40s, high ~2min")
				.addDropdown(dropdown => {
					dropdown.addOption("low", "Low");
					dropdown.addOption("medium", "Medium");
					dropdown.addOption("high", "High");
					dropdown
						.setValue(this.plugin.settings.azureImageQuality || "medium")
						.onChange(async value => {
							this.plugin.settings.azureImageQuality = value as "low" | "medium" | "high";
							await this.plugin.saveSettings();
						});
				});
		}
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

    private renderObservability(containerEl: HTMLElement) {
        new Setting(containerEl).setHeading().setName("Observability");

        new Setting(containerEl)
            .setName("Enable tracing")
            .setDesc("Send LLM traces to an observability provider.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.observability.enabled)
                .onChange(async value => {
                    this.plugin.settings.observability.enabled = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (!this.plugin.settings.observability.enabled) return;

        new Setting(containerEl)
            .setName("Provider")
            .setDesc("Observability backend to send traces to.")
            .addDropdown(dropdown => {
                dropdown.addOption("none", "None");
                dropdown.addOption("langfuse", "Langfuse");
                dropdown.addOption("laminar", "Laminar");
                dropdown.addOption("custom", "Custom");
                dropdown
                    .setValue(this.plugin.settings.observability.provider)
                    .onChange(async value => {
                        this.plugin.settings.observability.provider = value as "none" | "langfuse" | "laminar" | "custom";
                        await this.plugin.saveSettings();
                        this.display();
                    });
            });

        if (this.plugin.settings.observability.provider === "none") return;

        new Setting(containerEl)
            .setName("Host URL")
            .setDesc("Base URL of your observability instance (e.g. https://cloud.langfuse.com).")
            .addText(text => text
                .setPlaceholder("https://")
                .setValue(this.plugin.settings.observability.host)
                .onChange(async value => {
                    this.plugin.settings.observability.host = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Public key")
            .setDesc("Public API key for the observability provider.")
            .addText(text => text
                .setValue(this.plugin.settings.observability.publicKey)
                .onChange(async value => {
                    this.plugin.settings.observability.publicKey = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Secret key")
            .setDesc("Secret API key for the observability provider.")
            .addText(text => {
                text.setValue(this.plugin.settings.observability.secretKey)
                    .onChange(async value => {
                        this.plugin.settings.observability.secretKey = value.trim();
                        await this.plugin.saveSettings();
                    });
                text.inputEl.type = "password";
            });

        const testSetting = new Setting(containerEl)
            .setName("Test connection")
            .setDesc("Verify the host and credentials are reachable.");

        testSetting.addButton(button => {
            button.setButtonText("Test connection").onClick(async () => {
                const { host, publicKey, secretKey, provider } = this.plugin.settings.observability;
                if (!host) {
                    new Notice("Host URL is required");
                    return;
                }

                button.setButtonText("Testing...").setDisabled(true);

                const healthPath = provider === "langfuse"
                    ? "/api/public/health"
                    : "/v1/health";

                const url = host.replace(/\/$/, "") + healthPath;
                const credentials = btoa(`${publicKey}:${secretKey}`);

                try {
                    const response = await requestUrl({
                        url,
                        method: "GET",
                        headers: { Authorization: `Basic ${credentials}` },
                        throw: false,
                    });
                    if (response.status >= 200 && response.status < 300) {
                        testSetting.setDesc("✓ Connected");
                    } else {
                        testSetting.setDesc(`✗ Failed (HTTP ${response.status})`);
                    }
                } catch (e) {
                    testSetting.setDesc(`✗ Failed: ${(e as Error).message}`);
                } finally {
                    button.setButtonText("Test connection").setDisabled(false);
                }
            });
        });
    }
}

class MCPServerModal extends Modal {
    private server: MCPServer | null;
    private onSave: (server: MCPServer) => void;

    private idInput: TextComponent;
    private nameInput: TextComponent;
    private urlInput: TextComponent;
    private transportSelect: HTMLSelectElement;
    private apiKeyInput: TextComponent;

    constructor(app: App, server: MCPServer | null, onSave: (server: MCPServer) => void) {
        super(app);
        this.server = server;
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("mcp-server-modal");

        contentEl.createEl("h2", { text: this.server ? "Edit MCP Server" : "Add MCP Server" });

        new Setting(contentEl)
            .setName("Server ID")
            .setDesc("Unique identifier (no spaces)")
            .addText(text => {
                this.idInput = text;
                text.setValue(this.server?.id || "")
                    .setPlaceholder("my-mcp-server")
                    .setDisabled(!!this.server);
            });

        new Setting(contentEl)
            .setName("Display Name")
            .setDesc("Human-readable name for this server")
            .addText(text => {
                this.nameInput = text;
                text.setValue(this.server?.name || "")
                    .setPlaceholder("My MCP Server");
            });

        new Setting(contentEl)
            .setName("Server URL")
            .setDesc("MCP server endpoint URL")
            .addText(text => {
                this.urlInput = text;
                text.setValue(this.server?.url || "")
                    .setPlaceholder("https://mcp.example.com/mcp");
            });

        const transportSetting = new Setting(contentEl)
            .setName("Transport")
            .setDesc("Connection type (HTTP recommended)");

        this.transportSelect = transportSetting.controlEl.createEl("select");
        ["http", "sse"].forEach(t => {
            const opt = this.transportSelect.createEl("option", { value: t, text: t.toUpperCase() });
            if (this.server?.transport === t) opt.selected = true;
        });

        new Setting(contentEl)
            .setName("API Key")
            .setDesc("Optional authentication key")
            .addText(text => {
                this.apiKeyInput = text;
                text.setValue(this.server?.apiKey || "")
                    .setPlaceholder("Bearer token or API key")
                    .inputEl.type = "password";
            });

        const buttonRow = contentEl.createDiv("modal-button-row");
        const cancelBtn = new ButtonComponent(buttonRow);
        cancelBtn.setButtonText("Cancel").onClick(() => this.close());

        const saveBtn = new ButtonComponent(buttonRow);
        saveBtn.setButtonText("Save").setCta().onClick(() => {
            const id = this.idInput.getValue().trim().toLowerCase().replace(/\s+/g, "-");
            const name = this.nameInput.getValue().trim();
            const url = this.urlInput.getValue().trim();
            const transport = this.transportSelect.value as MCPTransportType;
            const apiKey = this.apiKeyInput.getValue().trim();

            if (!id || !name || !url) {
                new Notice("ID, Name, and URL are required");
                return;
            }

            const server: MCPServer = {
                id: this.server?.id || id,
                name,
                url,
                transport,
                apiKey: apiKey || undefined,
                enabled: this.server?.enabled ?? true,
                toolCount: this.server?.toolCount,
            };

            this.onSave(server);
            this.close();
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

class MCPImportModal extends Modal {
    private onImport: (servers: MCPServer[]) => void;

    constructor(app: App, onImport: (servers: MCPServer[]) => void) {
        super(app);
        this.onImport = onImport;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("mcp-import-modal");

        contentEl.createEl("h2", { text: "Import MCP Servers" });
        contentEl.createEl("p", {
            text: "Paste standard MCP JSON config (mcpServers format):",
            cls: "mod-muted"
        });

        const placeholder = `{
  "mcpServers": {
    "my-server": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer token"
      }
    }
  }
}`;

        const textareaEl = contentEl.createEl("textarea", {
            cls: "mcp-import-textarea",
            attr: { rows: "12", placeholder }
        });

        const buttonRow = contentEl.createDiv("modal-button-row");
        const cancelBtn = new ButtonComponent(buttonRow);
        cancelBtn.setButtonText("Cancel").onClick(() => this.close());

        const importBtn = new ButtonComponent(buttonRow);
        importBtn.setButtonText("Import").setCta().onClick(() => {
            const json = textareaEl.value.trim();
            if (!json) {
                new Notice("Please paste JSON configuration");
                return;
            }

            try {
                const parsed = JSON.parse(json);
                const servers: MCPServer[] = [];

                // Standard format: { mcpServers: { "name": { type, url, headers } } }
                const mcpServers = parsed.mcpServers || parsed.servers || parsed;

                if (typeof mcpServers !== 'object' || Array.isArray(mcpServers)) {
                    new Notice("Expected { mcpServers: { ... } } format");
                    return;
                }

                for (const [id, config] of Object.entries(mcpServers)) {
                    const cfg = config as any;
                    // Skip stdio servers (they have command instead of url)
                    if (cfg.command && !cfg.url) {
                        continue;
                    }
                    if (!cfg.url) {
                        new Notice(`Server "${id}" missing url`);
                        return;
                    }

                    // Extract API key from Authorization header if present
                    let apiKey: string | undefined;
                    const headers = cfg.headers ? { ...cfg.headers } : undefined;
                    if (headers?.Authorization) {
                        const auth = headers.Authorization;
                        if (auth.startsWith("Bearer ")) {
                            apiKey = auth.slice(7);
                            delete headers.Authorization;
                        }
                    }

                    servers.push({
                        id,
                        name: id,
                        url: cfg.url,
                        transport: cfg.type || "http",
                        apiKey,
                        headers: Object.keys(headers || {}).length ? headers : undefined,
                        enabled: true,
                    });
                }

                if (!servers.length) {
                    new Notice("No HTTP/SSE servers found (stdio not supported)");
                    return;
                }

                this.onImport(servers);
                this.close();
            } catch (e) {
                new Notice(`Invalid JSON: ${(e as Error).message}`);
            }
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}
