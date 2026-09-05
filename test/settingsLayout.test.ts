import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import SettingsTab from "../src/settings/SettingsTab";
import { UnifiedProviderModal } from "../src/Modals/UnifiedProviderModal";
import { DEFAULT_SETTINGS } from "../src/settings/AugmentedCanvasSettings";
import * as obsidian from "obsidian";
import { probeProviderCapabilities } from "../src/utils/capabilityProbe";
import { testMCPServer } from "../src/utils/mcpClient";
import { fetchProviderModels } from "../src/utils/modelFetch";
import type { ProviderCapabilityReport } from "../src/utils/providerCapabilities";

vi.mock("../src/utils/capabilityProbe", () => ({ probeProviderCapabilities: vi.fn() }));

vi.mock("../src/utils/mcpClient", () => ({ testMCPServer: vi.fn() }));
vi.mock("../src/utils/modelFetch", () => ({ fetchProviderModels: vi.fn() }));

class Element {
	children: Element[] = [];
	parentElement: Element | null = null;
	className = "";
	text = "";
	checked = false;
	disabled = false;
	attributes = new Map<string, string>();
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
	focus = vi.fn();
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
	removeClass(name: string) { this.classList.toggle(name, false); }
	setText(text: string) { this.text = text; }
	setAttribute(name: string, value: string) { this.attributes.set(name, value); }
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
	vi.restoreAllMocks();
	vi.mocked(probeProviderCapabilities).mockReset();
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
			capabilityReport: { image: "no", pdf: "yes", video: "untested", youtube: "no", search: "no", urlContext: "no" } as ProviderCapabilityReport,
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
			expect.objectContaining({ type: "Bifrost", geminiNative: true, baseUrl: provider.baseUrl, capabilityReport: provider.capabilityReport }),
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

describe("provider capability settings", () => {
	const report: ProviderCapabilityReport = {
		image: "yes", pdf: "yes", video: "no", youtube: "untested", search: "no", urlContext: "no",
		testedAt: "2026-09-05T12:00:00.000Z", model: "test-model",
		notes: { image: "Saw red", search: "No grounding evidence" },
	};
	const setup = (capabilityReport?: ProviderCapabilityReport) => {
		const provider = { id: "test", type: "Bifrost", baseUrl: "https://example.test/v1", enabled: true, capabilityReport };
		const plugin: any = {
			settings: {
				...DEFAULT_SETTINGS, providers: [provider], activeProvider: provider.id,
				models: [
					{ id: "disabled", model: "disabled-model", providerId: provider.id, enabled: false },
					{ id: "selected", model: "test-model", providerId: provider.id, enabled: true },
				],
			},
			saveSettings: vi.fn().mockResolvedValue(undefined),
		};
		const tab: any = new SettingsTab({} as any, plugin);
		const root = new Element();
		tab.renderProviders(root);
		const button = root.querySelectorAll("button").find(item => item.textContent === "Test capabilities")!;
		return { tab, root, button, provider, plugin };
	};

	it("tests the first enabled model, disables duplicate requests, saves the report and renders its details", async () => {
		const { tab, root, button, provider, plugin } = setup();
		expect(button.parentElement?.className).toBe("provider-models-actions");
		const testedLine = root.querySelector(".provider-capability-tested")!;
		expect(testedLine.textContent).toBe("Not tested yet");
		expect(root.querySelectorAll(".provider-capability-chip").map(item => item.textContent)).toEqual([
			"image ?", "pdf ?", "video ?", "youtube ?", "search ?", "url ?",
		]);
		let finish!: (value: ProviderCapabilityReport) => void;
		vi.mocked(probeProviderCapabilities).mockReturnValue(new Promise(resolve => { finish = resolve; }));
		const pending = button.listeners.get("click")!();
		expect(button.textContent).toBe("Testing…");
		expect(button.classList.contains("provider-capability-test-button")).toBe(true);
		expect(button.disabled).toBe(true);
		await button.listeners.get("click")!();
		expect(probeProviderCapabilities).toHaveBeenCalledExactlyOnceWith(provider, "test-model", plugin.settings, expect.any(Function));
		const reopened = new Element();
		tab.renderProviders(reopened);
		const reopenedButton = reopened.querySelectorAll("button").find(item => item.textContent === "Testing…")!;
		expect(reopenedButton.disabled).toBe(true);
		const progress = vi.mocked(probeProviderCapabilities).mock.calls[0][3]!;
		const chips = root.querySelectorAll(".provider-capability-chip");
		progress({ ...report, pdf: "untested", testedAt: undefined });
		expect(chips[0].textContent).toBe("image ✓");
		expect(chips[1].textContent).toBe("pdf ?");
		expect(root.querySelectorAll(".provider-capability-chip")).toEqual(chips);
		expect(reopened.querySelector(".provider-capability-chip")!.textContent).toBe("image ✓");
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		finish(report);
		await pending;
		expect(root.querySelector(".provider-capability-tested")).toBe(testedLine);
		expect(provider.capabilityReport).toBe(report);
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
		expect(button.textContent).toBe("Test capabilities");
		expect(button.classList.contains("provider-capability-test-button")).toBe(true);
		expect(button.disabled).toBe(false);
		expect(reopenedButton.disabled).toBe(false);
		expect(reopenedButton.textContent).toBe("Test capabilities");
		expect(root.querySelectorAll(".provider-capability-chip").map(item => item.textContent)).toEqual([
			"image ✓", "pdf ✓", "video ✗", "youtube ?", "search ✗", "url ✗",
		]);
		expect(root.querySelector(".provider-capability-chip")!.attributes.get("title")).toBe("Saw red");
		expect(root.textContent).toContain(`Tested ${new Date(report.testedAt!).toLocaleString()} with test-model`);
		const reloaded = new Element();
		tab.renderProviders(reloaded);
		expect(reloaded.querySelectorAll(".provider-capability-chip").map(item => item.textContent))
			.toEqual(root.querySelectorAll(".provider-capability-chip").map(item => item.textContent));
	});

	it("exposes chip notes with native keyboard buttons and keeps chips mounted while toggling", async () => {
		const { root } = setup(report);
		const chip = root.querySelector(".provider-capability-chip")!;
		expect(chip.tagName).toBe("button");
		expect(chip.attributes.get("aria-expanded")).toBe("false");
		await chip.listeners.get("click")!();
		expect(root.querySelector(".provider-capability-note")!.textContent).toBe("Saw red");
		expect(chip.attributes.get("title")).toBe("Saw red");
		expect(chip.attributes.get("aria-expanded")).toBe("true");
		expect(root.querySelector(".provider-capability-chip")).toBe(chip);
		await chip.listeners.get("click")!();
		expect(root.querySelector(".provider-capability-note")!.textContent).toBe("");
		expect(chip.attributes.get("aria-expanded")).toBe("false");
	});

	it("notifies without sending requests when no model is enabled", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		const { button, plugin } = setup();
		plugin.settings.models.forEach((model: any) => { model.enabled = false; });
		await button.listeners.get("click")!();
		expect(notice).toHaveBeenCalledWith("Enable a model for Bifrost before testing capabilities.");
		expect(probeProviderCapabilities).not.toHaveBeenCalled();
		expect(button.disabled).toBe(false);
	});

	it("restores the button and reports an unexpected failure", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		const { button, provider } = setup(report);
		vi.mocked(probeProviderCapabilities).mockRejectedValue(new Error("Probe failed"));
		await button.listeners.get("click")!();
		expect(notice).toHaveBeenCalledWith("Capability test failed: Probe failed");
		expect(provider.capabilityReport).toBe(report);
		expect(button.disabled).toBe(false);
		expect(button.textContent).toBe("Test capabilities");
	});

