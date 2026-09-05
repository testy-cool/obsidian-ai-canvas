import { App, Modal, Setting, Notice, ButtonComponent } from "obsidian";
import type { LLMProvider, LLMModel } from "../settings/AugmentedCanvasSettings";
import { GEMINI_BASE_URL } from "../settings/AugmentedCanvasSettings";
import { isBifrostProvider } from "../utils/providerCapabilities";
import { fetchProviderModels } from "../utils/modelFetch";
import { fetchPricingForModels } from "../utils/pricingFetch";
import { getDefaultProviderParams, getParamsForModel, detectProviderLabel } from "../utils/providerParams";
import { findCodexBinary, CODEX_MODELS } from "../utils/codexCli";

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
  { id: "azure", type: "Azure", baseUrl: "" },
  { id: "gemini", type: "Gemini", baseUrl: GEMINI_BASE_URL },
  { id: "vertex", type: "Vertex", baseUrl: "" },
  { id: "ollama", type: "Ollama", baseUrl: "http://localhost:11434/v1" },
  { id: "codex", type: "Codex", baseUrl: "" },
  { id: "custom", type: "Custom", baseUrl: "" },
];

function isGeminiType(type: string): boolean {
  return ["Gemini", "Google"].includes(type);
}

function isVertexType(type: string): boolean {
  return type === "Vertex";
}

function isCodexType(type: string): boolean {
  return type === "Codex";
}

export class UnifiedProviderModal extends Modal {
  private static readonly MODEL_PAGE_SIZE = 50;

  private provider: Partial<LLMProvider>;
	private nameField?: { input: HTMLInputElement; error: HTMLElement };
	private baseUrlField?: { input: HTMLInputElement; error: HTMLElement };
  private selectedModelIds: Set<string> = new Set();
  private fetchedModelIds: string[] = [];
	private modelFetchVersion = 0;
  private customModelInput = "";
  private filterText = "";
  private renderLimit = UnifiedProviderModal.MODEL_PAGE_SIZE;
  private modelListEl: HTMLElement | null = null;
  private editing: boolean;
  private pricingData: Map<string, { inputCostPerMillion: number; outputCostPerMillion: number }> | undefined;
  private modelParams = new Map<string, Record<string, unknown>>();
  private expandedParams = new Set<string>();

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

