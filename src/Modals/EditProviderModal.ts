import { App, Modal, Notice, Setting, TextComponent } from "obsidian";
import AugmentedCanvasPlugin from "../AugmentedCanvasPlugin";
import { GEMINI_BASE_URL, LLMProvider } from "../settings/AugmentedCanvasSettings";

const PROVIDER_PRESETS = [
    { id: "openai", type: "OpenAI", baseUrl: "https://api.openai.com/v1" },
    { id: "anthropic", type: "Anthropic", baseUrl: "https://api.anthropic.com/v1" },
    { id: "groq", type: "Groq", baseUrl: "https://api.groq.com/v1" },
    { id: "openrouter", type: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
    { id: "gemini", type: "Gemini", baseUrl: GEMINI_BASE_URL },
    { id: "ollama", type: "Ollama", baseUrl: "http://localhost:11434/v1" }
];

const isGeminiProvider = (id: string, type: string) => {
    const normalizedId = id.trim().toLowerCase();
    const normalizedType = type.trim().toLowerCase();
    return normalizedId === "gemini" || normalizedType === "gemini" || normalizedType === "google";
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
    contentEl: HTMLElement;
    idInputEl?: TextComponent;
    typeInputEl?: TextComponent;
    baseUrlInputEl?: TextComponent;

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
        const updateBaseUrlState = () => {
            const isGemini = isGeminiProvider(this.idInput, this.typeInput);
            if (isGemini) {
                this.baseUrlInput = GEMINI_BASE_URL;
                this.baseUrlInputEl?.setValue(this.baseUrlInput);
                this.baseUrlInputEl?.setDisabled(true);
                baseUrlSetting?.setDesc("Gemini uses the Google SDK (endpoint is fixed).");
            } else {
                this.baseUrlInputEl?.setDisabled(false);
                baseUrlSetting?.setDesc("OpenAI compatible API endpoint");
            }
        };

        const applyPreset = (preset: { id: string; type: string; baseUrl: string }) => {
            this.idInput = preset.id;
            this.typeInput = preset.type;
            this.baseUrlInput = preset.baseUrl;

            this.idInputEl?.setValue(this.idInput);
            this.typeInputEl?.setValue(this.typeInput);
            this.baseUrlInputEl?.setValue(this.baseUrlInput);
            updateBaseUrlState();
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
                        updateBaseUrlState();
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
                        updateBaseUrlState();
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
        updateBaseUrlState();

        // API Key
        new Setting(this.contentEl)
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
            if (!geminiProvider && !this.baseUrlInput.trim()) {
                new Notice("Base URL is required");
                return;
            }
            
            const updatedProvider: LLMProvider = {
                id: this.idInput,
                type: this.typeInput,
                baseUrl: geminiProvider ? GEMINI_BASE_URL : this.baseUrlInput,
                apiKey: this.apiKeyInput,
                enabled: this.enabledInput
            };
            
            this.onSubmit(updatedProvider);
            this.close();
        });
    }

    onClose() {
        this.contentEl.empty();
    }
} 
