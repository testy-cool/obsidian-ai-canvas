import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpRequestEditor } from "../src/utils/httpRequestEditor";
import { DEFAULT_HTTP_REQUEST } from "../src/utils/httpRequest";

class Element {
	children: Element[] = [];
	className = "";
	textContent = "";
	value = "";
	disabled = false;
	type = "";
	hidden = false;
	attributes = new Map<string, string>();
	listeners = new Map<string, Array<(event: any) => unknown>>();
	parentElement: Element | null = null;
	constructor(public tagName = "div") {}
	createEl(tag: string, options: any = {}) {
		const child = new Element(tag);
		child.className = typeof options === "string" ? options : options.cls ?? "";
		child.textContent = options.text ?? "";
		child.parentElement = this;
		this.children.push(child);
		return child;
	}
	createDiv(options?: any) { return this.createEl("div", options); }
	createSpan(options?: any) { return this.createEl("span", options); }
	setText(text: string) { this.textContent = text; }
	closest(selector: string): Element | null {
		return selector.split(",").map(value => value.trim()).includes(this.tagName) ? this : this.parentElement?.closest(selector) ?? null;
	}
	addClass(name: string) { this.className += ` ${name}`; }
	setAttribute(name: string, value: string) { this.attributes.set(name, value); }
	addEventListener(name: string, fn: (event: any) => unknown) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]); }
	async emit(name: string, event: any = {}) { for (const fn of this.listeners.get(name) ?? []) await fn({ preventDefault() {}, stopPropagation() {}, ...event }); }
	all(): Element[] { return this.children.flatMap(child => [child, ...child.all()]); }
	focus = vi.fn();
	remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
}

beforeEach(() => vi.stubGlobal("document", { createElement: (tag: string) => new Element(tag) }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const field = (root: Element, name: string) => root.all().find(el => el.attributes.get("aria-label") === name)!;

describe("inline HTTP request editing", () => {
	it("lets Canvas select and drag the heading and labels while protecting editable controls", async () => {
		const host = new Element();
		const editor = new HttpRequestEditor(host as any, DEFAULT_HTTP_REQUEST, vi.fn(), vi.fn());
		const heading = host.all().find(el => el.tagName === "h3")!;
		const label = host.all().find(el => el.className.includes("setting-item-name"))!;
		for (const target of [heading, label]) {
			const stop = vi.fn();
			await (editor.root as any as Element).emit("pointerdown", { target, stopPropagation: stop });
			expect(stop).not.toHaveBeenCalled();
		}
		for (const target of [field(host, "Request URL"), field(host, "Headers"), field(host, "HTTP method")]) {
			const stop = vi.fn();
			await (editor.root as any as Element).emit("pointerdown", { target, stopPropagation: stop });
			expect(stop).toHaveBeenCalledOnce();
		}
	});

	it("edits a draft directly inside the card without sending, and sends the latest complete values explicitly", async () => {
		const host = new Element();
		const save = vi.fn();
		const send = vi.fn();
		new HttpRequestEditor(host as any, DEFAULT_HTTP_REQUEST, save, send);
		expect(send).not.toHaveBeenCalled();
		const url = field(host, "Request URL");
		url.value = "https://";
		await url.emit("input");
		expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ url: "https://" }));
		url.value = "https://example.com/items";
		await url.emit("input");
		const method = field(host, "HTTP method");
		method.value = "POST";
		await method.emit("change");
		const body = field(host, "Body");
		expect(body.disabled).toBe(false);
		body.value = '{"hello":"canvas"}';
		await body.emit("input");
		expect(send).not.toHaveBeenCalled();
		await host.all().find(el => el.tagName === "button" && el.textContent === "Send")!.emit("click");
		expect(send).toHaveBeenCalledOnce();
		expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ method: "POST", body: body.value }));
	});

	it("shows validation in the card and preserves focus and field identity when metadata updates", async () => {
		const host = new Element();
		const send = vi.fn();
		const editor = new HttpRequestEditor(host as any, DEFAULT_HTTP_REQUEST, vi.fn(), send);
		const url = field(host, "Request URL");
		await host.all().find(el => el.tagName === "button" && el.textContent === "Send")!.emit("click");
		expect(send).not.toHaveBeenCalled();
		expect(host.all().find(el => el.attributes.get("role") === "alert")!.textContent).toContain("URL");
		editor.update({ ...DEFAULT_HTTP_REQUEST, url: "https://example.com" }, false, "");
		expect(field(host, "Request URL")).toBe(url);
		expect(url.value).toBe("https://example.com");
		editor.update({ ...DEFAULT_HTTP_REQUEST, method: "POST", url: url.value }, true, "Sending… 1s");
		expect(field(host, "Body").disabled).toBe(true);
		expect(host.all().filter(el => ["input", "textarea", "select", "button"].includes(el.tagName)).every(el => el.disabled)).toBe(true);
	});
});
