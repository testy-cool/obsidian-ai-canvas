import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import SettingsTab from "../src/settings/SettingsTab";
import { UnifiedProviderModal } from "../src/Modals/UnifiedProviderModal";
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

describe("settings navigation layout", () => {
	it("keeps navigation outside the scrolling content and resets the scroll when switching sections", () => {
		const plugin: any = {
			manifest: { version: "test" },
			settings: {
				...DEFAULT_SETTINGS,
				providers: [{ id: "test", type: "Custom", enabled: true }],
				models: ["first", "second", "third"].map(id => ({ id, model: id, providerId: "test", enabled: true })),
				mcpServers: [],
			},
			saveSettings: vi.fn(),
		};
		const tab: any = new SettingsTab({} as any, plugin);
		const root = new Element();
		tab.containerEl = root;
		tab.display();

		const nav = root.querySelector(".ac-settings-nav")!;
		const content = root.querySelector(".ac-settings-content")!;
		expect(root.children.map(child => child.className)).toEqual([
			"ac-settings-header", "ac-settings-nav", "ac-settings-content",
		]);
		expect(nav.parentElement).toBe(root);
		expect(content.parentElement).toBe(root);
		expect(content.querySelector(".ac-settings-nav")).toBeNull();

		const navigate = (label: string) => {
			(content as any).scrollTop = 300;
			nav.children.find(child => child.textContent === label)!.listeners.get("click")!();
			expect((content as any).scrollTop).toBe(0);
			expect(root.querySelector(".ac-settings-content")).toBe(content);
		};
		navigate("Providers");
		expect(content.querySelector(".provider-models-title")!.textContent).toContain("Models (3/3)");
		expect(content.querySelector(".provider-models-desc")!.textContent).toBe("Use Add Model to fetch and enable models.");
		navigate("MCP servers");
		expect(content.querySelector(".mcp-section-header")).not.toBeNull();
	});

	it.each(["src/styles/settings.css", "styles.css"])("%s reserves the navigation height outside the content scroll area", (path) => {
		const layout = cssRule(path, ".augmented-canvas-settings");
		expect(layout).toContain("display: flex;");
		expect(layout).toContain("flex-direction: column;");
		expect(layout).toContain("height: 100%;");
		expect(layout).toContain("overflow: hidden;");
		const nav = cssRule(path, ".augmented-canvas-settings .ac-settings-nav");
		expect(nav).toContain("position: static;");
		expect(nav).toContain("flex-shrink: 0;");
		const content = cssRule(path, ".augmented-canvas-settings .ac-settings-content");
		expect(content).toContain("min-height: 0;");
		expect(content).toContain("overflow-y: auto;");
		expect(content).toContain("scrollbar-gutter: stable;");
	});
});

describe("Bifrost Gemini-native setting", () => {
	it.each([undefined, false, true])("loads and saves the native toggle without changing model IDs (initial: %s)", async (geminiNative) => {
		const onSave = vi.fn();
		const provider = {
			id: "bifrost", type: "Bifrost", baseUrl: "https://example.test/v1",
			apiKey: "test", enabled: true, geminiNative,
		};
		const model = { id: "selected", model: "vertex/gemini-3.1-pro-preview", providerId: provider.id, enabled: true };
		const modal: any = new UnifiedProviderModal({} as any, onSave, provider, [model]);
		modal.onOpen();
		const nativeSetting = (modal.contentEl as Element).querySelectorAll(".setting-item")
			.find(item => item.querySelector(".setting-item-name")?.textContent === "Use Gemini-native API")!;
		expect(nativeSetting.style.display).toBe("");
		expect(nativeSetting.querySelector(".setting-item-description")!.textContent).toBe("Route requests through Bifrost's /genai endpoint so Google search grounding, URL context and YouTube links work. Model ids stay as listed (for example vertex/gemini-3.1-pro-preview).");
		const toggle = nativeSetting.querySelector("input")!;
		expect(toggle.checked).toBe(geminiNative ?? false);
		toggle.checked = true;
		await toggle.listeners.get("change")!();
		modal.save();
		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({ type: "Bifrost", geminiNative: true, baseUrl: provider.baseUrl }),
			[expect.objectContaining({ model: model.model })],
		);
	});

	it("hides the native toggle for other provider types", () => {
		const modal: any = new UnifiedProviderModal({} as any, vi.fn(), {
			id: "openai", type: "OpenAI", baseUrl: "https://example.test/v1", apiKey: "test", enabled: true,
		});
		modal.onOpen();
		const nativeSetting = (modal.contentEl as Element).querySelectorAll(".setting-item")
			.find(item => item.querySelector(".setting-item-name")?.textContent === "Use Gemini-native API")!;
		expect(nativeSetting.style.display).toBe("none");
	});
});
