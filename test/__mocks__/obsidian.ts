// Mock Obsidian module for testing
export class Notice {
	constructor(message: string, timeout?: number) {}
}

export class App {}

export class Plugin {}

export class PluginSettingTab {}

export class Setting {
	setName(name: string) { return this; }
	setDesc(desc: string) { return this; }
	setHeading() { return this; }
	addText(cb: (text: any) => void) { return this; }
	addTextArea(cb: (text: any) => void) { return this; }
	addDropdown(cb: (dropdown: any) => void) { return this; }
	addToggle(cb: (toggle: any) => void) { return this; }
	addButton(cb: (button: any) => void) { return this; }
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

export class ButtonComponent {
	setButtonText(text: string) { return this; }
	setCta() { return this; }
	setDisabled(disabled: boolean) { return this; }
	setTooltip(tooltip: string) { return this; }
	onClick(cb: () => void) { return this; }
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
	setValue(value: boolean) { return this; }
	getValue() { return false; }
	setTooltip(tooltip: string) { return this; }
	onChange(cb: (value: boolean) => void) { return this; }
}

export class ItemView {}

export function requestUrl(options: any) {
	return Promise.resolve({ json: {}, text: '' });
}
