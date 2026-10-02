import { App, Modal, Setting, Notice, ButtonComponent } from "obsidian";
import type { LLMProvider, LLMModel } from "../settings/AugmentedCanvasSettings";
import { GEMINI_BASE_URL } from "../settings/AugmentedCanvasSettings";
import { isBifrostProvider, providerLabel } from "../utils/providerCapabilities";
import { fetchProviderModels } from "../utils/modelFetch";
import { fetchPricingForModels } from "../utils/pricingFetch";
import { getDefaultProviderParams, getParamsForModel, detectProviderLabel } from "../utils/providerParams";
import { findCodexBinary, CODEX_MODELS, listCodexModels } from "../utils/codexCli";
import { CLI_ADAPTERS, cliAdapterForProviderType, findCliBinary } from "../utils/localCli";

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
  { id: "bifrost", type: "Bifrost", baseUrl: "" },
  { id: "azure", type: "Azure", baseUrl: "" },
  { id: "gemini", type: "Gemini", baseUrl: GEMINI_BASE_URL },
  { id: "vertex", type: "Vertex", baseUrl: "" },
  { id: "ollama", type: "Ollama", baseUrl: "http://localhost:11434/v1" },
  { id: "codex", type: "Codex", baseUrl: "" },
  { id: "claude-cli", type: CLI_ADAPTERS.claude.providerType, baseUrl: "" },
  { id: "pi-cli", type: CLI_ADAPTERS.pi.providerType, baseUrl: "" },
  { id: "hermes-cli", type: CLI_ADAPTERS.hermes.providerType, baseUrl: "" },
  { id: "local-command", type: CLI_ADAPTERS.custom.providerType, baseUrl: "" },
  { id: "custom", type: "Custom", baseUrl: "" },
];

/** Ids that older settings read as a kind of provider, and the kinds that may use them. */
const KIND_IDS = new Map<string, string[]>([
  ["gemini", ["Gemini", "Google"]],
  ["google", ["Gemini", "Google"]],
  ["vertex", ["Vertex"]],
  ["azure", ["Azure"]],
  ["ollama", ["Ollama"]],
]);

const NO_MODELS_RETURNED = "No models returned. Type model names below.";

function isGeminiType(type: string): boolean {
  return ["Gemini", "Google"].includes(type);
}

function isVertexType(type: string): boolean {
  return type === "Vertex";
}

function isCodexType(type: string): boolean {
  return type === "Codex";
}

/** Kinds that are called through an OpenAI-compatible endpoint, so a gateway may stand behind any of them. */
function takesOpenAIRoute(type: string): boolean {
  return !isGeminiType(type) && !isVertexType(type) && !isCodexType(type) && type !== "Azure" && !cliAdapterForProviderType(type);
}

/**
 * Everything a provider that runs a local command needs from the UI. Codex keeps
 * its own runner, so it is described here rather than in the adapter registry.
 */
