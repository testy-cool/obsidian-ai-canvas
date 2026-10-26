import { ButtonComponent, DropdownComponent, Setting, TextComponent } from "obsidian";
import { buildHttpRequest, HTTP_METHODS, HttpRequestConfig } from "./httpRequest";

/** Native Obsidian controls mounted inside the card, independent of its Markdown renderer. */
export class HttpRequestEditor {
	readonly root: HTMLElement;
	private config: HttpRequestConfig;
	private fields = new Map<keyof HttpRequestConfig, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>();
	private status: HTMLElement;
	private error: HTMLElement;
	private send: HTMLButtonElement;
	private disabled = false;

	constructor(host: HTMLElement, initial: HttpRequestConfig, private onChange: (config: HttpRequestConfig) => void, onSend: () => unknown) {
		this.config = { ...initial };
		this.root = host.createDiv({ cls: "http-request-editor" });
		for (const name of ["pointerdown", "mousedown", "dblclick", "keydown"]) this.root.addEventListener(name, event => event.stopPropagation());
		this.root.addEventListener("wheel", event => event.stopPropagation(), { passive: true });
		const form = this.root.createEl("form");
		// Enter in a field only edits the request; sending requires the Send button.
		form.addEventListener("submit", event => event.preventDefault());
		const heading = form.createDiv({ cls: "http-request-heading" });
		heading.createEl("h3", { text: "HTTP request" });
		this.status = heading.createSpan();
		this.status.setAttribute("role", "status");
		const address = form.createDiv({ cls: "http-request-address" });
		const method = new DropdownComponent(address);
		for (const value of HTTP_METHODS) method.addOption(value, value);
		method.setValue(initial.method).onChange(value => this.change("method", value));
		method.selectEl.setAttribute("aria-label", "HTTP method");
		this.fields.set("method", method.selectEl);
		const url = new TextComponent(address).setValue(initial.url).setPlaceholder("https://api.example.com/items")
			.onChange(value => this.change("url", value));
		url.inputEl.setAttribute("aria-label", "Request URL");
		this.fields.set("url", url.inputEl);
		this.send = new ButtonComponent(address).setButtonText("Send").setCta().onClick(() => {
			if (this.send.disabled) return;
			try { buildHttpRequest(this.config); }
			catch (error) { this.setError(error instanceof Error ? error.message : String(error)); return; }
			this.setError("");
			onSend();
		}).buttonEl;
		this.send.type = "button";
		const area = (name: "query" | "headers" | "body", label: string, description: string, placeholder: string) => {
			new Setting(form).setName(label).setDesc(description).addTextArea(input => {
				input.setValue(initial[name]).setPlaceholder(placeholder).onChange(value => this.change(name, value));
				input.inputEl.setAttribute("aria-label", label);
				input.inputEl.spellcheck = false;
				this.fields.set(name, input.inputEl);
			});
		};
		area("query", "Query parameters", "URL-encoded name=value pairs, one per line.", "limit=10\nq=hello+world");
		area("headers", "Headers", "One Name: value per line.", "Content-Type: application/json");
		new Setting(form).setName("Bearer token").setDesc("Optional. Overrides an Authorization header.").addText(input => {
			input.setValue(initial.bearerToken).onChange(value => this.change("bearerToken", value));
			input.inputEl.type = "password";
			input.inputEl.autocomplete = "off";
			input.inputEl.setAttribute("aria-label", "Bearer token");
			this.fields.set("bearerToken", input.inputEl);
		});
		area("body", "Body", "Sent verbatim. GET and HEAD have no body.", '{"name": "example"}');
		form.createEl("p", { cls: "http-request-storage-note", text: "Changes save automatically in this canvas, including headers and tokens. Common authentication headers are hidden from card text." });
		this.error = form.createEl("p", { cls: "http-request-error" });
		this.error.setAttribute("role", "alert");
		this.update(initial, false, "");
	}

	private change(name: keyof HttpRequestConfig, value: string) {
		if (this.disabled) return;
		this.setError("");
		const next = { ...this.config, [name]: value };
		try {
			this.onChange(next);
			this.update(next, this.disabled, this.status.textContent ?? "");
		} catch (error) {
			this.update(this.config, this.disabled, this.status.textContent ?? "");
			this.setError(error instanceof Error ? error.message : String(error));
		}
	}

	update(config: HttpRequestConfig, disabled: boolean, status: string) {
		this.disabled = disabled;
		this.config = { ...config };
		for (const [name, input] of this.fields) {
			if (input.value !== config[name]) input.value = config[name];
			input.disabled = disabled || (name === "body" && ["GET", "HEAD"].includes(config.method));
		}
		this.send.disabled = disabled;
		this.status.setText(status);
	}

	focus() { this.fields.get("url")?.focus(); }
	setError(message: string) { this.error.setText(message); }
	destroy() { this.root.remove(); }
}