	it("shows the grounding note from the active provider's folded report", () => {
		const { tab, plugin } = setup(report);
		plugin.settings.providers[0].geminiNative = true;
		const root = new Element();
		tab.renderGenerationSettings(root);
		expect(root.querySelector(".provider-capability-note")!.textContent).toBe("The active provider (Bifrost) cannot do search grounding. Use a Gemini provider or Bifrost with the Gemini-native API.");
		plugin.settings.providers[0].capabilityReport = { ...report, search: "yes" };
		root.empty();
		tab.renderGenerationSettings(root);
		expect(root.querySelector(".provider-capability-note")).toBeNull();
	});

	it.each(["src/styles/settings.css", "styles.css"])("%s keeps capability text and actions at least 12px", (path) => {
		expect(cssRule(path, ".augmented-canvas-settings .provider-models-actions button"))
			.toContain("font-size: max(12px, var(--font-ui-small));");
		expect(cssRule(path, ".augmented-canvas-settings .provider-capability-chip")).toContain("width: 8em;");
		expect(cssRule(path, ".augmented-canvas-settings .provider-capability-chip")).toContain("flex: 0 0 8em;");
		const css = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
		expect(css).toContain(".provider-capability-report *,\n.augmented-canvas-settings .provider-capability-note,");
	});
});


describe("busy settings buttons", () => {
	it.each(["mcp", "provider"])("reserves the %s button in idle, busy and failed states", async (kind) => {
		let reject!: (error: Error) => void;
		let finish!: (result: any) => void;
		const pending = new Promise<any>((resolve, fail) => { finish = resolve; reject = fail; });
		let root: Element;
		if (kind === "mcp") {
			vi.mocked(testMCPServer).mockReturnValue(pending);
			const tab: any = new SettingsTab({} as any, {
				settings: { ...DEFAULT_SETTINGS, mcpServers: [{ id: "server", name: "Server", transport: "sse", url: "https://example.test", enabled: true }] },
			} as any);
			root = new Element();
			tab.renderMCPServers(root);
		} else {
			vi.mocked(fetchProviderModels).mockReturnValue(pending);
			const modal = new UnifiedProviderModal({} as any, vi.fn());
			modal.onOpen();
			root = modal.contentEl as any;
		}
		const cls = kind === "mcp" ? "mcp-test-button" : "provider-fetch-button";
		const idle = kind === "mcp" ? "Test" : "Test & fetch models";
		const button = root.querySelector(`.${cls}`)!;
		expect(button.textContent).toBe(idle);
		const request = button.listeners.get("click")!();
		expect(button.textContent).toBe(kind === "mcp" ? "Testing…" : "Fetching…");
		expect(button.classList.contains(cls)).toBe(true);
		expect(button.disabled).toBe(true);
		if (kind === "mcp") finish({ success: false, error: "Offline" });
		else reject(new Error("Offline"));
		await request;
		expect(button.textContent).toBe(idle);
		expect(button.classList.contains(cls)).toBe(true);
		expect(button.disabled).toBe(false);
	});

	it.each(["src/styles/settings.css", "styles.css"])("%s reserves readable, nonshrinking button labels", path => {
		for (const [cls, width] of [["provider-capability-test-button", "12em"], ["mcp-test-button", "9em"], ["provider-fetch-button", "14em"]]) {
			expect(cssRule(path, `.${cls}`)).toContain(`min-width: ${width};`);
		}
		const css = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
		expect(css).toContain("flex-shrink: 0;\n\twhite-space: nowrap;\n\tfont-size: max(12px, var(--font-ui-small));");
	});
});
