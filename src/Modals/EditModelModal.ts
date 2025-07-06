import { App, Modal, Setting } from "obsidian";
import AugmentedCanvasPlugin from "../AugmentedCanvasPlugin";
import { LLMModel, LLMProvider } from "../settings/AugmentedCanvasSettings";

export class EditModelModal extends Modal {
    plugin: AugmentedCanvasPlugin;
    model: LLMModel | null;
    onSubmit: (model: LLMModel) => void;
    idInput: string = "";
    providerIdInput: string = "";
    modelInput: string = "";
    enabledInput: boolean = true;
    providers: LLMProvider[];

    constructor(
        app: App, 
        plugin: AugmentedCanvasPlugin, 
        model: LLMModel | null,
        providers: LLMProvider[],
        onSubmit: (model: LLMModel) => void
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
        }
    }

    onOpen() {
        this.contentEl.empty();
        this.contentEl.addClass("augmented-canvas-modal-container");

        // Title
        this.contentEl.createEl("h3", { 
            text: this.model ? "Edit Model" : "Add New Model" 
        });

        // Model ID
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

        // Provider Selection
        new Setting(this.contentEl)
            .setName("Provider")
            .setDesc("Select the provider for this model")
            .addDropdown((dropdown) => {
                // Add provider options
                this.providers.forEach(provider => {
                    dropdown.addOption(provider.id, provider.type);
                });
                
                dropdown.setValue(this.providerIdInput || this.providers[0]?.id || "")
                    .onChange((value) => {
                        this.providerIdInput = value;
                    });
            });

        // Model Name/Identifier
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

        // Enabled Toggle
        new Setting(this.contentEl)
            .setName("Enabled")
            .setDesc("Whether this model is enabled")
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
            text: this.model ? "Save" : "Add",
            cls: "mod-cta"
        });
        
        submitBtn.onClickEvent(() => {
            if (!this.idInput.trim()) {
                // Show error if ID is empty
                return;
            }
            
            if (!this.modelInput.trim()) {
                // Show error if model name is empty
                return;
            }
            
            const updatedModel: LLMModel = {
                id: this.idInput,
                providerId: this.providerIdInput,
                model: this.modelInput,
                enabled: this.enabledInput
            };
            
            this.onSubmit(updatedModel);
            this.close();
        });
    }
} 