    for (const m of existingModels) {
      if (m.providerParams) this.modelParams.set(m.model, { ...m.providerParams });
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
						const scrollTop = contentEl.scrollTop;
						this.modelFetchVersion++;
						this.fetchedModelIds = [];
						this.selectedModelIds.clear();
						this.modelParams.clear();
						this.expandedParams.clear();
						this.pricingData = undefined;
						this.renderLimit = UnifiedProviderModal.MODEL_PAGE_SIZE;
						updateProviderFields();
						this.setFieldError(this.nameField, "");
						this.setFieldError(this.baseUrlField, "");
						connStatus.setText("");
						this.renderModelList();
						contentEl.scrollTop = scrollTop;
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
		let geminiNativeSetting: Setting | undefined;
		const nameSetting = new Setting(contentEl).setName("Provider name");
		nameSetting.controlEl.addClass("ac-settings-field");
		nameSetting.addText((text) => {
			this.nameField = { input: text.inputEl, error: nameSetting.controlEl.createDiv("ac-setting-error") };
			this.nameField.error.setAttribute("aria-live", "polite");
      text
        .setPlaceholder("My Provider")
        .setValue(this.provider.type ?? "")
        .onChange((val) => {
          this.provider.type = val;
					if (val.trim()) this.setFieldError(this.nameField, "");
          if (!this.editing) this.provider.id = val.toLowerCase().replace(/\s+/g, "-");
					if (geminiNativeSetting) geminiNativeSetting.settingEl.style.display = isBifrostProvider(this.provider) ? "" : "none";
        });
    });

		geminiNativeSetting = new Setting(contentEl)
			.setName("Use Gemini-native API")
			.setDesc("Route requests through Bifrost's /genai endpoint so Google search grounding, URL context and YouTube links work. Model ids stay as listed (for example vertex/gemini-3.1-pro-preview).")
			.addToggle(toggle => toggle
				.setValue(this.provider.geminiNative ?? false)
				.onChange(value => { this.provider.geminiNative = value; }));
		geminiNativeSetting.settingEl.style.display = isBifrostProvider(this.provider) ? "" : "none";

		// Keep provider fields mounted so preset changes retain focus and values.
		const baseUrlSetting = new Setting(contentEl).setName("Base URL");
		baseUrlSetting.controlEl.addClass("ac-settings-field");
		baseUrlSetting.addText(text => {
			this.baseUrlField = { input: text.inputEl, error: baseUrlSetting.controlEl.createDiv("ac-setting-error") };
			this.baseUrlField.error.setAttribute("aria-live", "polite");
			text.setValue(this.provider.baseUrl ?? "").onChange(val => {
				this.provider.baseUrl = val;
				geminiNativeSetting!.settingEl.style.display = isBifrostProvider(this.provider) ? "" : "none";
				if (val.trim()) this.setFieldError(this.baseUrlField, "");
			});
		});

		let apiKeyInput!: HTMLInputElement;
		const apiKeySetting = new Setting(contentEl).setName("API key").addText(text => {
			apiKeyInput = text.inputEl;
			apiKeyInput.type = "password";
			text.setValue(this.provider.apiKey ?? "").onChange(val => { this.provider.apiKey = val; });
		});

		const projectSetting = new Setting(contentEl).setName("Project ID").addText(text => {
			text.setValue(this.provider.projectId ?? "").onChange(val => { this.provider.projectId = val; });
		});
		const locationSetting = new Setting(contentEl).setName("Location").addText(text => {
			text.setValue(this.provider.location ?? "us-central1").onChange(val => { this.provider.location = val; });
		});
		const serviceAccountSetting = new Setting(contentEl).setName("Service Account JSON").addTextArea(ta => {
			ta.setValue(this.provider.serviceAccountJson ?? "").onChange(val => { this.provider.serviceAccountJson = val; });
			ta.inputEl.rows = 4;
			ta.inputEl.style.width = "100%";
			ta.inputEl.style.fontFamily = "monospace";
			ta.inputEl.style.fontSize = "12px";
		});

		const codexSetting = new Setting(contentEl).setName("Codex binary").addText(text => {
			text.setPlaceholder("/path/to/codex (optional override)")
				.setValue(this.provider.binaryPath ?? "")
				.onChange(val => { this.provider.binaryPath = val || undefined; });
		});

		const updateProviderFields = () => {
			const type = this.provider.type ?? "";
			const gemini = isGeminiType(type);
			const vertex = isVertexType(type);
			const codex = isCodexType(type);
			const azure = type === "Azure";
			this.nameField!.input.value = type;
			this.baseUrlField!.input.value = this.provider.baseUrl ?? "";
			this.baseUrlField!.input.placeholder = azure
				? "https://<resource>.services.ai.azure.com" : "https://api.example.com/v1";
			baseUrlSetting.setDesc(azure
				? "Azure OpenAI resource endpoint — no path, no api-version" : "OpenAI-compatible endpoint.");
			baseUrlSetting.settingEl.style.display = gemini || vertex || codex ? "none" : "";
			apiKeyInput.placeholder = gemini ? "Google API key" : "sk-...";
			apiKeySetting.settingEl.style.display = vertex || codex ? "none" : "";
			for (const setting of [projectSetting, locationSetting, serviceAccountSetting]) {
				setting.settingEl.style.display = vertex ? "" : "none";
			}
			codexSetting.settingEl.style.display = codex ? "" : "none";
			if (codex) {
				const detected = findCodexBinary(this.provider.binaryPath);
				codexSetting.setDesc(detected
					? `Detected: ${detected}`
					: "Not found — install with `npm i -g @openai/codex` or set the path below.");
			}
			geminiNativeSetting!.settingEl.style.display = isBifrostProvider(this.provider) ? "" : "none";
		};
		updateProviderFields();

    // --- Test connection + Fetch models ---
    const connSetting = new Setting(contentEl);
    let connStatus: HTMLElement;

    connSetting.addButton((btn: ButtonComponent) => {
			btn.buttonEl.addClass("provider-fetch-button");
      btn.setButtonText("Test & fetch models").onClick(async () => {
				const fetchVersion = this.modelFetchVersion;
        btn.setDisabled(true);
        btn.setButtonText("Fetching…");
        connStatus?.setText("");
        try {
          if (isCodexType(this.provider.type ?? "")) {
            const detected = findCodexBinary(this.provider.binaryPath);
            this.fetchedModelIds = [...CODEX_MODELS];
            connStatus?.setText(
              detected
                ? `Codex detected: ${detected}`
                : "Codex CLI not found — install it or set the binary path above."
            );
            connStatus?.toggleClass("mod-success", !!detected);
            connStatus?.toggleClass("mod-warning", !detected);
            this.renderModelList();
            return;
          }

          const models = await fetchProviderModels({ ...this.provider } as LLMProvider);
					if (fetchVersion !== this.modelFetchVersion) return;
          this.fetchedModelIds = models;
          this.renderLimit = UnifiedProviderModal.MODEL_PAGE_SIZE;
          connStatus?.setText(`Found ${models.length} models`);
          connStatus?.addClass("mod-success");
          connStatus?.removeClass("mod-warning");

          // Auto-fetch pricing (best-effort)
          try {
						const pricing = await fetchPricingForModels(models);
						if (fetchVersion !== this.modelFetchVersion) return;
						this.pricingData = pricing;
          } catch {
            // Pricing is best-effort
          }

					if (fetchVersion !== this.modelFetchVersion) return;
          this.renderModelList();
        } catch (e) {
					if (fetchVersion !== this.modelFetchVersion) return;
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
        this.renderLimit = UnifiedProviderModal.MODEL_PAGE_SIZE;
        this.renderModelList();
      });
    });

    // Select all / Clear buttons — act on the currently filtered set
    const actionsSetting = new Setting(contentEl);
    actionsSetting.addButton((btn) => {
      btn.setButtonText("Select all").onClick(() => {
        for (const id of this.getFilteredModelIds()) this.selectedModelIds.add(id);
        this.renderModelList();
      });
    });
    actionsSetting.addButton((btn) => {
      btn.setButtonText("Clear").onClick(() => {
        for (const id of this.getFilteredModelIds()) this.selectedModelIds.delete(id);
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
		contentEl.querySelector<HTMLInputElement>("input")?.focus();
  }

  private getFilteredModelIds(): string[] {
    return this.fetchedModelIds.filter((id) =>
      this.filterText ? id.toLowerCase().includes(this.filterText) : true
    );
  }

  private renderModelList(): void {
    if (!this.modelListEl) return;
    this.modelListEl.empty();

    const filtered = this.getFilteredModelIds();

    if (filtered.length === 0 && this.fetchedModelIds.length === 0) {
      this.modelListEl.createEl("div", {
        text: 'Click "Test & fetch models" to load available models.',
        cls: "setting-item-description",
      });
      return;
    }

    // Selected models first so enabled ones stay visible under the render cap
    const sorted = [...filtered].sort(
      (a, b) =>
        Number(this.selectedModelIds.has(b)) - Number(this.selectedModelIds.has(a))
    );

    const visible = sorted.slice(0, this.renderLimit);
    for (const modelId of visible) {
      const itemWrap = this.modelListEl.createDiv({ cls: "model-check-item-wrap" });
      this.renderModelRow(itemWrap, modelId);
    }

    const hidden = sorted.length - visible.length;
    if (hidden > 0) {
      const moreWrap = this.modelListEl.createDiv({ cls: "model-check-more" });
      moreWrap.createEl("span", {
        text: `Showing ${visible.length} of ${sorted.length} models — filter to narrow down, or`,
        cls: "setting-item-description",
      });
      const moreBtn = moreWrap.createEl("button", {
        text: `show ${Math.min(hidden, UnifiedProviderModal.MODEL_PAGE_SIZE)} more`,
      });
      moreBtn.addEventListener("click", () => {
        this.renderLimit += UnifiedProviderModal.MODEL_PAGE_SIZE;
        this.renderModelList();
      });
    }
  }

	private renderModelRow(itemWrap: HTMLElement, modelId: string): void {
		const row = itemWrap.createDiv({ cls: "model-check-item" });
		const cb = row.createEl("input", { type: "checkbox" });
		cb.checked = this.selectedModelIds.has(modelId);
		cb.addEventListener("change", () => {
			if (cb.checked) this.selectedModelIds.add(modelId);
			else this.selectedModelIds.delete(modelId);
			updateParams();
		});
		row.createEl("span", { text: modelId, cls: "model-check-label" });

		const defs = getParamsForModel(modelId, this.provider.type ?? "");
		const gearBtn = defs.length ? row.createEl("button", { text: "⚙", cls: "clickable-icon" }) : null;
		const paramsContainer = defs.length ? itemWrap.createDiv({ cls: "model-params-editor" }) : null;
		const updateParams = () => {
			if (!gearBtn || !paramsContainer) return;
			gearBtn.style.visibility = cb.checked ? "" : "hidden";
			gearBtn.disabled = !cb.checked;
			const expanded = cb.checked && this.expandedParams.has(modelId);
			gearBtn.setAttribute("aria-expanded", String(expanded));
			paramsContainer.style.display = expanded ? "" : "none";
			paramsContainer.empty();
			if (expanded) this.renderParamsEditor(paramsContainer, modelId);
		};
		if (gearBtn) {
			gearBtn.setAttribute("aria-label", `Parameters for ${modelId}`);
			gearBtn.style.fontSize = "max(12px, var(--font-ui-small))";
			gearBtn.addEventListener("click", () => {
				if (this.expandedParams.has(modelId)) this.expandedParams.delete(modelId);
				else this.expandedParams.add(modelId);
				updateParams();
			});
		}
		updateParams();
	}

  private renderParamsEditor(container: HTMLElement, modelId: string): void {
    const type = this.provider.type ?? "";
    const defs = getParamsForModel(modelId, type);
    if (!defs.length) return;
    const current = this.modelParams.get(modelId) ?? {};
    container.createEl("div", {
      text: `${detectProviderLabel(modelId, type)} settings`,
      cls: "setting-item-description",
    });
    for (const def of defs) {
      const row = new Setting(container).setName(def.label).setDesc(def.description);
      if (def.type === "select" && def.options) {
        row.addDropdown((dd) => {
          dd.addOption("", "(default)");
          for (const opt of def.options!) dd.addOption(opt, opt);
          dd.setValue((current[def.key] as string) ?? "").onChange((val) => {
            const params = this.modelParams.get(modelId) ?? {};
            if (val) params[def.key] = val; else delete params[def.key];
            this.modelParams.set(modelId, params);
          });
        });
      } else if (def.type === "boolean") {
        row.addToggle((t) => {
          t.setValue(!!current[def.key]).onChange((val) => {
            const params = this.modelParams.get(modelId) ?? {};
            params[def.key] = val;
            this.modelParams.set(modelId, params);
          });
        });
      }
    }
  }

	private setFieldError(field: { input: HTMLInputElement; error: HTMLElement } | undefined, message: string, focus = false) {
		if (!field) return;
		field.input.classList.toggle("mod-warning", !!message);
		field.input.setAttribute("aria-invalid", String(!!message));
		field.error.setText(message);
		if (focus) field.input.focus();
	}

  private save(): void {
    const p = this.provider;
    if (!p.id || !p.type?.trim()) {
      new Notice("Provider name is required.");
			this.setFieldError(this.nameField, "Provider name is required.", true);
      return;
    }

    if (
      !isGeminiType(p.type) &&
      !isVertexType(p.type) &&
      !isCodexType(p.type) &&
      !p.baseUrl?.trim()
    ) {
      new Notice("Base URL is required.");
			this.setFieldError(this.baseUrlField, "Base URL is required.", true);
      return;
    }

    const provider: LLMProvider = {
      id: p.id!,
      type: p.type!,
      baseUrl: isGeminiType(p.type!) ? GEMINI_BASE_URL : (p.baseUrl ?? ""),
      apiKey: p.apiKey ?? "",
      enabled: p.enabled ?? true,
			geminiNative: isBifrostProvider(p) && (p.geminiNative ?? false),
			capabilityReport: p.capabilityReport,
      projectId: p.projectId,
      location: p.location,
      serviceAccountJson: p.serviceAccountJson,
      binaryPath: p.binaryPath,
    };

    const models: LLMModel[] = [...this.selectedModelIds].map((modelId) => {
      const existing = this.existingModels.find((m) => m.model === modelId);
      const price = this.pricingData?.get(modelId);
      const defaultParams = getDefaultProviderParams(modelId, provider.type);
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
        providerParams:
          this.modelParams.get(modelId) ??
          existing?.providerParams ??
          (Object.keys(defaultParams).length > 0 ? defaultParams : undefined),
      };
    });

    this.onSave(provider, models);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
