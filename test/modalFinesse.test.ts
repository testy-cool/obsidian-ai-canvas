import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { CustomQuestionModal } from "../src/Modals/CustomQuestionModal";
import { InputModal } from "../src/Modals/InputModal";
import { ModelSelectionModal } from "../src/Modals/ModelSelectionModal";
import { UnifiedProviderModal } from "../src/Modals/UnifiedProviderModal";
import { PromptContextModal } from "../src/Modals/PromptContextModal";
import SystemPromptsModal from "../src/Modals/SystemPromptsModal";
import { DEFAULT_SETTINGS } from "../src/settings/AugmentedCanvasSettings";

class Element {
	children: Element[] = [];
	className = "";
	textContent = "";
	value = "";
	disabled = false;
	style: Record<string, string> = {};
	listeners = new Map<string, (event?: any) => unknown>();
	constructor(public tagName: string) {}
	createEl(tag: string, options: any = {}) {
		const child = new Element(tag);
		child.className = typeof options === "string" ? options : options.cls ?? "";
		child.textContent = options.text ?? "";
		this.children.push(child);
		return child;
	}
	createDiv(options?: any) { return this.createEl("div", options); }
	empty() { this.children = []; this.textContent = ""; }
	setText(text: string) { this.textContent = text; }
	addClass(name: string) { this.className += ` ${name}`; }
	setAttribute() {}
	querySelectorAll(selector: string): Element[] {
		return this.children.flatMap(child => [
			...(selector.startsWith(".") ? child.className.split(" ").includes(selector.slice(1)) : child.tagName === selector) ? [child] : [],
			...child.querySelectorAll(selector),
		]);
	}
	querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
	addEventListener(name: string, listener: (event?: any) => unknown) { this.listeners.set(name, listener); }
	onClickEvent(listener: () => unknown) { this.addEventListener("click", listener); }
	focus = vi.fn(() => { if (!this.disabled) (document as any).activeElement = this; });
}

const settings = {
	...DEFAULT_SETTINGS,
	activeProvider: "first", apiModel: "one",
	providers: ["first", "second", "empty"].map(id => ({ id, type: "Custom", enabled: true })),
	models: [
		{ id: "one", model: "model-one", providerId: "first", enabled: true },
		{ id: "two", model: "model-two", providerId: "second", enabled: true },
	],
};

beforeEach(() => vi.stubGlobal("document", { createElement: (tag: string) => new Element(tag), activeElement: null }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("modal focus", () => {
	it.each([
		["CustomQuestionModal", () => new CustomQuestionModal({} as any, vi.fn()), "textarea", 0],
		["InputModal", () => new InputModal({} as any, { label: "Title", buttonLabel: "Save" }, vi.fn()), "input", 0],
		["ModelSelectionModal", () => new ModelSelectionModal({} as any, settings, vi.fn()), "select", 0],
		["UnifiedProviderModal", () => new UnifiedProviderModal({} as any, vi.fn()), "input", 0],
		["PromptContextModal", () => new PromptContextModal({} as any, [{ id: "current", depth: 0, preview: "Current" }, { id: "parent", depth: 1, preview: "Parent" }], vi.fn()), "input", 1],
		["SystemPromptsModal", () => new SystemPromptsModal({} as any, settings, vi.fn()), "input", 0],
	] as const)("%s focuses its first editable input on open", (name, make, tag, index) => {
		const modal = make();
		modal.onOpen();
		const input = (modal.contentEl as any as Element).querySelectorAll(tag)[index];
		expect(input.focus).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(input);
	});

	it("focuses Continue when prompt context has no editable toggle", () => {
		const modal = new PromptContextModal({} as any, [{ id: "current", depth: 0, preview: "Current" }], vi.fn());
		modal.onOpen();
		expect((document.activeElement as any).textContent).toBe("Continue");
	});

	it("updates model options in place and submits the newly selected provider", () => {
		const onSelect = vi.fn();
		const modal = new ModelSelectionModal({} as any, settings, onSelect);
		modal.onOpen();
		const root = modal.contentEl as any as Element;
		const children = [...root.children];
		const [provider, model] = root.querySelectorAll("select");
		for (const id of ["empty", "second"]) {
			provider.value = id;
			provider.listeners.get("change")!();
			expect(root.children).toEqual(children);
			expect(root.querySelectorAll("select")).toEqual([provider, model]);
			expect(document.activeElement).toBe(provider);
			expect(model.disabled).toBe(id === "empty");
			expect(model.children.map(option => option.value)).toEqual(id === "empty" ? [""] : ["two"]);
		}
		root.querySelectorAll("button").find(button => button.textContent === "Select")!.listeners.get("click")!();
		expect(onSelect).toHaveBeenCalledWith({ provider: settings.providers[1], model: settings.models[1] });
	});

	it("keeps the Vertex service account field at 12px", () => {
		const modal = new UnifiedProviderModal({} as any, vi.fn(), { id: "vertex", type: "Vertex", enabled: true });
		modal.onOpen();
		expect((modal.contentEl as any as Element).querySelector("textarea")!.style.fontSize).toBe("12px");
	});
});

describe("question and input modal controls", () => {
	it.each([false, true])("shows Cancel and a working shortcut (multiline: %s)", (multiline) => {
		const submit = vi.fn();
		const modal = multiline ? new CustomQuestionModal({} as any, submit)
			: new InputModal({} as any, { label: "Title", buttonLabel: "Send" }, submit);
		const close = vi.spyOn(modal, "close");
		modal.onOpen();
		const root = modal.contentEl as any as Element;
		expect(root.querySelector(".augmented-canvas-modal-hint")!.textContent).toBe(multiline ? "Ctrl+Enter to send" : "Enter to send");
		const actions = root.querySelector(".augmented-canvas-modal-actions")!;
		expect(actions.children).toHaveLength(2);
		actions.children.find(button => button.textContent === "Cancel")!.listeners.get("click")!();
		expect(submit).not.toHaveBeenCalled();
		expect(close).toHaveBeenCalledOnce();
		const input = root.querySelector(multiline ? "textarea" : "input")!;
		input.value = "my question";
		const preventDefault = vi.fn();
		input.listeners.get("keydown")!({ key: "Enter", ctrlKey: multiline, preventDefault });
		expect(submit).toHaveBeenCalledWith("my question");
		expect(preventDefault).toHaveBeenCalledOnce();
	});

	it("uses a muted 12px shortcut hint and readable controls", () => {
		const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
		const hint = css.split(".augmented-canvas-modal-hint {")[1].split("}")[0];
		expect(hint).toContain("font-size: 12px;");
		expect(hint).toContain("color: var(--text-muted);");
		expect(css).toContain(".augmented-canvas-modal-actions button,\n.augmented-canvas-modal-input,\n.augmented-canvas-modal-textarea {\n\tfont-size: var(--font-ui-small);");
	});
});
