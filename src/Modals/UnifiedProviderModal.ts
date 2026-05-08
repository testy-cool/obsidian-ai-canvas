import { App, Modal, Setting, Notice, ButtonComponent } from "obsidian";
import type { LLMProvider, LLMModel } from "../settings/AugmentedCanvasSettings";
import { GEMINI_BASE_URL } from "../settings/AugmentedCanvasSettings";
import { fetchProviderModels } from "../utils/modelFetch";
import { fetchPricingForModels } from "../utils/pricingFetch";
import { getDefaultProviderParams } from "../utils/providerParams";

interface ProviderPreset {
  id: string;
  type: string;
  baseUrl: string;
}

const PRESETS: ProviderPreset[] = [
  { id: "openai", type: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { id: "anthropic", type: "Anthropic", baseUrl: "https://api.anthropic.com/v1" },
  { id: "groq", type: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  { id: "openrouter", type: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "gemini", type: "Gemini", baseUrl: GEMINI_BASE_URL },
  { id: "vertex", type: "Vertex", baseUrl: "" },
  { id: "ollama", type: "Ollama", baseUrl: "http://localhost:11434/v1" },
  { id: "custom", type: "Custom", baseUrl: "" },
];

function isGeminiType(type: string): boolean {
  return ["Gemini", "Google"].includes(type);
}

function isVertexType(type: string): boolean {
  return type === "Vertex";
}

export class UnifiedProviderModal extends Modal {
  private provider: Partial<LLMProvider>;
  private selectedModelIds: Set<string> = new Set();
  private fetchedModelIds: string[] = [];
  private customModelInput = "";
  private filterText = "";
  private modelListEl: HTMLElement | null = null;
  private editing: boolean;
  private pricingData: Map<string, { inputCostPerMillion: number; outputCostPerMillion: number }> | undefined;

  constructor(
    app: App,
    private onSave: (provider: LLMProvider, models: LLMModel[]) => void,
    existingProvider?: LLMProvider,
    private existingModels: LLMModel[] = []
  ) {
    super(app);
    this.editing = !!existingProvider;
    this.provider = existingProvider
      ? { ...existingProvider }
      : { enabled: true };

    if (existingProvider) {
      this.selectedModelIds = new Set(
        existingModels.filter((m) => m.enabled).map((m) => m.model)
      );
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("unified-provider-modal");

    contentEl.createEl("h2", {
      text: this.editing ? "Edit Provider" : "Add Provider",
    });

    // --- Preset selector ---
    if (!this.editing) {
      new Setting(contentEl).setName("Preset").addDropdown((dd) => {
        dd.addOption("", "Choose a preset...");
        for (const p of PRESETS) {
          dd.addOption(p.id, p.type === "Custom" ? "OpenAI-Compatible" : p.type);
        }
        dd.onChange((val) => {
          const preset = PRESETS.find((p) => p.id === val);
          if (preset) {
            this.provider.id = preset.id;
            this.provider.type = preset.type;
            this.provider.baseUrl = preset.baseUrl;
            this.onOpen(); // re-render
          }
        });
        if (this.provider.id) {
          dd.setValue(
            PRESETS.find((p) => p.type === this.provider.type)?.id ?? ""
          );
        }
      });
    }

    // --- Provider name ---
    new Setting(contentEl).setName("Provider name").addText((text) => {
      text
        .setPlaceholder("My Provider")
        .setValue(this.provider.type ?? "")
        .onChange((val) => {
          this.provider.type = val;
          if (!this.editing) this.provider.id = val.toLowerCase().replace(/\s+/g, "-");
        });
    });

    // --- Base URL (hidden for Gemini/Vertex) ---
    if (!isGeminiType(this.provider.type ?? "") && !isVertexType(this.provider.type ?? "")) {
      new Setting(contentEl)
        .setName("Base URL")
        .setDesc("OpenAI-compatible endpoint.")
        .addText((text) => {
          text
            .setPlaceholder("https://api.example.com/v1")
            .setValue(this.provider.baseUrl ?? "")
            .onChange((val) => (this.provider.baseUrl = val));
        });
    }

    // --- API Key (hidden for Vertex) ---
    if (!isVertexType(this.provider.type ?? "")) {
      new Setting(contentEl).setName("API key").addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("sk-...")
          .setValue(this.provider.apiKey ?? "")
          .onChange((val) => (this.provider.apiKey = val));
      });
    }

    // --- Vertex-specific fields ---
    if (isVertexType(this.provider.type ?? "")) {
      new Setting(contentEl).setName("Project ID").addText((text) => {
        text
          .setValue(this.provider.projectId ?? "")
          .onChange((val) => (this.provider.projectId = val));
      });

      new Setting(contentEl).setName("Location").addText((text) => {
        text
          .setValue(this.provider.location ?? "us-central1")
          .onChange((val) => (this.provider.location = val));
      });

      new Setting(contentEl)
        .setName("Service Account JSON")
        .addTextArea((ta) => {
          ta.setValue(this.provider.serviceAccountJson ?? "").onChange(
            (val) => (this.provider.serviceAccountJson = val)
          );
          ta.inputEl.rows = 4;
          ta.inputEl.style.width = "100%";
          ta.inputEl.style.fontFamily = "monospace";
          ta.inputEl.style.fontSize = "11px";
        });
    }

    // --- Test connection + Fetch models ---
    const connSetting = new Setting(contentEl);
    let connStatus: HTMLElement;

    connSetting.addButton((btn: ButtonComponent) => {
      btn.setButtonText("Test & fetch models").onClick(async () => {
        btn.setDisabled(true);
        btn.setButtonText("Fetching...");
        connStatus?.setText("");
        try {
          const models = await fetchProviderModels(this.provider as LLMProvider);
          this.fetchedModelIds = models;
          connStatus?.setText(`Found ${models.length} models`);
          connStatus?.addClass("mod-success");
          connStatus?.removeClass("mod-warning");

          // Auto-fetch pricing (best-effort)
          try {
            this.pricingData = await fetchPricingForModels(models);
          } catch {
            // Pricing is best-effort
          }

          this.renderModelList();
        } catch (e) {
          connStatus?.setText(`Failed: ${e}`);
          connStatus?.addClass("mod-warning");
          connStatus?.removeClass("mod-success");
        } finally {
          btn.setDisabled(false);
          btn.setButtonText("Test & fetch models");
        }
      });
    });
    connStatus = connSetting.controlEl.createEl("span", {
      cls: "setting-item-description",
    });

    // --- Model list area ---
    contentEl.createEl("h3", { text: "Models" });

    // Filter
    new Setting(contentEl).addText((text) => {
      text.setPlaceholder("Filter models...").onChange((val) => {
        this.filterText = val.toLowerCase();
        this.renderModelList();
      });
    });

    // Select all / Clear buttons
    const actionsSetting = new Setting(contentEl);
    actionsSetting.addButton((btn) => {
      btn.setButtonText("Select all").onClick(() => {
        this.selectedModelIds = new Set(this.fetchedModelIds);
        this.renderModelList();
      });
    });
    actionsSetting.addButton((btn) => {
      btn.setButtonText("Clear").onClick(() => {
        this.selectedModelIds.clear();
        this.renderModelList();
      });
    });

    // Model checklist container
    this.modelListEl = contentEl.createDiv({ cls: "model-checklist" });
    this.renderModelList();

    // Custom model input
    new Setting(contentEl).addText((text) => {
      text
        .setPlaceholder("Custom model ID...")
        .onChange((val) => (this.customModelInput = val));
    }).addButton((btn) => {
      btn.setButtonText("+ Add").onClick(() => {
        if (this.customModelInput.trim()) {
          const id = this.customModelInput.trim();
          if (!this.fetchedModelIds.includes(id)) {
            this.fetchedModelIds.push(id);
          }
          this.selectedModelIds.add(id);
          this.customModelInput = "";
          this.renderModelList();
        }
      });
    });

    // --- Footer buttons ---
    const footer = contentEl.createDiv({ cls: "modal-button-container" });
    const cancelBtn = footer.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());

    const saveBtn = footer.createEl("button", {
      text: "Save provider",
      cls: "mod-cta",
    });
    saveBtn.addEventListener("click", () => this.save());
  }

  private renderModelList(): void {
    if (!this.modelListEl) return;
    this.modelListEl.empty();

    const filtered = this.fetchedModelIds.filter((id) =>
      this.filterText ? id.toLowerCase().includes(this.filterText) : true
    );

    if (filtered.length === 0 && this.fetchedModelIds.length === 0) {
      this.modelListEl.createEl("div", {
        text: 'Click "Test & fetch models" to load available models.',
        cls: "setting-item-description",
      });
      return;
    }

    for (const modelId of filtered) {
      const row = this.modelListEl.createDiv({ cls: "model-check-item" });
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = this.selectedModelIds.has(modelId);
      cb.addEventListener("change", () => {
        if (cb.checked) {
          this.selectedModelIds.add(modelId);
        } else {
          this.selectedModelIds.delete(modelId);
        }
      });
      row.createEl("span", { text: modelId, cls: "model-check-label" });
    }
  }

  private save(): void {
    const p = this.provider;
    if (!p.id || !p.type) {
      new Notice("Provider name is required.");
      return;
    }

    if (
      !isGeminiType(p.type) &&
      !isVertexType(p.type) &&
      !p.baseUrl?.trim()
    ) {
      new Notice("Base URL is required.");
      return;
    }

    const provider: LLMProvider = {
      id: p.id!,
      type: p.type!,
      baseUrl: isGeminiType(p.type!) ? GEMINI_BASE_URL : (p.baseUrl ?? ""),
      apiKey: p.apiKey ?? "",
      enabled: p.enabled ?? true,
      projectId: p.projectId,
      location: p.location,
      serviceAccountJson: p.serviceAccountJson,
    };

    const defaultParams = getDefaultProviderParams(provider.type);

    const models: LLMModel[] = [...this.selectedModelIds].map((modelId) => {
      const existing = this.existingModels.find((m) => m.model === modelId);
      const price = this.pricingData?.get(modelId);
      return {
        id: `${provider.id}-${modelId}`,
        providerId: provider.id,
        model: modelId,
        enabled: existing?.enabled ?? true,
        timeoutMs: existing?.timeoutMs,
        maxRetries: existing?.maxRetries,
        inputCostPerMillion: existing?.costOverridden
          ? existing.inputCostPerMillion
          : (price?.inputCostPerMillion ?? existing?.inputCostPerMillion),
        outputCostPerMillion: existing?.costOverridden
          ? existing.outputCostPerMillion
          : (price?.outputCostPerMillion ?? existing?.outputCostPerMillion),
        providerParams: existing?.providerParams ?? (Object.keys(defaultParams).length > 0 ? defaultParams : undefined),
      };
    });

    this.onSave(provider, models);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
