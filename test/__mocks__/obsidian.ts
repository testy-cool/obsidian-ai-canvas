// Mock Obsidian module for testing
export class Notice {
	constructor(message: string, timeout?: number) {}
}

export class App {}

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
	addText(cb: (text: any) => void) { return this; }
	addTextArea(cb: (text: any) => void) { return this; }
	addDropdown(cb: (dropdown: any) => void) { return this; }
	addToggle(cb: (toggle: any) => void) { cb(new ToggleComponent(this.controlEl)); return this; }
	addButton(cb: (button: any) => void) { cb(new ButtonComponent(this.controlEl)); return this; }
	addSlider(cb: (slider: any) => void) { return this; }
}

export class Modal {
	app: App;
	contentEl: HTMLElement = document.createElement('div');
	constructor(app: App) { this.app = app; }
	open() {}
	close() {}
	onOpen() {}
	onClose() {}
}

export class FuzzySuggestModal extends Modal {}
export class SuggestModal extends Modal {}

export class ButtonComponent {
	buttonEl: HTMLButtonElement;
	constructor(containerEl: HTMLElement) { this.buttonEl = containerEl.createEl("button"); }
	setButtonText(text: string) { this.buttonEl.setText(text); return this; }
	setCta() { return this; }
	setDisabled(disabled: boolean) { return this; }
	setTooltip(tooltip: string) { return this; }
	onClick(cb: () => void) { this.buttonEl.addEventListener("click", cb); return this; }
}

export class TextComponent {
	inputEl: HTMLInputElement = document.createElement('input');
	setValue(value: string) { return this; }
	getValue() { return ''; }
	setPlaceholder(placeholder: string) { return this; }
	setDisabled(disabled: boolean) { return this; }
	onChange(cb: (value: string) => void) { return this; }
}

export class TextAreaComponent {
	inputEl: HTMLTextAreaElement = document.createElement('textarea');
	setValue(value: string) { return this; }
	getValue() { return ''; }
	setPlaceholder(placeholder: string) { return this; }
	onChange(cb: (value: string) => void) { return this; }
}

export class ToggleComponent {
	toggleEl: HTMLInputElement;
	constructor(containerEl: HTMLElement) {
		this.toggleEl = containerEl.createEl("input");
		this.toggleEl.type = "checkbox";
	}
	setValue(value: boolean) { this.toggleEl.checked = value; return this; }
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
