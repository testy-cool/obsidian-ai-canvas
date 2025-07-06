import { App, Modal, Notice, Setting } from "obsidian";
import AugmentedCanvasPlugin from "../AugmentedCanvasPlugin";
import { LLMProvider } from "../settings/AugmentedCanvasSettings";

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

        // Provider ID
        new Setting(this.contentEl)
            .setName("Provider ID")
            .setDesc("A unique identifier for this provider")
            .addText((text) => {
                text.setValue(this.idInput)
                    .setPlaceholder("e.g., anthropic, ollama")
                    .onChange((value) => {
                        this.idInput = value;
                    });
            });

        // Provider Type (Display Name)
        new Setting(this.contentEl)
            .setName("Provider Name")
            .setDesc("Display name for this provider")
            .addText((text) => {
                text.setValue(this.typeInput)
                    .setPlaceholder("e.g., Anthropic, Ollama")
                    .onChange((value) => {
                        this.typeInput = value;
                    });
            });

        // Base URL
        new Setting(this.contentEl)
            .setName("Base URL")
            .setDesc("OpenAI compatible API endpoint")
            .addText((text) => {
                text.setValue(this.baseUrlInput)
                    .setPlaceholder("https://api.example.com/v1")
                    .onChange((value) => {
                        this.baseUrlInput = value;
                    });
            });

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
            
            if (!this.baseUrlInput.trim()) {
                new Notice("Base URL is required");
                return;
            }
            
            const updatedProvider: LLMProvider = {
                id: this.idInput,
                type: this.typeInput,
                baseUrl: this.baseUrlInput,
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