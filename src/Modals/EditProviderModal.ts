import { App, Modal, Notice, Setting, TextComponent } from "obsidian";
import AugmentedCanvasPlugin from "../AugmentedCanvasPlugin";
import { GEMINI_BASE_URL, LLMProvider } from "../settings/AugmentedCanvasSettings";

const PROVIDER_PRESETS = [
    { id: "openai", type: "OpenAI", baseUrl: "https://api.openai.com/v1" },
    { id: "anthropic", type: "Anthropic", baseUrl: "https://api.anthropic.com/v1" },
    { id: "groq", type: "Groq", baseUrl: "https://api.groq.com/v1" },
    { id: "openrouter", type: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
    { id: "gemini", type: "Gemini", baseUrl: GEMINI_BASE_URL },
    { id: "vertex", type: "Vertex", baseUrl: "" },
    { id: "ollama", type: "Ollama", baseUrl: "http://localhost:11434/v1" }
];

const isGeminiProvider = (id: string, type: string) => {
    const normalizedId = id.trim().toLowerCase();
    const normalizedType = type.trim().toLowerCase();
    return normalizedId === "gemini" || normalizedType === "gemini" || normalizedType === "google";
};

const isVertexProvider = (id: string, type: string) => {
    const normalizedId = id.trim().toLowerCase();
    const normalizedType = type.trim().toLowerCase();
    return normalizedId === "vertex" || normalizedType === "vertex";
};

export class EditProviderModal extends Modal {
    plugin: AugmentedCanvasPlugin;
    provider: LLMProvider | null;
    onSubmit: (provider: LLMProvider) => void;
    idInput: string = "";
    typeInput: string = "";
    baseUrlInput: string = "";
    apiKeyInput: string = "";
    enabledInput: boolean = true;
    projectIdInput: string = "";
    locationInput: string = "us-central1";
    serviceAccountJsonInput: string = "";
    contentEl: HTMLElement;
    idInputEl?: TextComponent;
    typeInputEl?: TextComponent;
    baseUrlInputEl?: TextComponent;
    apiKeySettingEl?: Setting;
    vertexSettingsEl?: HTMLElement;

    constructor(
        app: App, 
        plugin: AugmentedCanvasPlugin, 
        provider: LLMProvider | null,
        onSubmit: (provider: LLMProvider) => void
    ) {
        super(app);
        this.plugin = plugin;
        this.provider = provider;
        this.onSubmit = onSubmit;

        // Initialize inputs with provider values if editing
        if (provider) {
            this.idInput = provider.id;
            this.typeInput = provider.type;
            this.baseUrlInput = provider.baseUrl;
            this.apiKeyInput = provider.apiKey;
            this.enabledInput = provider.enabled;
            this.projectIdInput = provider.projectId || "";
            this.locationInput = provider.location || "us-central1";
            this.serviceAccountJsonInput = provider.serviceAccountJson || "";
        }
    }

    onOpen() {
        this.contentEl.empty();
        this.contentEl.addClass("augmented-canvas-modal-container");

        // Title
        this.contentEl.createEl("h3", { 
            text: this.provider ? "Edit Provider" : "Add New Provider" 
        });

        let baseUrlSetting: Setting | null = null;
        let apiKeySetting: Setting | null = null;

        const updateProviderFieldsState = () => {
            const isGemini = isGeminiProvider(this.idInput, this.typeInput);
            const isVertex = isVertexProvider(this.idInput, this.typeInput);

            // Handle base URL visibility/state
            if (isGemini) {
                this.baseUrlInput = GEMINI_BASE_URL;
                this.baseUrlInputEl?.setValue(this.baseUrlInput);
                this.baseUrlInputEl?.setDisabled(true);
                baseUrlSetting?.setDesc("Gemini uses the Google SDK (endpoint is fixed).");
                baseUrlSetting?.settingEl.show();
            } else if (isVertex) {
                this.baseUrlInput = "";
                this.baseUrlInputEl?.setValue("");
                this.baseUrlInputEl?.setDisabled(true);
                baseUrlSetting?.setDesc("Vertex AI uses service account authentication.");
                baseUrlSetting?.settingEl.hide();
            } else {
                this.baseUrlInputEl?.setDisabled(false);
                baseUrlSetting?.setDesc("OpenAI compatible API endpoint");
                baseUrlSetting?.settingEl.show();
            }

            // Hide API key for Vertex (uses service account JSON instead)
            if (isVertex) {
                apiKeySetting?.settingEl.hide();
            } else {
                apiKeySetting?.settingEl.show();
                apiKeySetting?.setName("API Key");
                apiKeySetting?.setDesc("API key for this provider");
            }

            // Handle Vertex-specific settings visibility
            if (this.vertexSettingsEl) {
                if (isVertex) {
                    this.vertexSettingsEl.show();
                } else {
                    this.vertexSettingsEl.hide();
                }
            }
        };

        const applyPreset = (preset: { id: string; type: string; baseUrl: string }) => {
            this.idInput = preset.id;
            this.typeInput = preset.type;
            this.baseUrlInput = preset.baseUrl;

            this.idInputEl?.setValue(this.idInput);
            this.typeInputEl?.setValue(this.typeInput);
            this.baseUrlInputEl?.setValue(this.baseUrlInput);
            updateProviderFieldsState();
        };

        if (!this.provider) {
            new Setting(this.contentEl)
                .setName("Provider Preset")
                .setDesc("Auto-fill ID, name, and base URL from a common provider.")
                .addDropdown((dropdown) => {
                    dropdown.addOption("", "Custom");
                    PROVIDER_PRESETS.forEach((preset) => {
                        dropdown.addOption(preset.id, preset.type);
                    });
                    dropdown.onChange((value) => {
                        const preset = PROVIDER_PRESETS.find(p => p.id === value);
                        if (preset) {
                            applyPreset(preset);
                        }
                    });
                });
        }

        // Provider ID
        new Setting(this.contentEl)
            .setName("Provider ID")
            .setDesc("A unique identifier for this provider")
            .addText((text) => {
                this.idInputEl = text;
                text.setValue(this.idInput)
                    .setPlaceholder("e.g., anthropic, ollama")
                    .onChange((value) => {
                        this.idInput = value;
                        updateProviderFieldsState();
                    });
            });

        // Provider Type (Display Name)
        new Setting(this.contentEl)
            .setName("Provider Name")
            .setDesc("Display name for this provider")
            .addText((text) => {
                this.typeInputEl = text;
                text.setValue(this.typeInput)
                    .setPlaceholder("e.g., Anthropic, Ollama")
                    .onChange((value) => {
                        this.typeInput = value;
                        updateProviderFieldsState();
                    });
            });

        // Base URL
        baseUrlSetting = new Setting(this.contentEl)
            .setName("Base URL")
            .setDesc("OpenAI compatible API endpoint")
            .addText((text) => {
                this.baseUrlInputEl = text;
                text.setValue(this.baseUrlInput)
                    .setPlaceholder("https://api.example.com/v1")
                    .onChange((value) => {
                        this.baseUrlInput = value;
                    });
            });

        // API Key
        apiKeySetting = new Setting(this.contentEl)
            .setName("API Key")
            .setDesc("API key for this provider")
            .addText((text) => {
                text.setPlaceholder("API Key")
                    .setValue(this.apiKeyInput)
                    .onChange((value) => {
                        this.apiKeyInput = value;
                    });
                text.inputEl.type = "password";
            });

        // Vertex AI specific settings
        this.vertexSettingsEl = this.contentEl.createDiv("vertex-settings");

        new Setting(this.vertexSettingsEl)
            .setName("Project ID")
            .setDesc("Your Google Cloud project ID (from the JSON or console)")
            .addText((text) => {
                text.setPlaceholder("my-project-id")
                    .setValue(this.projectIdInput)
                    .onChange((value) => {
                        this.projectIdInput = value;
                    });
            });

        new Setting(this.vertexSettingsEl)
            .setName("Location")
            .setDesc("Google Cloud region (e.g., us-central1)")
            .addText((text) => {
                text.setPlaceholder("us-central1")
                    .setValue(this.locationInput)
                    .onChange((value) => {
                        this.locationInput = value;
                    });
            });

        new Setting(this.vertexSettingsEl)
            .setName("Service Account JSON")
            .setDesc("Paste the entire service account JSON file contents")
            .addTextArea((text) => {
                text.setPlaceholder('{"type": "service_account", "project_id": "...", ...}')
                    .setValue(this.serviceAccountJsonInput)
                    .onChange((value) => {
                        this.serviceAccountJsonInput = value;
                        // Auto-fill project ID if empty
                        if (!this.projectIdInput.trim()) {
                            try {
                                const sa = JSON.parse(value);
                                if (sa.project_id) {
                                    this.projectIdInput = sa.project_id;
                                }
                            } catch {}
                        }
                    });
                text.inputEl.rows = 8;
                text.inputEl.style.width = "100%";
                text.inputEl.style.fontFamily = "monospace";
                text.inputEl.style.fontSize = "11px";
            });

        // Initialize visibility state
        updateProviderFieldsState();

        // Enabled Toggle
        new Setting(this.contentEl)
            .setName("Enabled")
            .setDesc("Whether this provider is enabled")
            .addToggle((toggle) => {
                toggle.setValue(this.enabledInput)
                    .onChange((value) => {
                        this.enabledInput = value;
                    });
            });

        // Submit button
        const footerEl = this.contentEl.createDiv("modal-button-container");
        
        const cancelBtn = footerEl.createEl("button", { text: "Cancel" });
        cancelBtn.onClickEvent(() => {
            this.close();
        });

        const submitBtn = footerEl.createEl("button", { 
            text: this.provider ? "Save" : "Add",
            cls: "mod-cta"
        });
        
        submitBtn.onClickEvent(() => {
            if (!this.idInput.trim()) {
                new Notice("Provider ID is required");
                return;
            }

            if (!this.typeInput.trim()) {
                new Notice("Provider name is required");
                return;
            }

            const geminiProvider = isGeminiProvider(this.idInput, this.typeInput);
            const vertexProvider = isVertexProvider(this.idInput, this.typeInput);

            if (!geminiProvider && !vertexProvider && !this.baseUrlInput.trim()) {
                new Notice("Base URL is required");
                return;
            }

            if (vertexProvider) {
                if (!this.serviceAccountJsonInput.trim()) {
                    new Notice("Service Account JSON is required for Vertex AI");
                    return;
                }
                try {
                    const sa = JSON.parse(this.serviceAccountJsonInput);
                    if (!sa.client_email || !sa.private_key) {
                        new Notice("Invalid service account JSON: missing client_email or private_key");
                        return;
                    }
                    // Auto-fill project ID from JSON if not set
                    if (!this.projectIdInput.trim() && sa.project_id) {
                        this.projectIdInput = sa.project_id;
                    }
                } catch {
                    new Notice("Invalid JSON format in Service Account JSON");
                    return;
                }
                if (!this.projectIdInput.trim()) {
                    new Notice("Project ID is required for Vertex AI");
                    return;
                }
            }

            const updatedProvider: LLMProvider = {
                id: this.idInput,
                type: this.typeInput,
                baseUrl: geminiProvider ? GEMINI_BASE_URL : this.baseUrlInput,
                apiKey: this.apiKeyInput,
                enabled: this.enabledInput,
                projectId: vertexProvider ? this.projectIdInput : undefined,
                location: vertexProvider ? (this.locationInput || "us-central1") : undefined,
                serviceAccountJson: vertexProvider ? this.serviceAccountJsonInput : undefined,
            };

            this.onSubmit(updatedProvider);
            this.close();
        });
    }

    onClose() {
        this.contentEl.empty();
    }
} 