function localCliUi(type: string) {
  if (isCodexType(type)) {
    return {
      label: "Codex binary",
      placeholder: "/path/to/codex (optional override)",
      models: [...CODEX_MODELS],
      detect: (override?: string) => findCodexBinary(override),
      listModels: (binary: string) => listCodexModels(binary),
      hint: "Not found — install with `npm i -g @openai/codex` or set the path here.",
      takesArgs: false,
    };
  }
  const adapter = cliAdapterForProviderType(type);
  if (!adapter) return null;
  return {
    label: adapter.binary ? `${adapter.providerType} binary` : "Command to run",
    placeholder: adapter.binary ? `/path/to/${adapter.binary} (optional override)` : "/path/to/command",
    models: [...adapter.models],
    detect: (override?: string) => findCliBinary(adapter, override),
    listModels: undefined as ((binary: string) => Promise<string[] | null>) | undefined,
    hint: adapter.installHint,
    takesArgs: true,
  };
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
	private initialProvider?: LLMProvider;
  private binaryInput: HTMLInputElement | undefined;
  private pricingData: Map<string, { inputCostPerMillion: number; outputCostPerMillion: number; cachedInputCostPerMillion?: number }> | undefined;
  private modelParams = new Map<string, Record<string, unknown>>();
  private expandedParams = new Set<string>();

  constructor(
    app: App,
    private onSave: (provider: LLMProvider, models: LLMModel[]) => void,
    existingProvider?: LLMProvider,
    private existingModels: LLMModel[] = [],
    private otherProviders: LLMProvider[] = []
  ) {
    super(app);
		this.initialProvider = existingProvider ? { ...existingProvider } : undefined;
    this.editing = !!existingProvider;
    this.provider = existingProvider
      ? { ...existingProvider }
      : { enabled: true };

    if (existingProvider) {
      this.selectedModelIds = new Set(
        existingModels.filter((m) => m.enabled).map((m) => m.model)
      );
      // Edit opens with the provider's own models listed, on or off.
      this.fetchedModelIds = existingModels.map((m) => m.model);
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
            this.provider.type = preset.type;
            this.provider.name = preset.type;
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
        if (this.provider.type) {
          dd.setValue(
            PRESETS.find((p) => p.type === this.provider.type)?.id ?? ""
          );
        }
      });
    }

    // --- Provider name ---
		// eslint-disable-next-line prefer-const -- assigned further down, read in callbacks
		let geminiNativeSetting: Setting | undefined;
		const nameSetting = new Setting(contentEl).setName("Provider name");
		nameSetting.controlEl.addClass("ac-settings-field");
		nameSetting.addText((text) => {
			this.nameField = { input: text.inputEl, error: nameSetting.controlEl.createDiv("ac-setting-error") };
			this.nameField.error.setAttribute("aria-live", "polite");
      text
        .setPlaceholder("My Provider")
        .setValue(this.displayName())
        .onChange((val) => {
          this.provider.name = val;
					if (val.trim()) this.setFieldError(this.nameField, "");
					if (geminiNativeSetting) geminiNativeSetting.settingEl.style.display = isBifrostProvider(this.provider) ? "" : "none";
        });
    });

		geminiNativeSetting = new Setting(contentEl)
			.setName("Use Gemini-native API")
			.setDesc("Use Google's request format for Gemini models through Bifrost. Enables testing of YouTube input, Google Search and URL context. Support depends on the selected model.")
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
			this.binaryInput = text.inputEl;
			text.setPlaceholder("/path/to/codex (optional override)")
				.setValue(this.provider.binaryPath ?? "")
				.onChange(val => { this.provider.binaryPath = val || undefined; });
		});

		const cliArgsSetting = new Setting(contentEl)
			.setName("Extra arguments")
			.setDesc("Added to every call, separated by spaces. Quoted arguments are not supported.")
			.addText(text => {
				text.setPlaceholder("--provider openrouter")
					.setValue(this.provider.cliArgs ?? "")
					.onChange(val => { this.provider.cliArgs = val || undefined; });
			});

		// Built further down; the first call of updateProviderFields runs before it exists.
		// eslint-disable-next-line prefer-const -- assigned below, read in updateProviderFields
		let connSetting: Setting | undefined;

		const updateProviderFields = () => {
			const type = this.provider.type ?? "";
			const gemini = isGeminiType(type);
			const vertex = isVertexType(type);
			const cli = localCliUi(type);
			const codex = !!cli;
			const azure = type === "Azure";
			this.nameField!.input.value = this.displayName();
			this.baseUrlField!.input.value = this.provider.baseUrl ?? "";
			this.baseUrlField!.input.placeholder = azure
				? "https://<resource>.services.ai.azure.com" : "https://api.example.com/v1";
			baseUrlSetting.setDesc(azure
				? "Azure OpenAI resource endpoint — no path, no api-version" : isBifrostProvider(this.provider)
					? "Bifrost gateway address. Keep /v1 here when Gemini-native API is enabled." : "OpenAI-compatible endpoint.");
			baseUrlSetting.settingEl.style.display = gemini || vertex || codex ? "none" : "";
			apiKeyInput.placeholder = gemini ? "Google API key" : "sk-...";
			apiKeySetting.settingEl.style.display = vertex || codex ? "none" : "";
			for (const setting of [projectSetting, locationSetting, serviceAccountSetting]) {
				setting.settingEl.style.display = vertex ? "" : "none";
			}
			codexSetting.settingEl.style.display = cli ? "" : "none";
			cliArgsSetting.settingEl.style.display = cli?.takesArgs ? "" : "none";
			if (cli) {
				codexSetting.setName(cli.label);
				if (this.binaryInput) this.binaryInput.placeholder = cli.placeholder;
				const detected = cli.detect(this.provider.binaryPath);
				codexSetting.setDesc(detected ? `Detected: ${detected}` : cli.hint);
			}
			geminiNativeSetting!.settingEl.style.display = isBifrostProvider(this.provider) ? "" : "none";
			// Vertex has no model list to fetch.
			if (connSetting) connSetting.settingEl.style.display = vertex ? "none" : "";
		};
		updateProviderFields();

    // --- Test connection + Fetch models ---
    connSetting = new Setting(contentEl).setName("Available models")
			.setDesc("Fetch the model list with these credentials. Test model capabilities from the Providers tab.");
		connSetting.settingEl.style.display = isVertexType(this.provider.type ?? "") ? "none" : "";
    // eslint-disable-next-line prefer-const -- assigned inside addButton below
    let connStatus: HTMLElement;

    connSetting.addButton((btn: ButtonComponent) => {
			btn.buttonEl.addClass("provider-fetch-button");
      btn.setButtonText("Fetch models").onClick(async () => {
				const fetchVersion = this.modelFetchVersion;
        btn.setDisabled(true);
        btn.setButtonText("Fetching…");
        connStatus?.setText("");
        try {
          const cliUi = localCliUi(this.provider.type ?? "");
          if (cliUi) {
            const detected = cliUi.detect(this.provider.binaryPath);
            const listed = detected && cliUi.listModels ? await cliUi.listModels(detected) : null;
            if (fetchVersion !== this.modelFetchVersion) return;
            this.addToModelList(listed ?? cliUi.models);
            connStatus?.setText(
              !detected
                ? `Not found. ${cliUi.hint}`
                : listed?.length === 0
                  ? NO_MODELS_RETURNED
                : listed
                  ? `Found ${listed.length} models`
                  : cliUi.listModels
                    ? `Could not read the model list, showing ${cliUi.models.length} known models`
                    : `Found ${cliUi.models.length} models`
            );
            const empty = !detected || listed?.length === 0;
            connStatus?.toggleClass("mod-success", !empty);
            connStatus?.toggleClass("mod-warning", empty);
            this.renderModelList();
            return;
          }

          const models = await fetchProviderModels({ ...this.provider } as LLMProvider);
					if (fetchVersion !== this.modelFetchVersion) return;
          this.addToModelList(models);
          this.renderLimit = UnifiedProviderModal.MODEL_PAGE_SIZE;
          connStatus?.setText(models.length ? `Found ${models.length} models` : NO_MODELS_RETURNED);
          connStatus?.toggleClass("mod-success", models.length > 0);
          connStatus?.toggleClass("mod-warning", models.length === 0);

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
					const raw = e instanceof Error ? e.message : String(e);
					const message = this.provider.apiKey ? raw.split(this.provider.apiKey).join("[redacted]") : raw;
					connStatus?.setText(/\b401\b/.test(message)
						? "Authentication failed (HTTP 401). Check the API key for this provider."
						: /\b403\b/.test(message) ? "Model listing denied (HTTP 403). Check this key's access."
							: `Could not fetch models: ${message}`);
          connStatus?.addClass("mod-warning");
          connStatus?.removeClass("mod-success");
        } finally {
          btn.setDisabled(false);
          btn.setButtonText("Fetch models");
        }
      });
    });
    // The status needs a row of its own; the control is a single flex line by default.
    connSetting.controlEl.addClass("provider-fetch-control");
    connStatus = connSetting.controlEl.createEl("span", {
      cls: "setting-item-description provider-fetch-status",
    });
		connStatus.setAttribute("role", "status");

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

  /** What the name field shows: the name typed, else the kind of an existing provider. */
  private displayName(): string {
    return this.provider.name ?? (this.editing ? providerLabel(this.provider as LLMProvider) : "");
  }

  /**
   * The id for a new provider: the slug of its name, numbered if another provider has it.
   * An id that older settings read as a kind (such as "azure") is taken unless this is that kind.
   */
  private freeId(name: string, type: string, others: LLMProvider[]): string {
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    const taken = new Set(others.map((o) => o.id));
    const isTaken = (id: string) => taken.has(id) || !(KIND_IDS.get(id)?.includes(type) ?? true);
    let id = slug;
    for (let n = 2; isTaken(id); n++) id = `${slug}-${n}`;
    return id;
  }

  /** Fetched models join the list; ones already there or typed by hand stay. */
  private addToModelList(ids: string[]): void {
    this.fetchedModelIds = [...new Set([...this.fetchedModelIds, ...ids])];
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
        text: isVertexType(this.provider.type ?? "")
          ? "Vertex has no model list. Type model names below."
          : 'Click "Fetch models" to load available models.',
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
    const name = this.displayName().trim();
    const others = this.otherProviders.filter((o) => o.id !== this.initialProvider?.id);
    // No preset chosen means an OpenAI-compatible endpoint.
    let type = p.type?.trim() || "Custom";
    // A gateway recognised by its name or address is stored as one whatever preset it was added with, so renaming it later cannot switch off its Gemini-native setting.
    if (takesOpenAIRoute(type) && (isBifrostProvider({ ...p, name }) || isBifrostProvider(this.initialProvider))) type = "Bifrost";
    if (!name) {
      new Notice("Provider name is required.");
			this.setFieldError(this.nameField, "Provider name is required.", true);
      return;
    }

    if (others.some((o) => providerLabel(o).toLowerCase() === name.toLowerCase())) {
      this.setFieldError(this.nameField, "Another provider already has this name.", true);
      return;
    }

    if (
      !isGeminiType(type) &&
      !isVertexType(type) &&
      !isCodexType(type) &&
      !cliAdapterForProviderType(type) &&
      !p.baseUrl?.trim()
    ) {
      new Notice("Base URL is required.");
			this.setFieldError(this.baseUrlField, "Base URL is required.", true);
      return;
    }

    const provider: LLMProvider = {
      // Fields this box does not show stay as they were.
      ...this.initialProvider,
      id: this.initialProvider?.id ?? this.freeId(name, type, others),
      type,
      baseUrl: isGeminiType(type) ? GEMINI_BASE_URL : (p.baseUrl ?? ""),
      apiKey: p.apiKey ?? "",
      enabled: p.enabled ?? true,
			geminiNative: isBifrostProvider({ ...p, type }) && (p.geminiNative ?? false),
			capabilityReport: p.capabilityReport,
			capabilityReports: p.capabilityReports,
      projectId: p.projectId,
      location: p.location,
      serviceAccountJson: p.serviceAccountJson,
      binaryPath: p.binaryPath,
      cliArgs: p.cliArgs,
    };
    // Saved data only carries a name when it differs from the kind.
    if (name !== type) provider.name = name;
    else delete provider.name;

		if (this.initialProvider && ["apiKey", "baseUrl", "type", "geminiNative", "projectId", "location", "serviceAccountJson"].some(key =>
			key === "geminiNative" ? !!provider.geminiNative !== !!this.initialProvider!.geminiNative
				: (provider as any)[key] !== (this.initialProvider as any)[key])) {
			provider.capabilityReport = undefined;
			provider.capabilityReports = undefined;
		}

    const ticked: LLMModel[] = [...this.selectedModelIds].map((modelId) => {
      const existing = this.existingModels.find((m) => m.model === modelId);
      const price = this.pricingData?.get(modelId);
      const defaultParams = getDefaultProviderParams(modelId, provider.type);
      return {
        // Keep what the box does not show (kind, manual-price flag) and the id
        // that settings such as the active model may already point at.
        ...existing,
        id: existing?.id ?? `${provider.id}-${modelId}`,
        providerId: provider.id,
        model: modelId,
        enabled: true,
        timeoutMs: existing?.timeoutMs,
        maxRetries: existing?.maxRetries,
        inputCostPerMillion: existing?.costOverridden
          ? existing.inputCostPerMillion
          : (price?.inputCostPerMillion ?? existing?.inputCostPerMillion),
        outputCostPerMillion: existing?.costOverridden
          ? existing.outputCostPerMillion
          : (price?.outputCostPerMillion ?? existing?.outputCostPerMillion),
        // A manual cost override covers the two rates the user can type, so the
        // published cache rate still applies underneath it.
        cachedInputCostPerMillion: price?.cachedInputCostPerMillion ?? existing?.cachedInputCostPerMillion,
        providerParams:
          this.modelParams.get(modelId) ??
          existing?.providerParams ??
          (Object.keys(defaultParams).length > 0 ? defaultParams : undefined),
      };
    });

    // A model the provider already has stays in its list, switched off, when it is not ticked.
    const switchedOff: LLMModel[] = this.existingModels
      .filter((m) => !this.selectedModelIds.has(m.model))
      .map((m) => ({
        ...m,
        enabled: false,
        providerParams: this.modelParams.get(m.model) ?? m.providerParams,
      }));

    this.onSave(provider, [...ticked, ...switchedOff]);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
