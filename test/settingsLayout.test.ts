import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import SettingsTab from "../src/settings/SettingsTab";
import { UnifiedProviderModal } from "../src/Modals/UnifiedProviderModal";
import { DEFAULT_SETTINGS, GEMINI_BASE_URL } from "../src/settings/AugmentedCanvasSettings";
import * as obsidian from "obsidian";
import { probeProviderCapabilities } from "../src/utils/capabilityProbe";
import { testMCPServer } from "../src/utils/mcpClient";
import { fetchPricingForModels } from "../src/utils/pricingFetch";
import { fetchProviderModels } from "../src/utils/modelFetch";
import { getCapabilityReportKey, getCapabilityRoute, providerLabel, type ProviderCapabilityReport } from "../src/utils/providerCapabilities";

vi.mock("../src/utils/capabilityProbe", () => ({ probeProviderCapabilities: vi.fn() }));

vi.mock("../src/utils/mcpClient", () => ({ testMCPServer: vi.fn() }));
vi.mock("../src/utils/modelFetch", () => ({ fetchProviderModels: vi.fn() }));
vi.mock("../src/utils/pricingFetch", () => ({ fetchPricingForModels: vi.fn() }));
vi.mock("../src/utils/codexCli", async importOriginal => ({
	...await importOriginal<typeof import("../src/utils/codexCli")>(),
	findCodexBinary: vi.fn(() => null),
}));

