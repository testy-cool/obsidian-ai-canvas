import { App, Modal, Notice, TextComponent } from "obsidian";
import { LLMProvider } from "../settings/AugmentedCanvasSettings";
import { fetchProviderModels } from "../utils/modelFetch";

export class ModelFetchModal extends Modal {
	private provider: LLMProvider;
	private modelIds: string[] = [];
	private enabledIds: Set<string>;
	private selectedIds: Set<string>;
	private filterText = "";
	private customModel = "";
	private onConfirm: (selected: string[]) => void;

	constructor(
		app: App,
		provider: LLMProvider,
		enabledIds: string[],
		onConfirm: (selected: string[]) => void
	) {
		super(app);
		this.provider = provider;
		this.enabledIds = new Set(enabledIds);
		this.selectedIds = new Set(enabledIds);
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("augmented-canvas-modal-container");

		contentEl.createEl("h3", {
			text: `Add ${this.provider.type} models`,
		});

		contentEl.createEl("p", {
			text: "Fetch models from the provider and select the ones you want enabled.",
			cls: "mod-muted",
		});

		const actionRow = contentEl.createDiv("model-fetch-actions");
		const fetchButton = actionRow.createEl("button", {
			text: "Fetch models",
		});
		fetchButton.addEventListener("click", async () => {
			await this.fetchModels(fetchButton as HTMLButtonElement);
		});

		const selectAllButton = actionRow.createEl("button", {
			text: "Select all",
		});
		selectAllButton.addEventListener("click", () => {
			this.modelIds.forEach(id => this.selectedIds.add(id));
			this.renderList();
		});

		const clearButton = actionRow.createEl("button", {
			text: "Clear",
		});
		clearButton.addEventListener("click", () => {
			this.selectedIds.clear();
			this.renderList();
		});

		const filterRow = contentEl.createDiv("model-fetch-filter");
		filterRow.createEl("span", { text: "Filter" });
		const filterInput = new TextComponent(filterRow);
		filterInput.setPlaceholder("Type to filter");
		filterInput.inputEl.type = "search";
		filterInput.onChange(value => {
			this.filterText = value;
			this.renderList();
		});

		contentEl.createDiv("model-fetch-status");

		this.renderList();

		const customRow = contentEl.createDiv("model-fetch-custom");
		customRow.createEl("span", { text: "Custom model" });
		const customInput = new TextComponent(customRow);
		customInput.setPlaceholder("e.g., gemini-1.5-pro-latest");
		customInput.onChange(value => {
			this.customModel = value;
		});

		const footerEl = contentEl.createDiv("modal-button-container");
		const cancelBtn = footerEl.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => {
			this.close();
		});

		const submitBtn = footerEl.createEl("button", {
			text: "Enable selected",
			cls: "mod-cta",
		});
		submitBtn.addEventListener("click", () => {
			const selections = new Set(this.selectedIds);
			const custom = this.customModel.trim();
			if (custom) {
				selections.add(custom);
			}

			if (!selections.size) {
				new Notice("Select at least one model.");
				return;
			}

			this.onConfirm(Array.from(selections));
			this.close();
		});
	}

	private isVertexProvider() {
		const type = this.provider.type.toLowerCase();
		return type === "vertex";
	}

	private async fetchModels(button: HTMLButtonElement) {
		const isVertex = this.isVertexProvider();
		if (isVertex && !this.provider.serviceAccountJson) {
			new Notice(`${this.provider.type} service account JSON is required to fetch models.`);
			return;
		}
		if (!isVertex && !this.provider.apiKey) {
			new Notice(`${this.provider.type} API key is required to fetch models.`);
			return;
		}

		button.disabled = true;
		const previousLabel = button.textContent;
		button.textContent = "Fetching...";
		this.setStatus("Fetching models...");

		try {
			const modelIds = await fetchProviderModels(this.provider, this.provider.apiKey);
			this.modelIds = modelIds.sort((a, b) => a.localeCompare(b));
			this.selectedIds = new Set(
				this.modelIds.filter(id => this.enabledIds.has(id))
			);

			if (!this.modelIds.length) {
				this.setStatus("No models returned.");
				new Notice(`No models returned for ${this.provider.type}.`);
			} else {
				this.setStatus(`Fetched ${this.modelIds.length} models.`);
			}
			this.renderList();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.setStatus("Failed to fetch models.");
			new Notice(`Failed to fetch models: ${message}`);
		} finally {
			button.disabled = false;
			button.textContent = previousLabel ?? "Fetch models";
		}
	}

	private setStatus(message: string) {
		const statusEl = this.contentEl.querySelector(".model-fetch-status") as HTMLElement | null;
		if (statusEl) {
			statusEl.setText(message);
		}
	}

	private renderList() {
		const { contentEl } = this;
		let listContainer = contentEl.querySelector(".model-fetch-list") as HTMLElement | null;
		if (!listContainer) {
			listContainer = contentEl.createDiv("model-fetch-list");
		}
		listContainer.empty();

		if (!this.modelIds.length) {
			listContainer.createDiv({
				text: "No models fetched yet. Click Fetch models to load.",
				cls: "mod-muted",
			});
			return;
		}

		const normalizedFilter = this.filterText.trim().toLowerCase();
		const filtered = this.modelIds.filter(id => {
			if (!normalizedFilter) return true;
			return id.toLowerCase().includes(normalizedFilter);
		});

		if (!filtered.length) {
			listContainer.createDiv({ text: "No models match the filter.", cls: "mod-muted" });
			return;
		}

		filtered.forEach(modelId => {
			const row = listContainer!.createDiv("model-fetch-row");
			const checkbox = row.createEl("input", { type: "checkbox" });
			checkbox.checked = this.selectedIds.has(modelId);
			checkbox.addEventListener("change", () => {
				if (checkbox.checked) {
					this.selectedIds.add(modelId);
				} else {
					this.selectedIds.delete(modelId);
				}
			});
			row.createEl("span", { text: modelId });
		});
	}
}
