import { App, Modal, Setting, ToggleComponent } from "obsidian";

export interface PromptContextOption {
	id: string;
	depth: number;
	preview: string;
}

export class PromptContextModal extends Modal {
	private readonly selectedNodeIds: Set<string>;

	constructor(
		app: App,
		private readonly options: PromptContextOption[],
		private readonly onSubmit: (selectedNodeIds: ReadonlySet<string>) => void
	) {
		super(app);
		this.selectedNodeIds = new Set(options.map((option) => option.id));
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("prompt-context-modal");
		this.setTitle("Choose prompt context");

		contentEl.createEl("p", {
			text: "Choose which connected cards contribute to this request. Your arrows stay unchanged.",
			cls: "prompt-context-description",
		});

		const summaryEl = contentEl.createDiv({
			cls: "prompt-context-summary",
			attr: { "aria-live": "polite" },
		});
		const toggles = new Map<string, ToggleComponent>();
		const currentNodeId = this.options[0]?.id;
		const updateSummary = () => {
			summaryEl.setText(
				`${this.selectedNodeIds.size} of ${this.options.length} cards selected`
			);
		};

		const toolbarEl = contentEl.createDiv({ cls: "prompt-context-toolbar" });
		const selectAllButton = toolbarEl.createEl("button", { text: "Select all" });
		selectAllButton.addEventListener("click", () => {
			for (const option of this.options) {
				this.selectedNodeIds.add(option.id);
				toggles.get(option.id)?.setValue(true);
			}
			updateSummary();
		});
		const onlyCurrentButton = toolbarEl.createEl("button", {
			text: "Only current card",
		});
		onlyCurrentButton.addEventListener("click", () => {
			this.selectedNodeIds.clear();
			if (currentNodeId) this.selectedNodeIds.add(currentNodeId);
			for (const option of this.options) {
				toggles.get(option.id)?.setValue(option.id === currentNodeId);
			}
			updateSummary();
		});

		const listEl = contentEl.createDiv({ cls: "prompt-context-list" });
		for (const option of this.options) {
			const isCurrent = option.id === currentNodeId;
			const setting = new Setting(listEl)
				.setName(
					isCurrent
						? "Current card"
						: `${option.depth} step${option.depth === 1 ? "" : "s"} back`
				)
				.setDesc(option.preview || "Card with no text label");
			setting.settingEl.addClass("prompt-context-option");
			setting.addToggle((toggle) => {
				toggles.set(option.id, toggle);
				toggle.setValue(true);
				if (isCurrent) toggle.setDisabled(true);
				toggle.onChange((selected) => {
					if (selected) {
						this.selectedNodeIds.add(option.id);
					} else if (!isCurrent) {
						this.selectedNodeIds.delete(option.id);
					}
					updateSummary();
				});
			});
		}

		updateSummary();

		const actionsEl = contentEl.createDiv({ cls: "prompt-context-actions" });
		const cancelButton = actionsEl.createEl("button", { text: "Cancel" });
		cancelButton.addEventListener("click", () => this.close());
		const continueButton = actionsEl.createEl("button", {
			text: "Continue",
			cls: "mod-cta",
		});
		continueButton.addEventListener("click", () => {
			this.close();
			this.onSubmit(new Set(this.selectedNodeIds));
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
