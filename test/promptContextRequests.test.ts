import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as obsidian from "obsidian";
import AugmentedCanvasPlugin from "../src/AugmentedCanvasPlugin";
import { PromptContextModal } from "../src/Modals/PromptContextModal";
import { ModelSelectionModal } from "../src/Modals/ModelSelectionModal";
import { noteGenerator } from "../src/actions/canvasNodeMenuActions/noteGenerator";
import {
	addAskAIButton,
	addAskAIWithModelButton,
	addRegenerateResponse,
	handleCallAI_Question,
} from "../src/actions/canvasNodeMenuActions/advancedCanvas";
import { DEFAULT_SETTINGS } from "../src/settings/AugmentedCanvasSettings";
import { addModelIndicator, restoreModelIndicators, setupCanvasIndicatorPersistence } from "../src/utils";
import { streamResponse } from "../src/utils/llm";
import * as indicators from "../src/utils";
import { getAllMCPTools } from "../src/utils/mcpClient";

vi.mock("../src/utils/mcpClient", () => ({ getAllMCPTools: vi.fn() }));
vi.mock("../src/data/prompts.csv.txt", () => ({ default: "act,prompt" }));
vi.mock("../src/utils/llm", () => ({ streamResponse: vi.fn(), getResponse: vi.fn() }));
vi.mock("../src/obsidian/canvas-patches", async (importOriginal) => ({
	...await importOriginal<typeof import("../src/obsidian/canvas-patches")>(),
	createNode: (canvas: any, options: any, parent: any, data: any) => {
		const node = canvas.makeNode("response", options.text);
		node.setData(data);
		return node;
	},
}));

class Element {
	children: Element[] = [];
	parent?: Element;
	className = "";
	textContent = "";
	style = { cssText: "" };
	attributes = new Map<string, string>();
	listeners = new Map<string, () => unknown>();
	createEl(tag: string, options?: { cls?: string; text?: string }) {
		const child = new Element();
		child.className = options?.cls ?? "";
		child.textContent = options?.text ?? "";
		this.appendChild(child);
		return child;
	}
	appendChild(child: Element) { child.parent = this; this.children.push(child); }
	querySelector(selector: string): Element | null {
		for (const child of this.children) {
			if (child.className.split(" ").includes(selector.slice(1))) return child;
			const nested = child.querySelector(selector);
			if (nested) return nested;
		}
		return null;
	}
	remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
	setAttribute(name: string, value: string) { this.attributes.set(name, value); }
	addEventListener(name: string, listener: () => unknown) { this.listeners.set(name, listener); }
	click() { return this.listeners.get("click")?.(); }
	setText(text: string) { this.textContent = text; }
	getText() { return this.textContent; }
	addClass(name: string) { this.className = `${this.className} ${name}`.trim(); }
	removeClass(...names: string[]) { this.className = this.className.split(" ").filter(value => !names.includes(value)).join(" "); }
	contains(child: Element): boolean { return this.children.some(entry => entry === child || entry.contains(child)); }
}

