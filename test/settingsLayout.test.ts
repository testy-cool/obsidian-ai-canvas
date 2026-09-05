import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import SettingsTab from "../src/settings/SettingsTab";
import { DEFAULT_SETTINGS } from "../src/settings/AugmentedCanvasSettings";

class Element {
	children: Element[] = [];
	parentElement: Element | null = null;
	className = "";
	text = "";
	checked = false;
	style: Record<string, string> = {};
	listeners = new Map<string, () => unknown>();
	classList = {
		add: (name: string) => this.addClass(name),
		contains: (name: string) => this.className.split(" ").includes(name),
		toggle: (name: string, enabled: boolean) => {
			this.className = this.className.split(" ").filter(value => value !== name).join(" ");
			if (enabled) this.addClass(name);
		},
	};
	constructor(public tagName = "div") {}
	get textContent(): string { return this.text + this.children.map(child => child.textContent).join(""); }
	createEl(tag: string, options: string | { cls?: string; text?: string } = {}) {
		const child = new Element(tag);
		child.className = typeof options === "string" ? options : options.cls ?? "";
		child.text = typeof options === "string" ? "" : options.text ?? "";
		child.parentElement = this;
		this.children.push(child);
		return child;
	}
	createDiv(options?: string | { cls?: string; text?: string }) { return this.createEl("div", options); }
	createSpan(options?: string | { cls?: string; text?: string }) { return this.createEl("span", options); }
	addClass(name: string) { this.className += ` ${name}`; }
	setText(text: string) { this.text = text; }
	setAttribute() {}
	empty() { this.children = []; this.text = ""; }
	remove() {
		if (this.parentElement) {
			this.parentElement.children = this.parentElement.children.filter(child => child !== this);
		}
		this.parentElement = null;
	}
	querySelectorAll(selector: string): Element[] {
		return this.children.flatMap(child => [
			...(selector.startsWith(".") ? child.classList.contains(selector.slice(1)) : child.tagName === selector) ? [child] : [],
			...child.querySelectorAll(selector),
		]);
	}
	querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
	addEventListener(name: string, callback: () => unknown) { this.listeners.set(name, callback); }
}

const cssRule = (path: string, selector: string) => {
	const css = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
	return css.split(`${selector} {`)[1]?.split("}")[0];
};

beforeEach(() => {
	vi.stubGlobal("document", { createElement: (tag: string) => new Element(tag) });
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("MCP settings layout", () => {
	it("keeps the description beside the toggle and the action buttons in a separate row", async () => {
		const plugin: any = {
			settings: { ...DEFAULT_SETTINGS, mcpServers: [], mcpEnabled: false },
			saveSettings: vi.fn().mockResolvedValue(undefined),
		};
		const tab: any = new SettingsTab({} as any, plugin);
		const root = new Element();
		tab.renderMCPServers(root);

		const header = root.querySelector(".mcp-section-header")!;
		const info = header.querySelector(".setting-item-info")!;
		const description = header.querySelector(".setting-item-description")!;
		const control = header.querySelector(".setting-item-control")!;
		expect(description.textContent).toBe("Connect to Model Context Protocol servers to add tools for the AI.");
		expect(description.parentElement).toBe(info);
		expect(info.parentElement).toBe(header);
		expect(control.parentElement).toBe(header);
		expect(control.children.map(child => child.tagName)).toEqual(["input"]);
		expect(header.querySelectorAll("button")).toHaveLength(0);

		const actions = root.querySelector(".mcp-server-actions")!;
		expect(actions.parentElement).toBe(root);
		expect(root.children.indexOf(actions)).toBe(root.children.indexOf(header) + 1);
		expect(actions.querySelector(".setting-item-info")).toBeNull();
		expect(actions.querySelector(".setting-item-control")!.children.map(child => child.textContent)).toEqual([
			"Add Server", "Import JSON", "Export JSON",
		]);

		const toggle = control.children[0];
		expect(toggle.checked).toBe(false);
		toggle.checked = true;
		await toggle.listeners.get("change")!();
		expect(plugin.settings.mcpEnabled).toBe(true);
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
	});

	it.each(["src/styles/settings.css", "styles.css"])("%s lets the header and actions wrap without fixed control widths", (path) => {
		const header = cssRule(path, ".augmented-canvas-settings .setting-item.mcp-section-header");
		expect(header).toContain("display: flex;");
		expect(header).toContain("flex-wrap: wrap;");
		const info = cssRule(path, ".augmented-canvas-settings .mcp-section-header .setting-item-info");
		expect(info).toContain("min-width: 0;");
		const toggle = cssRule(path, ".augmented-canvas-settings .setting-item.mcp-section-header .setting-item-control");
		expect(toggle).toContain("min-width: 0;");
		const actions = cssRule(path, ".augmented-canvas-settings .setting-item.mcp-server-actions .setting-item-control");
		expect(actions).toContain("flex-wrap: wrap;");
		expect(actions).toContain("min-width: 0;");
		for (const rule of [header, info, toggle, actions]) {
			expect(rule).not.toMatch(/position:\s*(absolute|fixed)/);
		}
	});
});