class Element {
	children: Element[] = [];
	parentElement: Element | null = null;
	className = "";
	text = "";
	checked = false;
	value = "";
	scrollTop = 0;
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
	focus = vi.fn(() => { (document as any).activeElement = this; });
	get textContent(): string { return this.text + this.children.map(child => child.textContent).join(""); }
	set textContent(value: string) { this.text = value; this.children = []; }
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
	// Enough of closest() for a class selector, which is how a click decides
	// whether it landed on a control inside a clickable header.
	closest(selector: string): Element | null {
		const name = selector.replace(/^\./, "");
		for (let node: Element | null = this; node; node = node.parentElement) {
			if (node.classList.contains(name)) return node;
		}
		return null;
	}
	removeClass(name: string) { this.classList.toggle(name, false); }
	toggleClass(name: string, enabled: boolean) { this.classList.toggle(name, enabled); }
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

describe("observability connection check", () => {
	it.each([
		{ status: 200, json: { data: [{ name: "test project" }] }, expected: "Credentials verified" },
		{ status: 401, json: {}, expected: "Failed (HTTP 401)" },
		{ status: 200, json: { status: "OK" }, expected: "No accessible Langfuse project" },
	])("checks project credentials for $status / $expected", async ({ status, json, expected }) => {
		const request = vi.spyOn(obsidian, "requestUrl").mockResolvedValue({ status, json } as any);
		const plugin: any = { settings: { ...DEFAULT_SETTINGS, observability: {
			enabled: true, provider: "langfuse", host: "https://example.test", publicKey: "public", secretKey: "secret",
		} } };
		const tab: any = new SettingsTab({} as any, plugin);
		const root = new Element();
		tab.renderObservability(root);
		const button = root.querySelectorAll("button").find(element => element.textContent === "Test connection")!;
		await button.listeners.get("click")!();
		expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: "https://example.test/api/public/projects" }));
		expect(root.textContent).toContain(expected);
		expect(button.disabled).toBe(false);
	});
});

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
		expect(content.querySelector(".provider-models-desc")!.textContent).toBe("Use Edit to fetch and add models.");
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
		expect(nativeSetting.querySelector(".setting-item-description")!.textContent).toBe("Use Google's request format for Gemini models through Bifrost. Enables testing of YouTube input, Google Search and URL context. Support depends on the selected model.");
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

	it("offers a Bifrost preset that shows the address, the key and the native switch", async () => {
		const modal: any = new UnifiedProviderModal({} as any, vi.fn());
		modal.onOpen();
		const root = modal.contentEl as Element;
		const select = settingNamed(root, "Preset").querySelector("select")!;
		expect(select.querySelectorAll("option").map(option => [option.value, option.text])).toContainEqual(["bifrost", "Bifrost"]);
		select.value = "bifrost";
		await select.listeners.get("change")!();
		expect(settingNamed(root, "Provider name").querySelector("input")!.value).toBe("Bifrost");
		for (const name of ["Base URL", "API key", "Use Gemini-native API"]) expect(settingNamed(root, name).style.display).toBe("");
	});

	it("stores a gateway recognised by its name as Bifrost, so a rename keeps the native switch", async () => {
		const onSave = vi.fn();
		const modal: any = new UnifiedProviderModal({} as any, onSave);
		modal.onOpen();
		const root = modal.contentEl as Element;
		for (const [field, value] of [["Provider name", "Work Bifrost"], ["Base URL", "https://gateway.example.test/v1"]]) {
			const input = settingNamed(root, field).querySelector("input")!;
			input.value = value;
			await input.listeners.get("input")!();
		}
		const toggle = settingNamed(root, "Use Gemini-native API").querySelector("input")!;
		toggle.checked = true;
		await toggle.listeners.get("change")!();
		modal.save();
		const saved = onSave.mock.calls[0][0];
		expect(saved).toEqual(expect.objectContaining({ id: "work-bifrost", type: "Bifrost", name: "Work Bifrost", geminiNative: true }));

		const edit = vi.fn();
		const again: any = new UnifiedProviderModal({} as any, edit, saved);
		again.onOpen();
		const name = settingNamed(again.contentEl, "Provider name").querySelector("input")!;
		name.value = "Work Gateway";
		await name.listeners.get("input")!();
		again.save();
		expect(edit.mock.calls[0][0]).toEqual(expect.objectContaining({ type: "Bifrost", name: "Work Gateway", geminiNative: true }));
	});

	it("stores a saved Custom gateway as Bifrost even when the same edit renames it", async () => {
		const onSave = vi.fn();
		const saved: any = { id: "gateway", type: "Custom", name: "Work Bifrost", baseUrl: "https://gateway.example.test/v1", apiKey: "k", enabled: true, geminiNative: true };
		const modal: any = new UnifiedProviderModal({} as any, onSave, saved);
		modal.onOpen();
		const name = settingNamed(modal.contentEl, "Provider name").querySelector("input")!;
		name.value = "Work Gateway";
		await name.listeners.get("input")!();
		modal.save();
		expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({ type: "Bifrost", name: "Work Gateway", geminiNative: true }));
	});

	it("does not treat a provider already of kind Bifrost as changed when it is saved untouched", () => {
		const onSave = vi.fn();
		const saved: any = { id: "gw", type: "Bifrost", baseUrl: "https://example.test/v1", apiKey: "k", enabled: true, geminiNative: true, capabilityReports: { kept: { model: "m" } } };
		const modal: any = new UnifiedProviderModal({} as any, onSave, saved);
		modal.onOpen();
		modal.save();
		expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({ type: "Bifrost", geminiNative: true, capabilityReports: saved.capabilityReports }));
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

describe("provider diagnostic invalidation", () => {
	it.each([false, true])("retains tests only when credentials are unchanged (changed: %s)", async changed => {
		const provider: any = { id:"bifrost", type:"Bifrost", baseUrl:"https://example.test/v1", apiKey:"original-key", enabled:true,
			capabilityReports:{saved:{model:"test-model"}} };
		const save = vi.fn();
		const modal:any = new UnifiedProviderModal({} as any, save, provider);
		modal.onOpen();
		if (changed) modal.provider.apiKey = "replacement-key";
		await modal.contentEl.querySelectorAll("button").find((button:any)=>button.textContent==="Save provider").listeners.get("click")();
		expect(save.mock.calls[0][0].capabilityReports).toEqual(changed ? undefined : provider.capabilityReports);
	});
});

describe("provider capability settings", () => {
	const report: ProviderCapabilityReport = {
		image: "yes", pdf: "yes", video: "no", youtube: "untested", search: "no", urlContext: "no",
		schemaVersion: 2, route: getCapabilityRoute({type:"Bifrost",baseUrl:"https://example.test/v1"}),
		testedAt: "2026-09-05T12:00:00.000Z", model: "test-model",
		notes: { image: "Saw red", search: "No grounding evidence" },
	};
	const setup = (capabilityReport?: ProviderCapabilityReport) => {
		const provider: any = { id: "test", type: "Bifrost", baseUrl: "https://example.test/v1", enabled: true };
		if (capabilityReport) provider.capabilityReports = { [getCapabilityReportKey(provider, "test-model")]: capabilityReport };
		const plugin: any = {
			settings: {
				...DEFAULT_SETTINGS, providers: [provider], activeProvider: provider.id, apiModel: "selected",
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
		const button = root.querySelectorAll("button").find(item => item.textContent === "Test selected model")!;
		return { tab, root, button, provider, plugin };
	};

	it("tests the first enabled model, disables duplicate requests, saves the report and renders its details", async () => {
		const { tab, root, button, provider, plugin } = setup();
		expect(button.parentElement?.className).toBe("setting-item-control");
		const testedLine = root.querySelector(".provider-capability-tested")!;
		expect(testedLine.textContent).toBe("Not tested yet");
		expect(root.querySelectorAll(".provider-capability-chip").map(item => item.textContent)).toEqual([
			"Images: Not tested", "PDF: Not tested", "Video files: Not tested", "YouTube: Not tested", "Google Search: Not tested", "URL context: Not tested",
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
		expect(chips[0].textContent).toBe("Images: Verified");
		expect(chips[1].textContent).toBe("PDF: Not tested");
		expect(root.querySelectorAll(".provider-capability-chip")).toEqual(chips);
		expect(reopened.querySelector(".provider-capability-chip")!.textContent).toBe("Images: Verified");
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		finish(report);
		await pending;
		expect(root.querySelector(".provider-capability-tested")).toBe(testedLine);
		expect(provider.capabilityReports[getCapabilityReportKey(provider, report.model!)]).toBe(report);
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
		expect(button.textContent).toBe("Test selected model");
		expect(button.classList.contains("provider-capability-test-button")).toBe(true);
		expect(button.disabled).toBe(false);
		expect(reopenedButton.disabled).toBe(false);
		expect(reopenedButton.textContent).toBe("Test selected model");
		expect(root.querySelectorAll(".provider-capability-chip").map(item => item.textContent)).toEqual([
			"Images: Verified", "PDF: Verified", "Video files: Unavailable", "YouTube: Not tested", "Google Search: Unavailable", "URL context: Unavailable",
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

	it("defaults to the generation model and lets the user explicitly test a different model", async () => {
		const { tab, plugin, provider } = setup();
		plugin.settings.models.unshift({id:"first",model:"first-model",providerId:provider.id,enabled:true});
		const root = new Element(); tab.renderProviders(root);
		const select = root.querySelector(".provider-capability-model")!;
		expect(select.value).toBe("selected");
		select.value = "first"; await select.listeners.get("change")!();
		vi.mocked(probeProviderCapabilities).mockResolvedValue({...report,model:"first-model"});
		await root.querySelectorAll("button").find(b=>b.textContent==="Test selected model")!.listeners.get("click")!();
		expect(probeProviderCapabilities).toHaveBeenCalledWith(expect.anything(),"first-model",plugin.settings,expect.any(Function));
		expect(provider.capabilityReports[getCapabilityReportKey(provider,"first-model")].model).toBe("first-model");
	});

	it("updates the test selector when a model is enabled", async () => {
		const { root } = setup();
		const select = root.querySelector(".provider-capability-model")!;
		expect(select.children.some(option => option.value === "disabled")).toBe(false);
		const row = root.querySelectorAll(".provider-model-row").find(row => row.textContent.includes("disabled-model"))!;
		const checkbox = row.querySelector("input")!;
		checkbox.checked = true; await checkbox.listeners.get("change")!();
		expect(select.children.some(option => option.value === "disabled")).toBe(true);
	});

	it("lets each model be set to make text or images, with Auto showing its guess", async () => {
		const { root, plugin } = setup();
		const row = root.querySelectorAll(".provider-model-row").find(row => row.textContent.includes("test-model"))!;
		const kind = row.querySelector(".provider-model-kind")!;
		expect(kind.value).toBe("auto");
		expect(kind.children.map(option => option.text)).toEqual(["Auto (text)", "Text", "Image"]);

		kind.value = "image"; await kind.listeners.get("change")!();
		const model = plugin.settings.models.find((m: any) => m.id === "selected");
		expect(model.kind).toBe("image");
		expect(plugin.saveSettings).toHaveBeenCalled();

		kind.value = "auto"; await kind.listeners.get("change")!();
		expect("kind" in model).toBe(false);
	});

	it("shows access errors openly and ignores old gateway-wide failures", () => {
		const {tab, plugin, provider} = setup();
		provider.capabilityReport = {...report,image:"no"};
		const root = new Element(); tab.renderProviders(root);
		expect(root.textContent).toContain("Previous gateway-wide results need a new test");
		expect(root.textContent).toContain("Images: Not tested");
		provider.capabilityReports = {[getCapabilityReportKey(provider,"test-model")]:{...report,image:"error",notes:{image:"HTTP 403: key denied"}}};
		root.empty(); tab.renderProviders(root);
		expect(root.textContent).toContain("Images: Test failed");
		expect(root.querySelector(".provider-capability-note")!.textContent).toBe("HTTP 403: key denied");
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
		expect(provider.capabilityReports[getCapabilityReportKey(provider, report.model!)]).toBe(report);
		expect(button.disabled).toBe(false);
		expect(button.textContent).toBe("Test selected model");
	});

	it("shows the grounding note from the active provider's folded report", () => {
		const { tab, plugin } = setup(report);
		plugin.settings.providers[0].geminiNative = true;
		plugin.settings.providers[0].capabilityReports = { [getCapabilityReportKey(plugin.settings.providers[0], report.model!)]: { ...report, route:getCapabilityRoute(plugin.settings.providers[0]) } };
		const root = new Element();
		tab.renderGenerationSettings(root);
		expect(root.querySelector(".provider-capability-note")!.textContent).toBe("The active provider (Bifrost) cannot do search grounding. Use a Gemini provider or Bifrost with the Gemini-native API.");
		plugin.settings.providers[0].capabilityReports = { [getCapabilityReportKey(plugin.settings.providers[0], report.model!)]: { ...report, route:getCapabilityRoute(plugin.settings.providers[0]), search: "yes" } };
		root.empty();
		tab.renderGenerationSettings(root);
		expect(root.querySelector(".provider-capability-note")).toBeNull();
	});

	it.each(["src/styles/settings.css", "styles.css"])("%s keeps capability text and actions at least 12px", (path) => {
		expect(cssRule(path, ".augmented-canvas-settings .provider-models-actions button"))
			.toContain("font-size: max(12px, var(--font-ui-small));");
		expect(cssRule(path, ".augmented-canvas-settings .provider-capability-chip")).toContain("width: 100%;");
		expect(cssRule(path, ".augmented-canvas-settings .provider-capability-chip")).toContain("white-space: normal;");
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
		const idle = kind === "mcp" ? "Test" : "Fetch models";
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


describe("undo settings deletion", () => {
	it.each(["first", "middle", "last"])("restores the %s provider and interleaved models as the same objects in order", async (id) => {
		const providers = ["first", "middle", "last"].map(id => ({ id, type: id, baseUrl: "https://example.test", enabled: true }));
		const models = ["first", "middle", "last", "middle", "first", "last"].map((providerId, index) => ({ id: `model-${index}`, model: `model-${index}`, providerId, enabled: true }));
		const activeModel = models.find(model => model.providerId === id)!.id;
		const plugin: any = {
			settings: { ...DEFAULT_SETTINGS, providers: [...providers], models: [...models], activeProvider: id, apiModel: activeModel },
			saveSettings: vi.fn().mockResolvedValue(undefined),
		};
		const tab: any = new SettingsTab({} as any, plugin);
		const display = vi.spyOn(tab, "display").mockImplementation(() => {});
		const notice = vi.spyOn(obsidian, "Notice");
		const root = new Element();
		tab.renderProviders(root);
		const card = root.querySelectorAll(".provider-block")[providers.findIndex(provider => provider.id === id)];
		await card.querySelectorAll("button").find(button => button.textContent === "Delete")!.listeners.get("click")!();
		expect(plugin.settings.providers.map((provider: any) => provider.id)).not.toContain(id);
		expect(plugin.settings.models.some((model: any) => model.providerId === id)).toBe(false);
		expect(plugin.settings.activeProvider).not.toBe(id);
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
		expect(notice).toHaveBeenCalledWith(`Deleted ${id}.`, 8000);
		const undo = (notice.mock.instances[0].noticeEl as any as Element).querySelector("button")!;
		expect(undo.textContent).toBe("Undo");
		await undo.listeners.get("click")!();
		await undo.listeners.get("click")!();
		expect(plugin.settings.providers).toEqual(providers);
		expect(plugin.settings.models).toEqual(models);
		providers.forEach((provider, index) => expect(plugin.settings.providers[index]).toBe(provider));
		models.forEach((model, index) => expect(plugin.settings.models[index]).toBe(model));
		expect(plugin.settings.activeProvider).toBe(id);
		expect(plugin.settings.apiModel).toBe(activeModel);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
		expect(display).toHaveBeenCalledTimes(2);
	});

	it.each([0, 1, 2])("restores an MCP server at index %s as the same object", async (index) => {
		const servers = ["first", "middle", "last"].map(id => ({ id, name: id, transport: "sse", url: "https://example.test", enabled: true }));
		const plugin: any = {
			settings: { ...DEFAULT_SETTINGS, mcpServers: [...servers] },
			saveSettings: vi.fn().mockResolvedValue(undefined),
		};
		const tab: any = new SettingsTab({} as any, plugin);
		const display = vi.spyOn(tab, "display").mockImplementation(() => {});
		const notice = vi.spyOn(obsidian, "Notice");
		const root = new Element();
		tab.renderMCPServers(root);
		const card = root.querySelectorAll(".mcp-server-block")[index];
		await card.querySelectorAll("button").find(button => button.textContent === "Delete")!.listeners.get("click")!();
		expect(plugin.settings.mcpServers).toEqual(servers.filter((_, i) => i !== index));
		expect(notice).toHaveBeenCalledWith(`Deleted ${servers[index].name}.`, 8000);
		const undo = (notice.mock.instances[0].noticeEl as any as Element).querySelector("button")!;
		await undo.listeners.get("click")!();
		expect(plugin.settings.mcpServers).toEqual(servers);
		servers.forEach((server, i) => expect(plugin.settings.mcpServers[i]).toBe(server));
		expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
		expect(display).toHaveBeenCalledTimes(2);
	});
});


const settingNamed = (root: Element, name: string) => root.querySelectorAll(".setting-item")
	.find(item => item.querySelector(".setting-item-name")?.textContent === name)!;

describe("inline settings validation", () => {
	it.each([
		{ name: "Max agent steps", render: "renderMCPServers", key: "mcpMaxSteps", invalid: ["", "0", "21", "1.5", "2steps"], valid: ["1", "20"] },
		{ name: "Max Response Tokens", render: "renderGenerationSettings", key: "maxResponseTokens", invalid: ["", "3.5", "12tokens", "Infinity"], valid: ["0", "-1", "4096"] },
	])("shows $name errors without saving and clears them on valid input", async ({ name, render, key, invalid, valid }) => {
		const plugin: any = { settings: { ...DEFAULT_SETTINGS }, saveSettings: vi.fn().mockResolvedValue(undefined) };
		const tab: any = new SettingsTab({} as any, plugin);
		const root = new Element();
		tab[render](root);
		const field = settingNamed(root, name);
		const input = field.querySelector("input")!;
		const warning = field.querySelector(".ac-setting-error")!;
		expect(field.querySelector(".ac-setting-hint")!.textContent).toContain(name === "Max agent steps" ? "1 to 20" : "any integer; 0 means unlimited");
		for (const value of invalid) {
			input.value = value;
			await input.listeners.get("input")!();
			expect(input.classList.contains("mod-warning")).toBe(true);
			expect(input.attributes.get("aria-invalid")).toBe("true");
			expect(warning.textContent).not.toBe("");
			expect(plugin.settings[key]).toBe(DEFAULT_SETTINGS[key]);
		}
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		for (const value of valid) {
			input.value = value;
			await input.listeners.get("input")!();
			expect(input.classList.contains("mod-warning")).toBe(false);
			expect(input.attributes.get("aria-invalid")).toBe("false");
			expect(warning.textContent).toBe("");
			expect(plugin.settings[key]).toBe(Number(value));
		}
		expect(plugin.saveSettings).toHaveBeenCalledTimes(valid.length);
	});

	it("focuses each missing provider field, keeps the modal open and clears corrected errors", async () => {
		const onSave = vi.fn();
		const modal: any = new UnifiedProviderModal({} as any, onSave);
		const close = vi.spyOn(modal, "close");
		modal.onOpen();
		const root = modal.contentEl as Element;
		for (const [name, value, message] of [["Provider name", "My gateway", "Provider name is required."], ["Base URL", "https://example.test/v1", "Base URL is required."]]) {
			const field = settingNamed(root, name);
			const input = field.querySelector("input")!;
			modal.save();
			expect(input.classList.contains("mod-warning")).toBe(true);
			expect(field.querySelector(".ac-setting-error")!.textContent).toBe(message);
			expect(document.activeElement).toBe(input);
			expect(onSave).not.toHaveBeenCalled();
			expect(close).not.toHaveBeenCalled();
			input.value = value;
			await input.listeners.get("input")!();
			expect(input.classList.contains("mod-warning")).toBe(false);
			expect(field.querySelector(".ac-setting-error")!.textContent).toBe("");
		}
		modal.save();
		expect(onSave).toHaveBeenCalledOnce();
		expect(close).toHaveBeenCalledOnce();
	});

	it.each(["src/styles/settings.css", "styles.css"])("%s keeps validation text at 12px and reserves message space", path => {
		const css = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
		expect(css).toContain(".ac-setting-hint,\n.ac-setting-error {\n\tfont-size: 12px;\n\tcolor: var(--text-muted);");
		expect(css).toContain(".ac-setting-error {\n\tmin-height: 1.5em;");
	});
});


it.each([
	{ id: "bifrost", type: "My gateway", baseUrl: "https://example.test/v1" },
	{ id: "gateway", type: "bifrost", baseUrl: "https://example.test/v1" },
	{ id: "gateway", type: "My Bifrost", baseUrl: "https://example.test/v1" },
	{ id: "gateway", type: "My gateway", baseUrl: "https://bifrost.example/v1" },
])("shows and saves the native toggle for $type at $baseUrl", identity => {
	const onSave = vi.fn();
	const modal: any = new UnifiedProviderModal({} as any, onSave, { ...identity, apiKey: "test", enabled: true, geminiNative: true });
	modal.onOpen();
	expect(settingNamed(modal.contentEl, "Use Gemini-native API").style.display).toBe("");
	modal.save();
	expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ ...identity, geminiNative: true }), []);
});

it("updates Bifrost detection when the user edits the name or endpoint", async () => {
	const modal = new UnifiedProviderModal({} as any, vi.fn());
	modal.onOpen();
	const root = modal.contentEl as any as Element;
	const nativeSetting = settingNamed(root, "Use Gemini-native API");
	const name = settingNamed(root, "Provider name").querySelector("input")!;
	const url = settingNamed(root, "Base URL").querySelector("input")!;
	for (const [input, value, visible] of [[name, "Bifrost gateway", true], [name, "Gateway", false], [url, "https://bifrost.example/v1", true], [url, "https://example.test/bifrost", false]] as const) {
		input.value = value;
		await input.listeners.get("input")!();
		expect(nativeSetting.style.display).toBe(visible ? "" : "none");
	}
});


describe("settings rendering has no persistence side effects", () => {
	it.each([false, true])("displays image and naming fallbacks without modifying settings (models available: %s)", async available => {
		const models = available ? [{ id: "enabled-model", model: "test-model", providerId: "provider", enabled: true }] : [];
		const plugin: any = {
			settings: {
				...DEFAULT_SETTINGS,
				providers: [{ id: "provider", type: "Custom", baseUrl: "https://example.test", enabled: true }], models,
				activeProvider: "provider", imageProviderId: "provider", cardTitleProviderId: "provider", groupTitleProviderId: "provider",
				imageModelId: "stale-image", cardTitleModelId: "stale-card", groupTitleModelId: "stale-group",
			},
			saveSettings: vi.fn().mockResolvedValue(undefined),
		};
		const original = structuredClone(plugin.settings);
		const tab: any = new SettingsTab({} as any, plugin);
		const root = new Element();
		for (let render = 0; render < 2; render++) {
			root.empty();
			tab.renderImageSettings(root);
			tab.renderNamingSettings(root);
			expect(plugin.settings).toEqual(original);
			expect(plugin.saveSettings).not.toHaveBeenCalled();
			expect(settingNamed(root, "Image model").querySelector("select")!.value).toBe("");
			for (const name of ["Card title model", "Group name model"]) {
				expect(settingNamed(root, name).querySelector("select")!.value).toBe(available ? "enabled-model" : "");
			}
		}
		if (available) {
			for (const [name, key] of [["Image model", "imageModelId"], ["Card title model", "cardTitleModelId"], ["Group name model", "groupTitleModelId"]]) {
				const dropdown = settingNamed(root, name).querySelector("select")!;
				dropdown.value = "enabled-model";
				await dropdown.listeners.get("change")!();
				expect(plugin.settings[key]).toBe("enabled-model");
			}
			expect(plugin.saveSettings).toHaveBeenCalledTimes(3);
		}
	});
});


describe("provider modal updates in place", () => {
	it("retains the modal, inputs, focus and scroll while presets patch values and visibility", async () => {
		const modal: any = new UnifiedProviderModal({} as any, vi.fn());
		modal.onOpen();
		const root = modal.contentEl as Element;
		const children = [...root.children];
		const inputs = root.querySelectorAll("input");
		const preset = settingNamed(root, "Preset").querySelector("select")!;
		const name = settingNamed(root, "Provider name").querySelector("input")!;
		const base = settingNamed(root, "Base URL");
		const url = base.querySelector("input")!;
		const keySetting = settingNamed(root, "API key");
		const key = keySetting.querySelector("input")!;
		const list = root.querySelector(".model-checklist")!;
		key.value = "test-key";
		await key.listeners.get("input")!();
		for (const [id, type, endpoint, hideUrl, hideKey] of [
			["openai", "OpenAI", "https://api.openai.com/v1", false, false],
			["groq", "Groq", "https://api.groq.com/openai/v1", false, false],
			["gemini", "Gemini", "https://generativelanguage.googleapis.com/v1beta", true, false],
			["vertex", "Vertex", "", true, true],
			["codex", "Codex", "", true, true],
			["azure", "Azure", "", false, false],
			["openai", "OpenAI", "https://api.openai.com/v1", false, false],
		] as const) {
			preset.focus();
			root.scrollTop = 137;
			preset.value = id;
			await preset.listeners.get("change")!();
			expect(modal.contentEl).toBe(root);
			expect(root.children).toEqual(children);
			root.querySelectorAll("input").forEach((input, index) => expect(input).toBe(inputs[index]));
			expect(name.value).toBe(type);
			expect(url.value).toBe(endpoint);
			expect(key.value).toBe("test-key");
			expect((key as any).placeholder).toBe(id === "gemini" ? "Google API key" : "sk-...");
			expect(base.style.display).toBe(hideUrl ? "none" : "");
			expect(keySetting.style.display).toBe(hideKey ? "none" : "");
			for (const field of ["Project ID", "Location", "Service Account JSON"]) {
				expect(settingNamed(root, field).style.display).toBe(id === "vertex" ? "" : "none");
			}
			expect(settingNamed(root, "Codex binary").style.display).toBe(id === "codex" ? "" : "none");
			expect(root.querySelector(".model-checklist")).toBe(list);
			expect(document.activeElement).toBe(preset);
			expect(root.scrollTop).toBe(137);
		}
	});

	it("keeps model checkboxes and parameter buttons mounted through selection changes", async () => {
		const onSave = vi.fn();
		const modal: any = new UnifiedProviderModal({} as any, onSave, {
			id: "provider", type: "Gemini", enabled: true, baseUrl: "", apiKey: "test",
		});
		modal.fetchedModelIds = ["vertex/gemini-3.1-pro-preview"];
		modal.onOpen();
		const root = modal.contentEl as Element;
		const list = root.querySelector(".model-checklist")!;
		const row = list.querySelector(".model-check-item")!;
		const checkbox = row.querySelector("input")!;
		const gear = row.querySelector("button")!;
		expect(gear.style.visibility).toBe("hidden");
		for (const checked of [true, false, true]) {
			checkbox.focus();
			list.scrollTop = 42;
			checkbox.checked = checked;
			await checkbox.listeners.get("change")!();
			expect(list.querySelector(".model-check-item")).toBe(row);
			expect(row.querySelector("input")).toBe(checkbox);
			expect(row.querySelector("button")).toBe(gear);
			expect(gear.style.visibility).toBe(checked ? "" : "hidden");
			expect(gear.disabled).toBe(!checked);
			expect(document.activeElement).toBe(checkbox);
			expect(list.scrollTop).toBe(42);
		}
		gear.focus();
		await gear.listeners.get("click")!();
		expect(document.activeElement).toBe(gear);
		expect(gear.attributes.get("aria-expanded")).toBe("true");
		expect(list.querySelector(".model-params-editor")!.style.display).toBe("");
		modal.save();
		expect(onSave.mock.calls[0][1]).toEqual([expect.objectContaining({ model: "vertex/gemini-3.1-pro-preview" })]);
	});

	it.each([false, true])("ignores a fetch for a previous preset (rejected: %s)", async rejected => {
		let resolve!: (models: string[]) => void;
		let reject!: (error: Error) => void;
		vi.mocked(fetchProviderModels).mockReturnValue(new Promise((done, fail) => { resolve = done; reject = fail; }));
		const modal: any = new UnifiedProviderModal({} as any, vi.fn());
		modal.onOpen();
		const root = modal.contentEl as Element;
		const button = root.querySelector(".provider-fetch-button")!;
		const pending = button.listeners.get("click")!();
		const preset = settingNamed(root, "Preset").querySelector("select")!;
		preset.value = "gemini";
		await preset.listeners.get("change")!();
		if (rejected) reject(new Error("Old request failed"));
		else resolve(["old-provider-model"]);
		await pending;
		expect(root.querySelector(".model-checklist")!.textContent).toBe('Click "Fetch models" to load available models.');
		expect(root.textContent).not.toContain("Old request failed");
		expect(button.disabled).toBe(false);
	});

	it("clears old selections and ignores pricing that finishes after a preset switch", async () => {
		vi.mocked(fetchProviderModels).mockResolvedValue(["old-provider-model"]);
		let finish!: (pricing: any) => void;
		vi.mocked(fetchPricingForModels).mockReturnValue(new Promise(resolve => { finish = resolve; }));
		const onSave = vi.fn();
		const modal: any = new UnifiedProviderModal({} as any, onSave);
		modal.selectedModelIds.add("old-provider-model");
		modal.onOpen();
		const root = modal.contentEl as Element;
		const pending = root.querySelector(".provider-fetch-button")!.listeners.get("click")!();
		await Promise.resolve();
		expect(finish).toBeTypeOf("function");
		const preset = settingNamed(root, "Preset").querySelector("select")!;
		preset.value = "gemini";
		await preset.listeners.get("change")!();
		finish(new Map([["old-provider-model", { inputCostPerMillion: 1, outputCostPerMillion: 2 }]]));
		await pending;
		expect(modal.pricingData).toBeUndefined();
		expect(root.querySelector(".model-checklist")!.textContent).not.toContain("old-provider-model");
		modal.save();
		expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: "Gemini" }), []);
	});
});

describe("cached input pricing on a model", () => {
	it("stores the cache-read rate so a warm prompt is not costed at full price", () => {
		const onSave = vi.fn();
		const provider = { id: "bifrost", type: "Bifrost", baseUrl: "https://example.test/v1", apiKey: "test", enabled: true };
		const model = { id: "selected", model: "vertex/gemini-3.1-flash-lite", providerId: provider.id, enabled: true };
		const modal: any = new UnifiedProviderModal({} as any, onSave, provider, [model]);
		modal.onOpen();
		modal.pricingData = new Map([[model.model, { inputCostPerMillion: 1, outputCostPerMillion: 4, cachedInputCostPerMillion: 0.25 }]]);
		modal.save();
		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({ id: provider.id }),
			[expect.objectContaining({ model: model.model, inputCostPerMillion: 1, cachedInputCostPerMillion: 0.25 })],
		);
	});
});

describe("fetching models for a local CLI provider", () => {
	it("reports how many models it found, not the path already shown above", async () => {
		const modal: any = new UnifiedProviderModal({} as any, vi.fn(), {
			id: "claude-cli", type: "Claude CLI", baseUrl: "", apiKey: "", enabled: true, binaryPath: process.execPath,
		});
		modal.onOpen();
		const fetchSetting = (modal.contentEl as Element).querySelectorAll(".setting-item")
			.find((item: any) => item.querySelector(".setting-item-name")?.textContent === "Available models")!;
		await fetchSetting.querySelector("button")!.listeners.get("click")!();
		const status = fetchSetting.querySelector(".provider-fetch-status")!;
		expect(status.textContent).toMatch(/^Found \d+ models$/);
		expect(status.textContent).not.toContain("/");
	});

	it("puts the status on its own row so a long message cannot be squeezed", () => {
		const modal: any = new UnifiedProviderModal({} as any, vi.fn(), {
			id: "codex", type: "Codex", baseUrl: "", apiKey: "", enabled: true,
		});
		modal.onOpen();
		const fetchSetting = (modal.contentEl as Element).querySelectorAll(".setting-item")
			.find((item: any) => item.querySelector(".setting-item-name")?.textContent === "Available models")!;
		expect(fetchSetting.querySelector(".provider-fetch-status")!.parentElement!.className)
			.toContain("provider-fetch-control");
	});
});

describe("collapsing configured providers", () => {
	const setup = () => {
		const plugin: any = {
			settings: {
				...DEFAULT_SETTINGS,
				providers: [
					{ id: "gemini", type: "Gemini", baseUrl: "", apiKey: "k", enabled: true },
					{ id: "bifrost", type: "Bifrost", baseUrl: "https://example.test/v1", apiKey: "k", enabled: true },
				],
				models: [{ id: "m1", model: "gemini-3-flash-preview", providerId: "gemini", enabled: true }],
			},
			saveSettings: vi.fn().mockResolvedValue(undefined),
		};
		const tab: any = new SettingsTab({} as any, plugin);
		const root = new Element();
		tab.renderProviders(root);
		return { tab, plugin, root, blocks: root.querySelectorAll(".provider-block") };
	};

	const body = (block: any) => block.querySelector(".provider-body")!;

	it("hides each provider's models until it is opened", () => {
		const { blocks } = setup();
		expect(blocks).toHaveLength(2);
		for (const block of blocks) expect(body(block).hidden).toBe(true);
	});

	it("still shows the name, the switch and what the provider is, while closed", () => {
		const { blocks } = setup();
		const header = blocks[0].querySelector(".provider-header")!;
		expect(header.hidden).toBeFalsy();
		expect(blocks[0].querySelector(".provider-meta")!.textContent).toContain("ID: gemini");
		expect(blocks[0].querySelector(".provider-meta")!.textContent).toContain("Models: 1/1");
	});

	it("opens one provider when its header is clicked, leaving the other closed", async () => {
		const { blocks } = setup();
		await blocks[0].querySelector(".provider-header")!.listeners.get("click")!({ target: blocks[0].querySelector(".provider-name") });
		expect(body(blocks[0]).hidden).toBe(false);
		expect(body(blocks[1]).hidden).toBe(true);
		expect(blocks[0].querySelector(".provider-header")!.attributes.get("aria-expanded")).toBe("true");
	});

	it("does not open a provider when its own buttons are used", async () => {
		const { blocks } = setup();
		const editButton = blocks[0].querySelectorAll("button").find((b: any) => b.textContent === "Edit")!;
		await blocks[0].querySelector(".provider-header")!.listeners.get("click")!({ target: editButton });
		expect(body(blocks[0]).hidden).toBe(true);
	});

	it("keeps an opened provider open when the settings redraw", async () => {
		const { tab, blocks } = setup();
		await blocks[0].querySelector(".provider-header")!.listeners.get("click")!({ target: blocks[0].querySelector(".provider-name") });
		const again = new Element();
		tab.renderProviders(again);
		const redrawn = again.querySelectorAll(".provider-block");
		expect(body(redrawn[0]).hidden).toBe(false);
		expect(body(redrawn[1]).hidden).toBe(true);
	});
});


describe("renaming a provider", () => {
	const saveWith = async (preset: string, name: string, others: any[] = []) => {
		const onSave = vi.fn();
		const modal: any = new UnifiedProviderModal({} as any, onSave, undefined, [], others);
		modal.onOpen();
		const root = modal.contentEl as Element;
		const select = settingNamed(root, "Preset").querySelector("select")!;
		select.value = preset;
		await select.listeners.get("change")!();
		const input = settingNamed(root, "Provider name").querySelector("input")!;
		input.value = name;
		await input.listeners.get("input")!();
		if (preset === "azure") {
			const url = settingNamed(root, "Base URL").querySelector("input")!;
			url.value = "https://example.services.ai.azure.com";
			await url.listeners.get("input")!();
		}
		modal.save();
		return onSave;
	};

	it("keeps the kind that decides the route and stores the name beside it", async () => {
		const onSave = await saveWith("gemini", "Work Gemini");
		expect(onSave).toHaveBeenCalledOnce();
		const saved = onSave.mock.calls[0][0];
		expect(saved).toEqual(expect.objectContaining({ id: "work-gemini", type: "Gemini", name: "Work Gemini", baseUrl: GEMINI_BASE_URL }));
	});

	it("does not store a name that is only the kind, so unrenamed providers save as before", async () => {
		const onSave = await saveWith("gemini", "Gemini");
		expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({ id: "gemini", type: "Gemini" }));
		expect("name" in onSave.mock.calls[0][0]).toBe(false);
	});

	it("treats a provider with no preset as an OpenAI-compatible endpoint", async () => {
		const onSave = vi.fn();
		const modal: any = new UnifiedProviderModal({} as any, onSave);
		modal.onOpen();
		const root = modal.contentEl as Element;
		for (const [field, value] of [["Provider name", "My gateway"], ["Base URL", "https://example.test/v1"]]) {
			const input = settingNamed(root, field).querySelector("input")!;
			input.value = value;
			await input.listeners.get("input")!();
		}
		modal.save();
		expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({ id: "my-gateway", type: "Custom", name: "My gateway" }));
	});

	it("edits the name of a saved provider without changing its id or kind", async () => {
		const onSave = vi.fn();
		const modal: any = new UnifiedProviderModal({} as any, onSave, { id: "gemini", type: "Gemini", baseUrl: "", apiKey: "k", enabled: true });
		modal.onOpen();
		const input = settingNamed(modal.contentEl, "Provider name").querySelector("input")!;
		expect(input.value).toBe("Gemini");
		input.value = "Personal Gemini";
		await input.listeners.get("input")!();
		modal.save();
		expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({ id: "gemini", type: "Gemini", name: "Personal Gemini" }));
	});

	it("numbers the id when another provider already has it", async () => {
		const others = [{ id: "azure", type: "Azure", name: "Personal Azure", baseUrl: "https://a.test", apiKey: "k", enabled: true }, { id: "azure-2", type: "Azure", name: "Lab Azure", baseUrl: "https://b.test", apiKey: "k", enabled: true }];
		const onSave = await saveWith("azure", "Azure", others);
		expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({ id: "azure-3", type: "Azure" }));
	});

	it("gives an endpoint named after a kind a numbered id, and the real kind the plain one", async () => {
		const custom = async (name: string) => {
			const onSave = vi.fn();
			const modal: any = new UnifiedProviderModal({} as any, onSave);
			modal.onOpen();
			const root = modal.contentEl as Element;
			for (const [field, value] of [["Provider name", name], ["Base URL", "https://example.test/v1"]]) {
				const input = settingNamed(root, field).querySelector("input")!;
				input.value = value;
				await input.listeners.get("input")!();
			}
			modal.save();
			return onSave.mock.calls[0][0];
		};
		expect((await custom("Azure")).id).toBe("azure-2");
		expect((await custom("Gemini")).id).toBe("gemini-2");
		expect((await custom("Ollama")).id).toBe("ollama-2");
		expect((await custom("Vertex")).id).toBe("vertex-2");
		expect((await custom("Google")).id).toBe("google-2");
		expect((await custom("Work")).id).toBe("work");
		expect((await saveWith("azure", "Azure")).mock.calls[0][0].id).toBe("azure");
		expect((await saveWith("gemini", "Google")).mock.calls[0][0].id).toBe("google");
		expect((await saveWith("ollama", "Ollama")).mock.calls[0][0].id).toBe("ollama");
	});

	it("keeps the box open and says so on the field when another provider has the name", async () => {
		const others = [{ id: "work", type: "Azure", name: "Work Azure", baseUrl: "https://a.test", apiKey: "k", enabled: true }];
		const onSave = vi.fn();
		const modal: any = new UnifiedProviderModal({} as any, onSave, undefined, [], others);
		const close = vi.spyOn(modal, "close");
		modal.onOpen();
		const root = modal.contentEl as Element;
		const field = settingNamed(root, "Provider name");
		const input = field.querySelector("input")!;
		input.value = "work azure";
		await input.listeners.get("input")!();
		modal.save();
		expect(field.querySelector(".ac-setting-error")!.textContent).toBe("Another provider already has this name.");
		expect(input.classList.contains("mod-warning")).toBe(true);
		expect(document.activeElement).toBe(input);
		expect(onSave).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
		input.value = "Other Azure";
		await input.listeners.get("input")!();
		expect(field.querySelector(".ac-setting-error")!.textContent).toBe("");
	});

	it("does not count the provider being edited as a clash", () => {
		const self = { id: "gemini", type: "Gemini", baseUrl: "", apiKey: "k", enabled: true };
		const onSave = vi.fn();
		const modal: any = new UnifiedProviderModal({} as any, onSave, self, [], [self, { id: "azure", type: "Azure", baseUrl: "https://a.test", apiKey: "k", enabled: true }]);
		modal.onOpen();
		modal.save();
		expect(onSave).toHaveBeenCalledOnce();
	});

	it("falls back to the kind for a provider that was never named", () => {
		expect(providerLabel({ type: "Azure" })).toBe("Azure");
		expect(providerLabel({ type: "Azure", name: "  " })).toBe("Azure");
		expect(providerLabel({ type: "Azure", name: "Work Azure" })).toBe("Work Azure");
	});

	it("has no Add Model button, since Edit opens the same box", () => {
		const provider = { id: "empty", type: "Custom", baseUrl: "https://example.test", apiKey: "k", enabled: true };
		const plugin: any = { settings: { ...DEFAULT_SETTINGS, providers: [provider], models: [], activeProvider: "empty" }, saveSettings: vi.fn() };
		const tab: any = new SettingsTab({} as any, plugin);
		const root = new Element();
		tab.renderProviders(root);
		const buttons = root.querySelectorAll("button").map(button => button.textContent);
		expect(buttons).not.toContain("Add Model");
		expect(buttons).toContain("Edit");
		expect(root.querySelector(".provider-model-list")!.textContent).toBe("No models yet. Use Edit to fetch and add them.");
	});

	it("shows the name in the provider dropdowns and on the card", () => {
		const providers = [
			{ id: "work-azure", type: "Azure", name: "Work Azure", baseUrl: "https://example.test", apiKey: "k", enabled: true },
			{ id: "gemini", type: "Gemini", baseUrl: "", apiKey: "k", enabled: true },
		];
		const models = providers.map(p => ({ id: `${p.id}-m`, model: "m", providerId: p.id, enabled: true }));
		const plugin: any = { settings: { ...DEFAULT_SETTINGS, providers, models, activeProvider: "work-azure" }, saveSettings: vi.fn() };
		const tab: any = new SettingsTab({} as any, plugin);
		const root = new Element();
		tab.renderGeneralSettings(root);
		tab.renderImageSettings(root);
		tab.renderProviders(root);
		const options = root.querySelectorAll("option").map(option => option.text);
		expect(options).toContain("Work Azure");
		expect(options).toContain("Gemini");
		expect(options).not.toContain("Azure");
		expect(root.querySelectorAll(".provider-name").map(item => item.textContent)).toEqual(["Work Azure", "Gemini"]);
		expect(root.querySelector(".provider-header")!.attributes.get("aria-label")).toBe("Work Azure settings");
	});
});


describe("saving an edited provider", () => {
	const cliProvider = { id: "pi-cli", type: "Pi CLI", baseUrl: "", apiKey: "", enabled: true, binaryPath: process.execPath, cliArgs: "--provider openrouter" };

	it("keeps a CLI provider's extra arguments when nothing was changed", () => {
		const onSave = vi.fn();
		const modal: any = new UnifiedProviderModal({} as any, onSave, cliProvider);
		modal.onOpen();
		modal.save();
		expect(onSave.mock.calls[0][0].cliArgs).toBe("--provider openrouter");
	});

	it("saves extra arguments the user typed and drops them when cleared", async () => {
		const onSave = vi.fn();
		const modal: any = new UnifiedProviderModal({} as any, onSave, cliProvider);
		modal.onOpen();
		const input = settingNamed(modal.contentEl, "Extra arguments").querySelector("input")!;
		input.value = "--model small";
		await input.listeners.get("input")!();
		modal.save();
		input.value = "";
		await input.listeners.get("input")!();
		modal.save();
		expect(onSave.mock.calls.map(call => call[0].cliArgs)).toEqual(["--model small", undefined]);
	});

	it("keeps a model's Text/Image choice, manual prices and id when nothing was changed", () => {
		const onSave = vi.fn();
		const provider = { id: "bifrost", type: "Bifrost", baseUrl: "https://example.test/v1", apiKey: "k", enabled: true };
		const model = {
			id: "picked-earlier", model: "image-maker", providerId: "bifrost", enabled: true, kind: "image" as const,
			costOverridden: true, inputCostPerMillion: 7, outputCostPerMillion: 9,
		};
		const modal: any = new UnifiedProviderModal({} as any, onSave, provider, [model]);
		modal.onOpen();
		modal.pricingData = new Map([[model.model, { inputCostPerMillion: 1, outputCostPerMillion: 2 }]]);
		modal.save();
		expect(onSave.mock.calls[0][1]).toEqual([expect.objectContaining(model)]);
	});

	it("keeps models that are switched off, and turns on one the user ticks", () => {
		const onSave = vi.fn();
		const provider = { id: "bifrost", type: "Bifrost", baseUrl: "https://example.test/v1", apiKey: "k", enabled: true };
		const models = ["on-model", "off-model", "later-model"].map((model, index) => ({
			id: `m${index}`, model, providerId: "bifrost", enabled: model === "on-model",
		}));
		const modal: any = new UnifiedProviderModal({} as any, onSave, provider, models);
		modal.onOpen();
		modal.save();
		const unchanged = onSave.mock.calls[0][1];
		expect(unchanged.map((m: any) => [m.id, m.enabled]).sort()).toEqual([["m0", true], ["m1", false], ["m2", false]]);

		modal.selectedModelIds.add("off-model");
		modal.selectedModelIds.delete("on-model");
		modal.save();
		const changed = onSave.mock.calls[1][1];
		expect(changed.map((m: any) => [m.id, m.enabled]).sort()).toEqual([["m0", false], ["m1", true], ["m2", false]]);
	});

	it("keeps a parameter change on a model that is then switched off", () => {
		const onSave = vi.fn();
		const provider = { id: "gemini", type: "Gemini", baseUrl: "", apiKey: "k", enabled: true };
		const model = { id: "m0", model: "gemini-3-flash-preview", providerId: "gemini", enabled: true, providerParams: { serviceTier: "standard" } };
		const modal: any = new UnifiedProviderModal({} as any, onSave, provider, [model]);
		modal.onOpen();
		modal.modelParams.set(model.model, { serviceTier: "flex" });
		modal.selectedModelIds.delete(model.model);
		modal.save();
		expect(onSave.mock.calls[0][1]).toEqual([expect.objectContaining({ id: "m0", enabled: false, providerParams: { serviceTier: "flex" } })]);
	});

	it("keeps provider fields the box does not show and drops a name that went back to the kind", async () => {
		const onSave = vi.fn();
		const saved: any = { id: "gemini", type: "Gemini", name: "Work Gemini", baseUrl: "", apiKey: "k", enabled: true, addedLater: "kept" };
		const modal: any = new UnifiedProviderModal({} as any, onSave, saved);
		modal.onOpen();
		modal.save();
		expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({ name: "Work Gemini", addedLater: "kept" }));
		const input = settingNamed(modal.contentEl, "Provider name").querySelector("input")!;
		input.value = "Gemini";
		await input.listeners.get("input")!();
		modal.save();
		expect("name" in onSave.mock.calls[1][0]).toBe(false);
	});
});


describe("models listed when a provider is edited", () => {
	const provider = { id: "bifrost", type: "Bifrost", baseUrl: "https://example.test/v1", apiKey: "k", enabled: true };
	const models = [
		{ id: "m0", model: "on-model", providerId: "bifrost", enabled: true },
		{ id: "m1", model: "off-model", providerId: "bifrost", enabled: false },
	];

	it("lists the provider's own models, ticked when on, before anything is fetched", () => {
		const modal: any = new UnifiedProviderModal({} as any, vi.fn(), provider, models);
		modal.onOpen();
		const rows = (modal.contentEl as Element).querySelectorAll(".model-check-item");
		expect(rows.map(row => [row.querySelector(".model-check-label")!.textContent, row.querySelector("input")!.checked]))
			.toEqual([["on-model", true], ["off-model", false]]);
		expect((modal.contentEl as Element).textContent).not.toContain('Click "Fetch models"');
	});

	it("keeps a hand-typed model and the provider's own models when Fetch returns a list", async () => {
		vi.mocked(fetchProviderModels).mockResolvedValue(["fetched-model", "on-model"]);
		const modal: any = new UnifiedProviderModal({} as any, vi.fn(), provider, models);
		modal.onOpen();
		const root = modal.contentEl as Element;
		modal.customModelInput = "typed-by-hand";
		await root.querySelectorAll("button").find(button => button.textContent === "+ Add")!.listeners.get("click")!();
		await root.querySelector(".provider-fetch-button")!.listeners.get("click")!();
		expect(root.querySelectorAll(".model-check-label").map(label => label.textContent).sort())
			.toEqual(["fetched-model", "off-model", "on-model", "typed-by-hand"]);
	});
});


describe("providers that return no model list", () => {
	const fetchRow = (root: Element) => settingNamed(root, "Available models");

	it("hides the fetch row for Vertex, including when the preset moves to and from it", async () => {
		const modal: any = new UnifiedProviderModal({} as any, vi.fn());
		modal.onOpen();
		const root = modal.contentEl as Element;
		const preset = settingNamed(root, "Preset").querySelector("select")!;
		const shown = [] as string[];
		for (const id of ["openai", "vertex", "gemini", "vertex", "azure"]) {
			preset.value = id;
			await preset.listeners.get("change")!();
			shown.push(fetchRow(root).style.display);
		}
		expect(shown).toEqual(["", "none", "", "none", ""]);
	});

	it("hides the fetch row when a saved Vertex provider is edited, and says there is no list", () => {
		const modal: any = new UnifiedProviderModal({} as any, vi.fn(), { id: "vertex", type: "Vertex", baseUrl: "", apiKey: "", enabled: true });
		modal.onOpen();
		const root = modal.contentEl as Element;
		expect(fetchRow(root).style.display).toBe("none");
		expect(root.querySelector(".model-checklist")!.textContent).toBe("Vertex has no model list. Type model names below.");
	});

	it("warns, without the success style, when another provider returns zero models", async () => {
		vi.mocked(fetchProviderModels).mockResolvedValue([]);
		const modal: any = new UnifiedProviderModal({} as any, vi.fn(), { id: "groq", type: "Groq", baseUrl: "https://example.test/v1", apiKey: "k", enabled: true });
		modal.onOpen();
		const row = fetchRow(modal.contentEl as Element);
		expect(row.style.display).toBe("");
		await row.querySelector("button")!.listeners.get("click")!();
		const status = row.querySelector(".provider-fetch-status")!;
		expect(status.textContent).toBe("No models returned. Type model names below.");
		expect(status.classList.contains("mod-warning")).toBe(true);
		expect(status.classList.contains("mod-success")).toBe(false);
	});
});


describe("an image model that is switched off", () => {
	const setup = () => {
		const providers = [
			{ id: "bifrost", type: "Bifrost", baseUrl: "https://example.test/v1", apiKey: "k", enabled: true },
			{ id: "other", type: "Custom", baseUrl: "https://other.test/v1", apiKey: "k", enabled: true },
		];
		const models = [
			{ id: "text", model: "text-model", providerId: "bifrost", enabled: true },
			{ id: "image", model: "image-model", providerId: "bifrost", enabled: true },
			{ id: "other-m", model: "other-model", providerId: "other", enabled: true },
		];
		const plugin: any = {
			settings: { ...DEFAULT_SETTINGS, providers, models, activeProvider: "bifrost", apiModel: "text", imageProviderId: "", imageModelId: "image" },
			saveSettings: vi.fn().mockResolvedValue(undefined),
		};
		const tab: any = new SettingsTab({} as any, plugin);
		vi.spyOn(tab, "display").mockImplementation(() => {});
		const root = new Element();
		tab.renderProviders(root);
		return { plugin, root, models };
	};

	it("is forgotten when it is unticked in Edit", async () => {
		const { plugin, root, models } = setup();
		let box: any;
		vi.spyOn(UnifiedProviderModal.prototype, "open").mockImplementation(function (this: any) { box = this; });
		await root.querySelectorAll("button").find(button => button.textContent === "Edit")!.listeners.get("click")!();
		await box.onSave(plugin.settings.providers[0], models.slice(0, 2).map(model => ({ ...model, enabled: model.id === "text" })));
		expect(plugin.settings.imageModelId).toBe("");
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
	});

	it("is forgotten when its checkbox is cleared in the provider's list", async () => {
		const { plugin, root } = setup();
		const row = root.querySelectorAll(".provider-model-row").find(item => item.querySelector(".provider-model-name")!.textContent!.startsWith("image-model"))!;
		const checkbox = row.querySelector("input")!;
		checkbox.checked = false;
		await checkbox.listeners.get("change")!();
		expect(plugin.settings.imageModelId).toBe("");
	});

	it("is kept when another model is switched off", async () => {
		const { plugin, root } = setup();
		const row = root.querySelectorAll(".provider-model-row").find(item => item.querySelector(".provider-model-name")!.textContent!.startsWith("text-model"))!;
		const checkbox = row.querySelector("input")!;
		checkbox.checked = false;
		await checkbox.listeners.get("change")!();
		expect(plugin.settings.imageModelId).toBe("image");
	});

	it("stays forgotten when an earlier deletion is undone after its provider was deleted", async () => {
		const providers = ["main", "extra", "images"].map(id => ({ id, type: "Custom", baseUrl: "https://example.test/v1", apiKey: "k", enabled: true }));
		const models = providers.map(p => ({ id: `${p.id}-m`, model: `${p.id}-m`, providerId: p.id, enabled: true }));
		const plugin: any = {
			settings: { ...DEFAULT_SETTINGS, providers, models, activeProvider: "main", apiModel: "main-m", imageProviderId: "images", imageModelId: "images-m" },
			saveSettings: vi.fn().mockResolvedValue(undefined),
		};
		const tab: any = new SettingsTab({} as any, plugin);
		vi.spyOn(tab, "display").mockImplementation(() => {});
		const notice = vi.spyOn(obsidian, "Notice");
		const root = new Element();
		tab.renderProviders(root);
		const cards = root.querySelectorAll(".provider-block");
		const remove = (index: number) => cards[index].querySelectorAll("button").find(button => button.textContent === "Delete")!.listeners.get("click")!();
		await remove(1);
		await remove(2);
		expect([plugin.settings.imageProviderId, plugin.settings.imageModelId]).toEqual(["", ""]);
		const undoFirst = (notice.mock.instances[0].noticeEl as any as Element).querySelector("button")!;
		await undoFirst.listeners.get("click")!();
		expect(plugin.settings.providers.map((p: any) => p.id)).toEqual(["main", "extra"]);
		expect([plugin.settings.imageProviderId, plugin.settings.imageModelId]).toEqual(["", ""]);
	});

	it("is forgotten when its provider is deleted, and Undo brings the choice back", async () => {
		const { plugin, root } = setup();
		plugin.settings.imageProviderId = "other";
		plugin.settings.imageModelId = "other-m";
		const notice = vi.spyOn(obsidian, "Notice");
		const card = root.querySelectorAll(".provider-block")[1];
		await card.querySelectorAll("button").find(button => button.textContent === "Delete")!.listeners.get("click")!();
		expect([plugin.settings.imageProviderId, plugin.settings.imageModelId]).toEqual(["", ""]);
		const undo = (notice.mock.instances[0].noticeEl as any as Element).querySelector("button")!;
		await undo.listeners.get("click")!();
		expect([plugin.settings.imageProviderId, plugin.settings.imageModelId]).toEqual(["other", "other-m"]);
	});
});


describe("a provider whose id is an object property name", () => {
	it.each(["constructor", "__proto__", "toString"])("renders %s and keeps its filter", async id => {
		const providers = [{ id, type: "Custom", name: "Odd id", baseUrl: "https://example.test/v1", apiKey: "k", enabled: true }];
		const models = ["alpha", "beta"].map(model => ({ id: `${id}-${model}`, model, providerId: id, enabled: true }));
		const plugin: any = { settings: { ...DEFAULT_SETTINGS, providers, models, activeProvider: id, apiModel: models[0].id }, saveSettings: vi.fn() };
		const tab: any = new SettingsTab({} as any, plugin);
		const root = new Element();
		expect(() => tab.renderProviders(root)).not.toThrow();
		const names = () => root.querySelectorAll(".provider-model-name").map(item => item.textContent);
		expect(names()).toHaveLength(2);

		const filter = root.querySelector(".provider-models-filter")!.querySelector("input")!;
		filter.value = "alp";
		await filter.listeners.get("input")!();
		expect(names().map(text => text!.startsWith("alpha"))).toEqual([true]);
		expect(tab.modelFilters.get(id)).toBe("alp");

		const again = new Element();
		tab.renderProviders(again);
		expect(again.querySelectorAll(".provider-model-name")).toHaveLength(1);
	});
});


describe("adding a provider end to end", () => {
	it("picks a preset, fetches the real model list, ticks a model and saves it", async () => {
		// Only the network call is replaced; the listing code is the real one.
		const actual = await vi.importActual<typeof import("../src/utils/modelFetch")>("../src/utils/modelFetch");
		vi.mocked(fetchProviderModels).mockImplementationOnce(actual.fetchProviderModels);
		const request = vi.spyOn(obsidian, "requestUrl").mockResolvedValue({ json: { data: [{ id: "model-a" }, { id: "model-b" }] } } as any);
		const onSave = vi.fn();
		const modal: any = new UnifiedProviderModal({} as any, onSave);
		modal.onOpen();
		const root = modal.contentEl as Element;

		const preset = settingNamed(root, "Preset").querySelector("select")!;
		preset.value = "groq";
		await preset.listeners.get("change")!();
		for (const [field, value] of [["Base URL", "https://example.test/v1"], ["API key", "secret-key"]]) {
			const input = settingNamed(root, field).querySelector("input")!;
			input.value = value;
			await input.listeners.get("input")!();
		}
		await root.querySelector(".provider-fetch-button")!.listeners.get("click")!();

		expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: "https://example.test/v1/models", headers: { Authorization: "Bearer secret-key" } }));
		expect(root.querySelector(".provider-fetch-status")!.textContent).toBe("Found 2 models");
		const row = root.querySelectorAll(".model-check-item").find(item => item.querySelector(".model-check-label")!.textContent === "model-b")!;
		const checkbox = row.querySelector("input")!;
		checkbox.checked = true;
		await checkbox.listeners.get("change")!();
		modal.save();

		const [provider, models] = onSave.mock.calls[0];
		expect(provider).toEqual(expect.objectContaining({ id: "groq", type: "Groq", baseUrl: "https://example.test/v1", apiKey: "secret-key" }));
		expect(models).toEqual([expect.objectContaining({ id: "groq-model-b", providerId: "groq", model: "model-b", enabled: true })]);
	});
});