const fixture = (ancestors = true) => {
	const events = new Map<string, (...args: any[]) => void>();
	const canvas: any = {
		nodes: new Map(),
		edges: [],
		selection: new Set(),
		requestSave: vi.fn().mockResolvedValue(undefined),
		requestFrame: vi.fn().mockResolvedValue(undefined),
		getData() { return { edges: [] }; },
		getEdgesForNode(node: any) {
			return this.edges.filter((edge: any) => edge.from.node === node || edge.to.node === node);
		},
	};
	canvas.makeNode = (id: string, text: string) => {
		const node: any = {
			id, text, canvas, x: 0, y: 0, width: 400, height: 400,
			unknownData: { id, type: "text", text },
			contentEl: new Element(),
			nodeEl: new Element(),
			getData() { return { ...this.unknownData, text: this.text }; },
			setData(data: any) { Object.assign(this.unknownData, data); },
			setText(text: string) { this.text = text; this.contentEl.children = []; },
			moveAndResize: vi.fn(),
		};
		canvas.nodes.set(id, node);
		return node;
	};
	const prompt = canvas.makeNode("prompt", "CURRENT");
	if (ancestors) {
		const parent = canvas.makeNode("parent", "PARENT");
		const oldest = canvas.makeNode("oldest", "OLDEST");
		canvas.edges.push(
			{ from: { node: parent, side: "right" }, to: { node: prompt }, label: "edge label" },
			{ from: { node: oldest, side: "right" }, to: { node: parent } },
		);
	}
	canvas.selection.add(prompt);
	const app: any = { workspace: {
		getActiveViewOfType: () => ({ canvas }),
		on: (name: string, handler: (...args: any[]) => void) => events.set(name, handler),
		off: vi.fn(),
	} };
	const provider = { id: "test-provider", type: "Custom", apiKey: "test", enabled: true };
	const model = { id: "test-model", providerId: provider.id, model: "test-model", enabled: true };
	const settings: any = {
		...DEFAULT_SETTINGS,
		apiKey: "test", activeProvider: provider.id, apiModel: model.id,
		providers: [provider], models: [model], systemPrompt: "SYSTEM",
		mcpEnabled: false, enableCardTitleGeneration: false,
	};
	return { app, canvas, prompt, settings, events, provider, model };
};

