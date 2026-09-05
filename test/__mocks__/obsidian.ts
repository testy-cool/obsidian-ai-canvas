// Mock Obsidian module for testing
export class Notice {
	constructor(message: string, timeout?: number) {}
}

export class App {}

export class TFile {}

export function loadPdfJs() {
	return Promise.resolve({ getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }) });
}

export class Plugin {}

export class PluginSettingTab {}

export class Setting {
	settingEl: HTMLElement;
	infoEl: HTMLElement;
	controlEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;
	constructor(containerEl: HTMLElement) {
		this.settingEl = containerEl.createDiv("setting-item");
		this.infoEl = this.settingEl.createDiv("setting-item-info");
		this.nameEl = this.infoEl.createDiv("setting-item-name");
		this.descEl = this.infoEl.createDiv("setting-item-description");
		this.controlEl = this.settingEl.createDiv("setting-item-control");
	}
	setName(name: string) { this.nameEl.setText(name); return this; }
	setDesc(desc: string) { this.descEl.setText(desc); return this; }
	setHeading() { this.settingEl.addClass("setting-item-heading"); return this; }
	addText(cb: (text: any) => void) { cb(new TextComponent(this.controlEl)); return this; }
	addTextArea(cb: (text: any) => void) { cb(new TextAreaComponent(this.controlEl)); return this; }
	addDropdown(cb: (dropdown: any) => void) { cb(new DropdownComponent(this.controlEl)); return this; }
	addToggle(cb: (toggle: any) => void) { cb(new ToggleComponent(this.controlEl)); return this; }
	addButton(cb: (button: any) => void) { cb(new ButtonComponent(this.controlEl)); return this; }
	addSlider(cb: (slider: any) => void) { return this; }
}

export class Modal {
	app: App;
	contentEl: HTMLElement = document.createElement('div');
	constructor(app: App) { this.app = app; }
	setTitle(title: string) { return this; }
	open() {}
	close() {}
	onOpen() {}
	onClose() {}
}

export class FuzzySuggestModal extends Modal {}
export class SuggestModal extends Modal {
	inputEl = this.contentEl.createEl("input");
}

export class ButtonComponent {
	buttonEl: HTMLButtonElement;
	constructor(containerEl: HTMLElement) { this.buttonEl = containerEl.createEl("button"); }
	setButtonText(text: string) { this.buttonEl.setText(text); return this; }
	setCta() { return this; }
	setDisabled(disabled: boolean) { this.buttonEl.disabled = disabled; return this; }
	setTooltip(tooltip: string) { return this; }
	onClick(cb: () => void) { this.buttonEl.addEventListener("click", cb); return this; }
}

export class TextComponent {
	inputEl: HTMLInputElement;
	constructor(containerEl?: HTMLElement) { this.inputEl = containerEl ? containerEl.createEl("input") : document.createElement("input"); }
	setValue(value: string) { this.inputEl.value = value; return this; }
	getValue() { return this.inputEl.value; }
	setPlaceholder(placeholder: string) { this.inputEl.placeholder = placeholder; return this; }
	setDisabled(disabled: boolean) { this.inputEl.disabled = disabled; return this; }
	onChange(cb: (value: string) => void) { this.inputEl.addEventListener("input", () => cb(this.inputEl.value)); return this; }
}

export class TextAreaComponent {
	inputEl: HTMLTextAreaElement;
	constructor(containerEl?: HTMLElement) { this.inputEl = containerEl ? containerEl.createEl("textarea") : document.createElement("textarea"); }
	setValue(value: string) { this.inputEl.value = value; return this; }
	getValue() { return this.inputEl.value; }
	setPlaceholder(placeholder: string) { this.inputEl.placeholder = placeholder; return this; }
	onChange(cb: (value: string) => void) { this.inputEl.addEventListener("input", () => cb(this.inputEl.value)); return this; }
}

export class DropdownComponent {
	selectEl: HTMLSelectElement;
	constructor(containerEl: HTMLElement) { this.selectEl = containerEl.createEl("select"); }
	addOption(value: string, display: string) { this.selectEl.createEl("option", { text: display }).value = value; return this; }
	addOptions(options: Record<string, string>) { for (const [value, display] of Object.entries(options)) this.addOption(value, display); return this; }
	setValue(value: string) { this.selectEl.value = value; return this; }
	getValue() { return this.selectEl.value; }
	setDisabled(disabled: boolean) { this.selectEl.disabled = disabled; return this; }
	onChange(cb: (value: string) => void) { this.selectEl.addEventListener("change", () => cb(this.selectEl.value)); return this; }
}

export class ToggleComponent {
	toggleEl: HTMLInputElement;
	constructor(containerEl: HTMLElement) {
		this.toggleEl = containerEl.createEl("input");
		this.toggleEl.type = "checkbox";
	}
	setValue(value: boolean) { this.toggleEl.checked = value; return this; }
	setDisabled(disabled: boolean) { this.toggleEl.disabled = disabled; return this; }
	getValue() { return this.toggleEl.checked; }
	setTooltip(tooltip: string) { return this; }
	onChange(cb: (value: boolean) => void) { this.toggleEl.addEventListener("change", () => cb(this.toggleEl.checked)); return this; }
}

export class ItemView {}

export function requestUrl(options: any) {
	return Promise.resolve({ json: {}, text: '' });
}

export function setIcon(element: { setAttribute(name: string, value: string): void }, icon: string) {
	element.setAttribute('data-icon', icon);
}

export function setTooltip(element: { setAttribute(name: string, value: string): void }, text: string, options?: any) {
	element.setAttribute('aria-label', text);
}

export function debounce<T extends (...args: any[]) => any>(callback: T) {
	return callback;
}

// Mutable so individual tests can flip isDesktopApp to exercise the mobile/
// desktop branches of code that gates on it (e.g. codexCli.ts).
export const Platform = {
	isDesktop: true,
	isMobile: false,
	isDesktopApp: true,
	isMobileApp: false,
	isIosApp: false,
	isAndroidApp: false,
};
