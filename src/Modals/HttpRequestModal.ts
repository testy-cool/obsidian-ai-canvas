import { App, ButtonComponent, Modal, Setting, TextAreaComponent, TextComponent } from "obsidian";
import { buildHttpRequest, DEFAULT_HTTP_REQUEST, HTTP_METHODS, HttpRequestConfig } from "../utils/httpRequest";

export class HttpRequestModal extends Modal {
	private config: HttpRequestConfig;

	constructor(app: App, initial: HttpRequestConfig | undefined, private onSave: (config: HttpRequestConfig) => void) {
		super(app);
		this.config = { ...(initial ?? DEFAULT_HTTP_REQUEST) };
	}

	onOpen() {
		this.setTitle("HTTP request");
		this.contentEl.addClass("http-request-modal");
		const form = this.contentEl.createEl("form");
		let urlInput: HTMLInputElement;
		new Setting(form).setName("Method").addDropdown(dropdown => {
			for (const method of HTTP_METHODS) dropdown.addOption(method, method);
			dropdown.setValue(this.config.method).onChange(value => {
				this.config.method = value as HttpRequestConfig["method"];
				bodyInput.disabled = ["GET", "HEAD"].includes(value);
			});
			dropdown.selectEl.setAttribute("aria-label", "HTTP method");
		});
		new Setting(form).setName("URL").addText(input => {
			input.setValue(this.config.url).setPlaceholder("https://api.example.com/items")
				.onChange(value => { this.config.url = value; });
			urlInput = input.inputEl;
			urlInput.setAttribute("aria-label", "Request URL");
		});
		const addArea = (label: string, name: "query" | "headers" | "body", description: string, placeholder: string) => {
			new Setting(form).setName(label).setDesc(description);
			const input = new TextAreaComponent(form).setValue(this.config[name]).setPlaceholder(placeholder)
				.onChange(value => { this.config[name] = value; });
			input.inputEl.setAttribute("aria-label", label);
			input.inputEl.spellcheck = false;
			return input.inputEl;
		};
		addArea("Query parameters", "query", "URL-encoded name=value pairs, one per line. Added to any parameters in the URL.", "limit=10\nq=hello+world");
		addArea("Headers", "headers", "One Name: value per line. Use Authorization here for other authentication schemes.", "Content-Type: application/json");
		new Setting(form).setName("Bearer token").setDesc("Optional. Overrides an Authorization header.");
		const token = new TextComponent(form).setValue(this.config.bearerToken)
			.onChange(value => { this.config.bearerToken = value; }).inputEl;
		token.type = "password";
		token.setAttribute("aria-label", "Bearer token");
		token.autocomplete = "off";
		const bodyInput = addArea("Body", "body", "Sent verbatim. Set Content-Type in Headers when needed. GET and HEAD have no body.", '{"name": "example"}');
		bodyInput.disabled = ["GET", "HEAD"].includes(this.config.method);
		form.createEl("p", { cls: "http-request-storage-note", text: "Saved in this canvas file, including headers and tokens. Common authentication headers are hidden from card text." });
		const error = form.createEl("p", { cls: "http-request-error" });
		error.setAttribute("role", "alert");
		const actions = form.createDiv({ cls: "http-request-actions" });
		const cancel = new ButtonComponent(actions).setButtonText("Cancel").onClick(() => this.close());
		cancel.buttonEl.type = "button";
		const save = new ButtonComponent(actions).setButtonText("Save request").setCta();
		save.buttonEl.type = "submit";
		form.addEventListener("submit", event => {
			event.preventDefault();
			try {
				buildHttpRequest(this.config);
				this.onSave({ ...this.config });
				this.close();
			} catch (cause) {
				error.setText(cause instanceof Error ? cause.message : String(cause));
			}
		});
		urlInput!.focus();
	}

	onClose() { this.contentEl.empty(); }
}