const badge = (node: any) => node.contentEl.querySelector(".ai-model-indicator") as Element;
const run = async (action: () => unknown) => {
	const result = action();
	await vi.advanceTimersByTimeAsync(250);
	await result;
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("document", { createElement: () => new Element() });
	vi.stubGlobal("createEl", () => new Element());
	vi.spyOn(PromptContextModal.prototype, "open");
	vi.spyOn(obsidian, "Notice");
	vi.mocked(streamResponse).mockImplementation(async (provider, messages, options, callback) => {
		callback("ANSWER", null, null, null);
		callback(null, { text: "ANSWER" }, null, null);
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("context picker request paths", () => {
	it.each([false, true])("scopes generating styles to the request and clears them (error: %s)", async (fail) => {
		const { app, canvas, settings } = fixture(false);
		vi.mocked(streamResponse).mockImplementation(async (provider, messages, options, callback) => {
			const response = canvas.nodes.get("response");
			expect(response.nodeEl.className).toContain("ai-generating");
			callback("text", null, null, null);
			expect(response.nodeEl.className).toContain("ai-generating");
			expect(badge(response).style.cssText).not.toContain("backdrop-filter");
			if (fail) throw new Error("failed");
			callback(null, { text: "text" }, null, null);
			expect(response.nodeEl.className).not.toContain("ai-generating");
		});
		await run(() => noteGenerator(app, settings).generateNote());
		expect(canvas.nodes.get("response").nodeEl.className).not.toContain("ai-generating");
	});
	it("bounds streamed resizes and keeps one badge across 100 deltas", async () => {
		const { app, canvas, settings } = fixture(false);
		const add = vi.spyOn(indicators, "addModelIndicator");
		vi.mocked(streamResponse).mockImplementation(async (provider, messages, options, callback) => {
			const response = canvas.nodes.get("response");
			const indicator = badge(response);
			const sizes: { at: number; width: number; height: number }[] = [];
			const started = Date.now();
			response.moveAndResize.mockImplementation((size: any) => {
				sizes.push({ at: Date.now(), ...size });
				Object.assign(response, size);
			});
			for (let index = 0; index < 100; index++) {
				await vi.advanceTimersByTimeAsync(10);
				callback("word ", null, null, null);
				expect(badge(response)).toBe(indicator);
			}
			const elapsed = Date.now() - started;
			expect(elapsed).toBe(1000);
			for (let index = 1; index < sizes.length; index++) {
				expect(sizes[index].at - sizes[index - 1].at).toBeGreaterThanOrEqual(500);
				expect(sizes[index].height).toBeGreaterThan(sizes[index - 1].height);
				expect(sizes[index].width).toBeGreaterThanOrEqual(sizes[index - 1].width);
			}
			expect(add).toHaveBeenCalledOnce();
			callback(null, { text: response.text }, null, null);
			expect(response.moveAndResize.mock.calls.length).toBeLessThanOrEqual(Math.ceil(elapsed / 500) + 1);
			expect(sizes).toHaveLength(3);
			expect(badge(response)).toBe(indicator);
		});
		const pending = noteGenerator(app, settings).generateNote();
		await vi.advanceTimersByTimeAsync(200);
		await pending;
		expect(add).toHaveBeenCalledTimes(2);
	});

	it("does not shrink during streaming and applies the exact size on completion", async () => {
		const { app, canvas, settings } = fixture(false);
		vi.mocked(streamResponse).mockImplementation(async (provider, messages, options, callback) => {
			const response = canvas.nodes.get("response");
			response.height = 900;
			response.width = 700;
			await vi.advanceTimersByTimeAsync(600);
			callback("short", null, null, null);
			expect(response.moveAndResize).not.toHaveBeenCalled();
			callback(null, { text: "short" }, null, null);
			expect(response.moveAndResize).toHaveBeenCalledExactlyOnceWith({ x: 0, y: 0, width: 300, height: 500 });
		});
		const pending = noteGenerator(app, settings).generateNote();
		await vi.advanceTimersByTimeAsync(200);
		await pending;
	});
	it("reserves the final and loading labels from the first frame", () => {
		const { prompt } = fixture(false);
		prompt.setData({ ai_context_count: 3 });
		addModelIndicator(prompt, "Custom", "test-model", true);
		const indicator = badge(prompt);
		const sizing = indicator.querySelector(".ai-model-indicator-size")!;
		const label = indicator.querySelector(".ai-model-indicator-label")!;
		expect(sizing.textContent).toBe("3 cards • Custom • test-model");
		expect(indicator.querySelector(".ai-model-indicator-loading-size")!.textContent).toBe("3 cards • generating");
		expect(sizing.attributes.get("aria-hidden")).toBe("true");
		expect(label.textContent).toBe("3 cards • generating");
		expect(indicator.attributes.get("data-state")).toBe("generating");
		indicators.setModelIndicatorText(prompt, "Custom", "test-model", false);
		expect(indicator.querySelector(".ai-model-indicator-size")).toBe(sizing);
		expect(sizing.textContent).toBe("3 cards • Custom • test-model");
		expect(label.textContent).toBe(sizing.textContent);
		expect(indicator.attributes.get("data-state")).toBe("complete");
	});

	it("reuses the badge element when its text changes", () => {
		const { prompt } = fixture(false);
		addModelIndicator(prompt, "Custom", "first", true);
		const indicator = badge(prompt);
		addModelIndicator(prompt, "Custom", "second");
		expect(badge(prompt)).toBe(indicator);
		expect(indicator.querySelector(".ai-model-indicator-label")!.textContent).toBe("Custom • second");
	});

	it.each(["isContentMounted", "initialized"])("does not restore badges on nodes with %s=false", (flag) => {
		const { canvas, prompt } = fixture(false);
		prompt[flag] = false;
		prompt.setData({ ai_provider: "Custom", ai_model: "test" });
		const read = vi.spyOn(prompt, "getData");
		restoreModelIndicators(canvas);
		expect(read).not.toHaveBeenCalled();
		expect(badge(prompt)).toBeNull();
	});
	it.each(["Ask AI", "Ask AI (select model)", "Ask Question"])("%s skips the picker and sends all ancestors by default", async (entry) => {
		const { app, canvas, prompt, settings, provider, model } = fixture();
		const menu = new Element();
		if (entry === "Ask Question") {
			await run(() => handleCallAI_Question(app, settings, prompt, "QUESTION"));
		} else if (entry === "Ask AI (select model)") {
			vi.spyOn(ModelSelectionModal.prototype, "open").mockImplementation(function () {
				return (this as any).onSelect({ provider, model });
			});
			await addAskAIWithModelButton(app, settings, menu as any);
			await run(() => menu.children[0].click());
		} else {
			await addAskAIButton(app, settings, menu as any);
			await run(() => menu.children[0].click());
		}
		expect(settings.alwaysAskPromptContext).toBe(false);
		expect(PromptContextModal.prototype.open).not.toHaveBeenCalled();
		expect(streamResponse).toHaveBeenCalledOnce();
		expect(vi.mocked(streamResponse).mock.calls[0][1].map((message: any) => message.content)).toEqual([
			"SYSTEM", "OLDEST", "PARENT", "edge label", "CURRENT", ...(entry === "Ask Question" ? ["QUESTION"] : []),
		]);
		const response = canvas.nodes.get("response");
		expect(response.getData().ai_context_count).toBe(3);
		expect(badge(response).querySelector(".ai-model-indicator-label")!.textContent).toBe("3 cards • Custom • test-model");
	});

	it("the setting opens the picker and only sends the selection after Continue", async () => {
		const { app, canvas, settings } = fixture();
		settings.alwaysAskPromptContext = true;
		await run(() => noteGenerator(app, settings).generateNote());
		expect(PromptContextModal.prototype.open).toHaveBeenCalledOnce();
		expect(streamResponse).not.toHaveBeenCalled();
		expect(canvas.nodes.has("response")).toBe(false);
		const modal: any = vi.mocked(PromptContextModal.prototype.open).mock.instances[0];
		expect(modal.options.map((option: any) => option.id)).toEqual(["prompt", "parent", "oldest"]);
		await run(() => modal.onSubmit(new Set(["prompt", "oldest"])));
		expect(PromptContextModal.prototype.open).toHaveBeenCalledOnce();
		expect(vi.mocked(streamResponse).mock.calls[0][1].map((message: any) => message.content)).toEqual(["SYSTEM", "OLDEST", "CURRENT"]);
		expect(canvas.nodes.get("response").getData().ai_context_count).toBe(2);
		expect(badge(canvas.nodes.get("response")).querySelector(".ai-model-indicator-label")!.textContent).toBe("2 cards • Custom • test-model");
	});

	it("the setting skips the picker for a single card", async () => {
		const { app, settings, canvas } = fixture(false);
		settings.alwaysAskPromptContext = true;
		await run(() => noteGenerator(app, settings).generateNote());
		expect(PromptContextModal.prototype.open).not.toHaveBeenCalled();
		expect(canvas.nodes.get("response").getData().ai_context_count).toBe(1);
		expect(badge(canvas.nodes.get("response")).querySelector(".ai-model-indicator-label")!.textContent).toBe("1 card • Custom • test-model");
		addModelIndicator(canvas.nodes.get("response"), "Custom", "test-model", true);
		expect(badge(canvas.nodes.get("response")).querySelector(".ai-model-indicator-label")!.textContent).toBe("1 card • generating");
	});

	it.each([false, true])("the card context menu always opens the picker (ancestors: %s)", async (ancestors) => {
		const { app, settings, prompt, canvas, events } = fixture(ancestors);
		const plugin: any = new AugmentedCanvasPlugin();
		Object.assign(plugin, { app, settings, registerEvent: vi.fn() });
		plugin.patchNoteContextMenu();
		const items: any[] = [];
		const menu = { addSeparator() {}, addItem(callback: (item: any) => void) {
			const item = {
				title: "", click: () => {},
				setTitle(title: string) { this.title = title; return this; },
				setIcon() { return this; },
				onClick(click: () => void) { this.click = click; return this; },
			};
			callback(item);
			items.push(item);
		} };
		canvas.selection.clear(); // The right-clicked card need not be selected.
		events.get("canvas:node-menu")!(menu, prompt);
		await run(() => items.find(item => item.title === "Ask AI with chosen context…").click());
		expect(PromptContextModal.prototype.open).toHaveBeenCalledOnce();
		expect(streamResponse).not.toHaveBeenCalled();
	});

	it.each([false, true])("the generated edge menu always opens the picker and updates the existing response (ancestors: %s)", async (ancestors) => {
		const { app, settings, canvas, prompt } = fixture(ancestors);
		const response = canvas.makeNode("existing-response", "OLD ANSWER");
		canvas.selection = new Set([{ from: { node: prompt }, to: { node: response } }]);
		const menu = new Element();
		await addRegenerateResponse(app, settings, menu as any);
		await run(() => menu.children.find(child => child.attributes.get("aria-label") === "Regenerate with chosen context…")!.click());
		expect(PromptContextModal.prototype.open).toHaveBeenCalledOnce();
		expect(response.text).toBe("OLD ANSWER");
		expect(streamResponse).not.toHaveBeenCalled();
		const modal: any = vi.mocked(PromptContextModal.prototype.open).mock.instances[0];
		await run(() => modal.onSubmit(new Set(["prompt"])));
		expect(response.text).toBe("ANSWER");
		expect(response.getData().ai_context_count).toBe(1);
		expect(canvas.nodes.has("response")).toBe(false);
	});

	it("ordinary regeneration still sends the full chain immediately", async () => {
		const { app, settings, canvas, prompt } = fixture();
		const response = canvas.makeNode("existing-response", "OLD ANSWER");
		canvas.selection = new Set([{ from: { node: prompt }, to: { node: response } }]);
		const menu = new Element();
		await addRegenerateResponse(app, settings, menu as any);
		await run(() => menu.children[0].click());
		expect(PromptContextModal.prototype.open).not.toHaveBeenCalled();
		expect(response.getData().ai_context_count).toBe(3);
	});

	it("shows a 12px context badge during streaming and restores it through canvas events", async () => {
		const { app, canvas, settings, events } = fixture();
		const cleanup = setupCanvasIndicatorPersistence(app);
		vi.mocked(streamResponse).mockImplementation(async (provider, messages, options, callback) => {
			const response = canvas.nodes.get("response");
			expect(badge(response).querySelector(".ai-model-indicator-label")!.textContent).toBe("3 cards • generating");
			callback("ANSWER", null, null, null);
			expect(badge(response).querySelector(".ai-model-indicator-label")!.textContent).toBe("3 cards • generating");
			expect(badge(response).style.cssText).toMatch(/font-size: 12px;/);
			response.contentEl.children = [];
			events.get("layout-change")!();
			await vi.advanceTimersByTimeAsync(100);
			expect(badge(response).querySelector(".ai-model-indicator-label")!.textContent).toBe("3 cards • generating");
			callback(null, { text: "ANSWER" }, null, null);
		});
		await run(() => noteGenerator(app, settings).generateNote());
		const response = canvas.nodes.get("response");
		expect(response.text).toBe("ANSWER");
		const savedData = JSON.parse(JSON.stringify(response.getData()));
		const reloaded = canvas.makeNode("response", savedData.text);
		reloaded.setData(savedData);
		events.get("active-leaf-change")!();
		await vi.advanceTimersByTimeAsync(100);
		expect(badge(reloaded).querySelector(".ai-model-indicator-label")!.textContent).toBe("3 cards • Custom • test-model");
		expect(badge(reloaded).style.cssText).toMatch(/font-size: 12px;/);
		cleanup();
	});

	it("clears the generating badge on failure", async () => {
		const { app, canvas, settings } = fixture();
		vi.mocked(streamResponse).mockRejectedValue(new Error("Request failed"));
		await run(() => noteGenerator(app, settings).generateNote());
		expect(canvas.nodes.get("response").text).toBe("**Error:** Request failed");
		expect(badge(canvas.nodes.get("response")).querySelector(".ai-model-indicator-label")!.textContent).toBe("3 cards • Custom • test-model");
	});

	it("keeps legacy cards without a stored count readable", () => {
		const { prompt } = fixture();
		addModelIndicator(prompt, "Custom", "test-model");
		expect(badge(prompt).querySelector(".ai-model-indicator-label")!.textContent).toBe("Custom • test-model");
	});

	it.each(["styles.css", "main.css", "src/styles/settings.css"])("%s sets the badge override to 12px", (path) => {
		const css = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
		const rule = css.match(/\.ai-model-indicator\s*\{([^}]+)\}/)![1];
		expect(rule).toMatch(/font-size:\s*12px !important;/);
	});
});

describe("feature usage line", () => {
	it("counts MCP calls without counting results or provider tools and retains its segments", async () => {
		const { app, canvas, settings } = fixture(false);
		settings.mcpEnabled = true;
		settings.mcpServers = [{}];
		vi.mocked(getAllMCPTools).mockResolvedValue({ lookup: {}, read: {}, write: {} });
		let features: Element;
		let segment: Element;
		vi.mocked(streamResponse).mockImplementation(async (provider, messages, options, callback) => {
			const response = canvas.nodes.get("response");
			features = response.contentEl.querySelector(".ai-features-indicator")!;
			segment = features.children[0];
			expect(segment.textContent).toBe("🔧 MCP (3 tools, 0 calls)");
			callback(null, null, { type: "tool-call", toolName: "lookup", toolCallId: "one" }, null);
			callback(null, null, { type: "tool-result", toolCallId: "one", result: "done" }, null);
			expect(segment.textContent).toBe("🔧 MCP (3 tools, 1 calls)");
			callback(null, null, { type: "tool-call", toolName: "read", toolCallId: "two" }, null);
			callback(null, null, { type: "tool-call", toolName: "google_search", toolCallId: "three" }, null);
			callback("answer", null, null, null);
			callback(null, { text: "answer" }, null, null);
		});
		await run(() => noteGenerator(app, settings).generateNote());
		expect(canvas.nodes.get("response").contentEl.querySelector(".ai-features-indicator")).toBe(features!);
		expect(features!.children).toEqual([segment!]);
		expect(segment!.textContent).toBe("🔧 MCP (3 tools, 2 calls)");
	});

	it.each([
		{ metadata: { google: { groundingMetadata: { webSearchQueries: ["test"] }, urlContextMetadata: { urlMetadata: [{ urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" }] } } }, search: "used", url: "used" },
		{ metadata: { google: { groundingMetadata: null, urlContextMetadata: null } }, search: "not used", url: "not used" },
		{ metadata: { google: { groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.test" } }] }, urlContextMetadata: { urlMetadata: [{ urlRetrievalStatus: "URL_RETRIEVAL_STATUS_ERROR" }] } } }, search: "used", url: "retrieval failed" },
		{ metadata: undefined, search: "usage unknown", url: "usage unknown" },
	])("reports Search $search and URL Context $url from final metadata", async ({ metadata, search, url }) => {
		const { app, canvas, settings, provider, model } = fixture(false);
		provider.type = "Gemini";
		model.model = "gemini-3-flash-preview";
		let features: Element;
		let segments: Element[];
		vi.mocked(streamResponse).mockImplementation(async (provider, messages, options, callback) => {
			features = canvas.nodes.get("response").contentEl.querySelector(".ai-features-indicator")!;
			segments = [...features.children];
			expect(segments.map(segment => segment.textContent)).toEqual(["🌐 URL Context: enabled", "🔍 Search: enabled"]);
			callback("answer", null, null, null);
			callback(null, { text: "answer", providerMetadata: Promise.resolve(metadata) }, null, null);
		});
		await run(() => noteGenerator(app, settings).generateNote());
		expect(features!.children).toEqual(segments!);
		expect(segments!.map(segment => segment.textContent)).toEqual([`🌐 URL Context: ${url}`, `🔍 Search: ${search}`]);
		expect(canvas.nodes.get("response").contentEl.querySelector(".ai-features-indicator")).toBe(features!);
	});
});

describe("tool call pills", () => {
	it.each([
		{ result: "done", isError: false, state: "success", glyph: "✓" },
		{ result: "failed", isError: true, state: "error", glyph: "✗" },
		{ result: { error: "failed" }, state: "error", glyph: "✗" },
		{ result: { isError: true, content: [] }, state: "error", glyph: "✗" },
	])("renders a $state result in the existing status block", async ({ result, isError, state, glyph }) => {
		const { app, canvas, settings } = fixture(false);
		vi.mocked(streamResponse).mockImplementation(async (provider, messages, options, callback) => {
			callback(null, null, { type: "tool-call", toolName: "lookup", toolCallId: "call", args: { q: "test" } }, null);
			const response = canvas.nodes.get("response");
			const pill = response.contentEl.querySelector(".mcp-tool-call")!;
			const summary = pill.children[0];
			const summaryChildren = [...summary.children];
			const status = pill.querySelector(".mcp-tool-status")!;
			const glyphEl = status.querySelector(".mcp-tool-status-glyph")!;
			expect(glyphEl.textContent).toBe("⏳");
			callback(null, null, { type: "tool-result", toolCallId: "call", result, isError }, null);
			expect(status.className).toContain(`mcp-tool-${state}`);
			expect(status.querySelector(".mcp-tool-status-glyph")).toBe(glyphEl);
			expect(glyphEl.textContent).toBe(glyph);
			expect(summary.children).toEqual(summaryChildren);
			callback("answer", null, null, null);
			callback(null, { text: "answer" }, null, null);
			expect(response.contentEl.querySelector(".mcp-tool-call")).toBe(pill);
		});
		await run(() => noteGenerator(app, settings).generateNote());
	});
});

describe("provider media input", () => {
	const attachFile = (app: any, node: any, extension: string, size = 4) => {
		const bytes = new Uint8Array([1, 2, 3, 4]);
		const file = Object.assign(new obsidian.TFile(), {
			extension, basename: "attachment", path: `attachment.${extension}`, stat: { size },
		});
		app.vault = {
			getAbstractFileByPath: vi.fn().mockReturnValue(file),
			readBinary: vi.fn().mockResolvedValue(bytes.buffer),
		};
		node.app = app;
		node.setData({ type: "file", file: file.path });
		return bytes;
	};

	const sentParts = () => vi.mocked(streamResponse).mock.calls[0][1].flatMap((message: any) =>
		Array.isArray(message.content) ? message.content : []
	);

	it("reads and sends an image card through Bifrost", async () => {
		const { app, settings, provider, prompt } = fixture(false);
		provider.type = "Bifrost";
		const bytes = attachFile(app, prompt, "png");
		await run(() => noteGenerator(app, settings).generateNote());
		expect(app.vault.readBinary).toHaveBeenCalledOnce();
		expect(sentParts()).toContainEqual({ type: "image", image: bytes, mediaType: "image/png" });
	});

	it.each(["png", "pdf"])("uses a saved no verdict to omit %s media", async (extension) => {
		const { app, settings, provider, prompt } = fixture(false);
		Object.assign(provider, { type: "Bifrost", capabilityReport: {
			image: "no", pdf: "no", video: "untested", youtube: "untested", search: "untested", urlContext: "untested",
		} });
		attachFile(app, prompt, extension);
		await run(() => noteGenerator(app, settings).generateNote());
		expect(sentParts().filter((part: any) => part.type === "image" || part.type === "file")).toEqual([]);
	});

	it("uses a saved no verdict to omit native Bifrost YouTube input", async () => {
		const { app, settings, provider, prompt } = fixture(false);
		Object.assign(provider, { type: "Bifrost", geminiNative: true, capabilityReport: {
			image: "yes", pdf: "yes", video: "untested", youtube: "no", search: "no", urlContext: "no",
		} });
		prompt.setData({ type: "link", url: "https://youtu.be/dQw4w9WgXcQ" });
		await run(() => noteGenerator(app, settings).generateNote());
		expect(sentParts().filter((part: any) => part.type === "file")).toEqual([]);
		expect(obsidian.Notice).toHaveBeenCalledWith("Bifrost cannot take YouTube links. Use a Gemini provider for this card.");
	});

	it("reads and sends a PDF card through Bifrost", async () => {
		const { app, settings, provider, prompt } = fixture(false);
		provider.type = "Bifrost";
		attachFile(app, prompt, "pdf");
		await run(() => noteGenerator(app, settings).generateNote());
		expect(app.vault.readBinary).toHaveBeenCalled();
		expect(sentParts()).toContainEqual({ type: "file", data: "AQIDBA==", mediaType: "application/pdf", filename: "attachment" });
	});

	it.each([4, 30 * 1024 * 1024])("skips Bifrost video bytes and emits one notice (file size: %s)", async (size) => {
		const { app, settings, provider, prompt } = fixture(false);
		provider.type = "Bifrost";
		attachFile(app, prompt, "mp4", size);
		await run(() => noteGenerator(app, settings).generateNote());
		expect(app.vault.readBinary).not.toHaveBeenCalled();
		expect(sentParts().filter((part: any) => part.type === "file")).toEqual([]);
		expect(vi.mocked(obsidian.Notice).mock.calls.filter(([message]) => message.includes("cannot take"))).toEqual([
			["Bifrost cannot take video files. Use a Gemini provider for this card."],
		]);
	});

	it("warns once for Bifrost YouTube cards and sends no video file parts", async () => {
		const { app, settings, provider, prompt, canvas } = fixture();
		provider.type = "Bifrost";
		prompt.setData({ type: "link", url: "https://youtu.be/dQw4w9WgXcQ" });
		canvas.nodes.get("parent").text = "Also read https://www.youtube.com/watch?v=dQw4w9WgXcQ";
		await run(() => noteGenerator(app, settings).generateNote());
		expect(sentParts().filter((part: any) => part.type === "file")).toEqual([]);
		expect(vi.mocked(obsidian.Notice).mock.calls.filter(([message]) => message.includes("cannot take"))).toEqual([
			["Bifrost cannot take YouTube links. Use a Gemini provider for this card."],
		]);
	});

	it.each(["Gemini", "Bifrost"])("sends YouTube cards as video inputs for %s with native Google support", async (type) => {
		const { app, settings, provider, prompt } = fixture(false);
		provider.type = type;
		(provider as any).geminiNative = type === "Bifrost";
		prompt.setData({ type: "link", url: "https://youtu.be/dQw4w9WgXcQ" });
		await run(() => noteGenerator(app, settings).generateNote());
		expect(sentParts()).toContainEqual({ type: "file", data: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", mediaType: "video/mp4" });
		expect(vi.mocked(obsidian.Notice).mock.calls.filter(([message]) => message.includes("cannot take"))).toEqual([]);
	});

	it("keeps sending video files for Gemini", async () => {
		const { app, settings, provider, prompt } = fixture(false);
		provider.type = "Gemini";
		attachFile(app, prompt, "mp4");
		await run(() => noteGenerator(app, settings).generateNote());
		expect(sentParts()).toContainEqual({ type: "file", data: "AQIDBA==", mediaType: "video/mp4", filename: "attachment" });
	});
});
