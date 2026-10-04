import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as obsidian from "obsidian";
import AugmentedCanvasPlugin from "../src/AugmentedCanvasPlugin";
import { PromptContextModal } from "../src/Modals/PromptContextModal";
import { CustomQuestionModal } from "../src/Modals/CustomQuestionModal";
import { noteGenerator } from "../src/actions/canvasNodeMenuActions/noteGenerator";
import {
	addAskAIButton,
	addAskQuestionButton,
	addRegenerateResponse,
	handleCallAI_Question,
} from "../src/actions/canvasNodeMenuActions/advancedCanvas";
import { DEFAULT_SETTINGS } from "../src/settings/AugmentedCanvasSettings";
import { addModelIndicator, restoreModelIndicators, setupCanvasIndicatorPersistence } from "../src/utils";
import { streamResponse } from "../src/utils/llm";
import * as indicators from "../src/utils";
import { getAllMCPTools } from "../src/utils/mcpClient";
import { cancelActiveGenerations } from "../src/utils/generationStatus";

vi.mock("../src/utils/mcpClient", () => ({ getAllMCPTools: vi.fn() }));
vi.mock("../src/data/prompts.csv.txt", () => ({ default: "act,prompt" }));
vi.mock("../src/utils/llm", () => ({ streamResponse: vi.fn(), getResponse: vi.fn() }));
vi.mock("../src/obsidian/canvas-patches", async (importOriginal) => ({
	...await importOriginal<typeof import("../src/obsidian/canvas-patches")>(),
	createNode: (canvas: any, options: any, parent: any, data: any, label?: string) => {
		canvas.lastEdgeLabel = label;
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
	get parentElement() { return this.parent; }
	appendChild(child: Element) { child.remove(); child.parent = this; this.children.push(child); }
	querySelector(selector: string): Element | null {
		for (const child of this.children) {
			if (child.className.split(" ").includes(selector.slice(1))) return child;
			const nested = child.querySelector(selector);
			if (nested) return nested;
		}
		return null;
	}
	querySelectorAll(selector: string): Element[] {
		const matches = this.children.filter(child =>
			selector.startsWith(".") && child.className.split(" ").includes(selector.slice(1))
		);
		return [
			...matches,
			...this.children.flatMap(child => child.querySelectorAll(selector)),
		];
	}
	remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
	setAttribute(name: string, value: string) { this.attributes.set(name, value); }
	addEventListener(name: string, listener: () => unknown) { this.listeners.set(name, listener); }
	click() { return this.listeners.get("click")?.(); }
	setText(text: string) { this.textContent = text; }
	empty() { this.children = []; this.textContent = ""; }
	getText() { return this.textContent; }
	addClass(...names: string[]) { this.className = `${this.className} ${names.join(" ")}`.trim(); }
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
			render: vi.fn(),
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

const badge = (node: any) => node.nodeEl.querySelector(".ai-model-indicator") as Element;
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
	vi.spyOn(CustomQuestionModal.prototype, "open");
	vi.spyOn(obsidian, "Notice");
	vi.mocked(streamResponse).mockImplementation(async (provider, messages, options, callback) => {
		callback("ANSWER", null, null, null);
		callback(null, { text: "ANSWER" }, null, null);
	});
});

afterEach(() => {
	cancelActiveGenerations();
	vi.restoreAllMocks();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("context picker request paths", () => {
	it("continues an assistant answer with a Continue. turn and no question box", async () => {
		const { app, canvas, prompt, settings } = fixture(false);
		prompt.setData({ chat_role: "assistant" });
		await run(() => noteGenerator(app, settings).generateNote());
		expect(CustomQuestionModal.prototype.open).not.toHaveBeenCalled();
		expect(streamResponse).toHaveBeenCalledOnce();
		expect(vi.mocked(streamResponse).mock.calls[0][1].at(-1)).toEqual({
			role: "user",
			content: "Continue.",
		});
		expect(canvas.nodes.has("response")).toBe(true);
		expect(canvas.lastEdgeLabel).toBeUndefined();
	});

	it("sends a real question from an assistant card without a Continue. turn", async () => {
		const { app, prompt, settings } = fixture(false);
		prompt.setData({ chat_role: "assistant" });
		await run(() => noteGenerator(app, settings).generateNote("What follows?"));
		expect(streamResponse).toHaveBeenCalledOnce();
		const sent = vi.mocked(streamResponse).mock.calls[0][1];
		expect(sent.at(-1)).toEqual({ role: "user", content: "What follows?" });
		expect(sent.some((m: any) => m.content === "Continue.")).toBe(false);
	});

	it("treats a whitespace-only question on an assistant card as no question", async () => {
		const { app, prompt, settings } = fixture(false);
		prompt.setData({ chat_role: "assistant" });
		await run(() => noteGenerator(app, settings).generateNote("   "));
		expect(CustomQuestionModal.prototype.open).not.toHaveBeenCalled();
		expect(streamResponse).toHaveBeenCalledOnce();
		expect(vi.mocked(streamResponse).mock.calls[0][1].at(-1)).toEqual({
			role: "user",
			content: "Continue.",
		});
	});

	it("sends no Continue. turn from a user card", async () => {
		const { app, settings } = fixture(false);
		await run(() => noteGenerator(app, settings).generateNote());
		expect(CustomQuestionModal.prototype.open).not.toHaveBeenCalled();
		expect(streamResponse).toHaveBeenCalledOnce();
		expect(
			vi.mocked(streamResponse).mock.calls[0][1].some((m: any) => m.content === "Continue.")
		).toBe(false);
	});

	it.each([false, true])("fills a response whose content has not rendered yet (regeneration: %s)", async (regenerate) => {
		const { app, canvas, prompt, settings } = fixture(false);
		const makeNode = canvas.makeNode;
		canvas.makeNode = (id: string, text: string) => {
			const node = makeNode(id, text);
			delete node.contentEl;
			node.initialized = false;
			node.setText = (value: string) => { node.text = value; };
			node.render.mockImplementation(() => {
				if (!node.initialized) {
					node.initialized = true;
					node.contentEl = new Element();
				}
			});
			return node;
		};
		const existing = regenerate ? canvas.makeNode("existing", "old answer") : undefined;
		await run(() => noteGenerator(app, settings, prompt, existing).generateNote());
		const response = existing ?? canvas.nodes.get("response");
		expect(streamResponse).toHaveBeenCalledOnce();
		expect(response.text).toBe("ANSWER");
		expect(response.initialized).toBe(true);
		expect(badge(response).attributes.get("data-state")).toBe("complete");
		expect(canvas.requestSave).toHaveBeenCalledTimes(2);
	});

	it("saves a visible error if rendering the response card fails", async () => {
		const { app, canvas, prompt, settings } = fixture(false);
		const response = canvas.makeNode("existing", "old answer");
		delete response.contentEl;
		response.setText = (text: string) => { response.text = text; };
		response.render.mockImplementation(() => { throw new Error("Card rendering failed"); });
		await run(() => noteGenerator(app, settings, prompt, response).generateNote());
		expect(streamResponse).not.toHaveBeenCalled();
		expect(response.text).toBe("**Error:** Card rendering failed");
		expect(canvas.requestSave).toHaveBeenCalledTimes(2);
	});

	it.each([false, true])("starts with an empty body and a generating badge (regeneration: %s)", async (regenerate) => {
		const { app, canvas, prompt, settings } = fixture(false);
		const existing = regenerate ? canvas.makeNode("existing", "old answer") : undefined;
		vi.mocked(streamResponse).mockImplementation(async (provider, messages, options, callback) => {
			const response = existing ?? canvas.nodes.get("response");
			expect(response.text).toBe("");
			expect(response.getData().text).not.toContain("Calling AI");
			expect(badge(response).attributes.get("data-state")).toBe("generating");
			expect(response.nodeEl.className).toContain("ai-generating");
			callback("answer", null, null, null);
			expect(response.text).toBe("answer");
			callback(null, { text: "answer" }, null, null);
		});
		await run(() => noteGenerator(app, settings, prompt, existing).generateNote());
	});

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
	it("keeps the text already written and ends it with the error", async () => {
		const { app, canvas, settings } = fixture(false);
		vi.mocked(streamResponse).mockImplementation(async (provider, messages, options, callback) => {
			callback("The first part of the answer.", null, null, null);
			canvas.nodes.get("response").moveAndResize.mockClear();
			throw new Error("Generation timed out");
		});
		await run(() => noteGenerator(app, settings).generateNote());
		const response = canvas.nodes.get("response");
		expect(response.text).toBe("The first part of the answer.\n\n**Error:** Generation timed out");
		expect(response.moveAndResize).not.toHaveBeenCalled();
	});

	it("shows only the error when the failure comes before any text", async () => {
		const { app, canvas, settings } = fixture(false);
		vi.mocked(streamResponse).mockImplementation(async () => {
			throw new Error("Generation timed out");
		});
		await run(() => noteGenerator(app, settings).generateNote());
		const response = canvas.nodes.get("response");
		expect(response.text).toBe("**Error:** Generation timed out");
		expect(response.moveAndResize).toHaveBeenCalledOnce();
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
	it.each([[[]], [["YouTube link not sent to Bifrost", "Skipped diagram.png, 24 MB exceeds the 20 MB limit"]]])("restores card notes with the badge: %j", (notes) => {
		const { prompt, canvas } = fixture(false);
		prompt.setData({ ai_provider: "Custom", ai_model: "test", ...(notes.length ? { ai_notes: notes } : {}) });
		addModelIndicator(prompt, "Custom", "test");
		const lines = () => prompt.nodeEl.querySelector(".ai-card-notes")?.children.map((line: Element) => line.textContent) ?? [];
		expect(lines()).toEqual(notes);
		prompt.contentEl.children = [];
		restoreModelIndicators(canvas);
		expect(lines()).toEqual(notes);
		const saved = JSON.parse(JSON.stringify(prompt.getData()));
		const reloaded = canvas.makeNode("reloaded", "answer");
		reloaded.setData(saved);
		restoreModelIndicators(canvas);
		expect(reloaded.nodeEl.querySelector(".ai-card-notes")?.children.map((line: Element) => line.textContent) ?? []).toEqual(notes);
		if (!notes.length) expect(prompt.nodeEl.querySelector(".ai-card-notes")).toBeNull();
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
	it.each(["Ask AI", "Ask Question"])("%s skips the picker and sends all ancestors by default", async (entry) => {
		const { app, canvas, prompt, settings } = fixture();
		const menu = new Element();
		if (entry === "Ask Question") {
			await run(() => handleCallAI_Question(app, settings, prompt, "QUESTION"));
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
		expect(response.getData().ai_context_total).toBe(3);
		expect(badge(response).querySelector(".ai-model-indicator-label")!.textContent).toBe("3 cards • Custom • test-model");
	});

	it("shows the reachable card count in both Ask tooltips", async () => {
		const { app, prompt, settings } = fixture();
		const menu = new Element();
		await addAskAIButton(app, settings, menu as any, prompt);
		addAskQuestionButton(app, settings, menu as any, prompt);
		expect(menu.children.map(child => child.attributes.get("aria-label"))).toEqual([
			"Ask AI (3 cards)",
			"Ask a question… (3 cards)",
		]);

		settings.maxDepth = 1;
		const limitedMenu = new Element();
		await addAskAIButton(app, settings, limitedMenu as any, prompt);
		expect(limitedMenu.children[0].attributes.get("aria-label")).toBe("Ask AI (2 cards)");
	});

	it("renders the three card toolbar actions in order", () => {
		const { app, canvas, prompt, settings } = fixture();
		class CanvasMenu {
			selection = canvas.selection;
			canvas = canvas;
			menuEl = new Element();
			render() { return "rendered"; }
		}
		const menu = new CanvasMenu();
		canvas.menu = menu;
		app.workspace.getLeavesOfType = () => [{ view: { canvas } }];
		app.workspace.onLayoutReady = (callback: () => void) => callback();
		app.workspace.trigger = vi.fn();
		const plugin: any = new AugmentedCanvasPlugin();
		Object.assign(plugin, { app, settings, register: vi.fn(), registerEvent: vi.fn() });
		plugin.patchCanvasMenu();
		expect(menu.render()).toBe("rendered");
		expect(menu.menuEl.children.map(child => child.attributes.get("aria-label"))).toEqual([
			"Ask AI (3 cards)",
			"Ask a question… (3 cards)",
			"Generate image (Custom)",
		]);
		expect(menu.menuEl.children.map(child => child.attributes.get("data-icon"))).toEqual([
			"lucide-sparkles",
			"lucide-message-square-plus",
			"lucide-image",
		]);
	});

	it("counts only cards that actually contribute messages", async () => {
		const { app, canvas, settings } = fixture();
		canvas.nodes.get("oldest").text = "";
		await run(() => noteGenerator(app, settings).generateNote());
		const data = canvas.nodes.get("response").getData();
		expect(data.ai_context_count).toBe(2);
		expect(data.ai_context_total).toBe(3);
	});

	it("does not count deselected cards as contributors", async () => {
		const { app, canvas, settings } = fixture();
		await run(() => noteGenerator(app, settings).generateNote(undefined, new Set(["prompt", "oldest"])));
		const data = canvas.nodes.get("response").getData();
		expect(data.ai_context_count).toBe(2);
		expect(data.ai_context_total).toBe(3);
	});

	it("does not count cards beyond the depth limit", async () => {
		const { app, canvas, settings } = fixture();
		settings.maxDepth = 1;
		await run(() => noteGenerator(app, settings).generateNote());
		const data = canvas.nodes.get("response").getData();
		expect(data.ai_context_count).toBe(2);
		expect(data.ai_context_total).toBe(3);
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
		expect(badge(canvas.nodes.get("response")).querySelector(".ai-model-indicator-label")!.textContent).toBe("2 of 3 cards • Custom • test-model");
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
		settings.enableCardTitleGeneration = true;
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
		expect(items.map(item => item.title)).toEqual([
			"Ask AI with chosen context…",
			"Generate card title",
			"Copy node ID",
		]);
		await run(() => items.find(item => item.title === "Ask AI with chosen context…").click());
		expect(PromptContextModal.prototype.open).toHaveBeenCalledOnce();
		expect(streamResponse).not.toHaveBeenCalled();
	});

	it.each([
		[true, ["Ask AI with chosen context…", "Copy node ID"]],
		[false, ["Ask AI with chosen context…"]],
	] as const)("shows Copy node ID only when debug is %s", (debug, expectedTitles) => {
		const { app, settings, prompt, events } = fixture(false);
		settings.debug = debug;
		settings.enableCardTitleGeneration = false;
		const plugin: any = new AugmentedCanvasPlugin();
		Object.assign(plugin, { app, settings, registerEvent: vi.fn() });
		plugin.patchNoteContextMenu();
		const titles: string[] = [];
		const menu = {
			addSeparator() {},
			addItem(callback: (item: any) => void) {
				const item = {
					setTitle(title: string) { titles.push(title); return this; },
					setIcon() { return this; },
					onClick() { return this; },
				};
				callback(item);
			},
		};
		events.get("canvas:node-menu")!(menu, prompt);
		expect(titles).toEqual(expectedTitles);
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

	it("ordinary regeneration reuses saved exclusions", async () => {
		const { app, settings, canvas, prompt } = fixture();
		const response = canvas.makeNode("existing-response", "OLD ANSWER");
		response.setData({ ai_context_excluded: ["parent"] });
		canvas.selection = new Set([{ from: { node: prompt }, to: { node: response } }]);
		const menu = new Element();
		await addRegenerateResponse(app, settings, menu as any);
		await run(() => menu.children[0].click());
		expect(vi.mocked(streamResponse).mock.calls[0][1].map((message: any) => message.content))
			.toEqual(["SYSTEM", "OLDEST", "CURRENT"]);
		expect(response.getData().ai_context_excluded).toEqual(["parent"]);
		expect(response.getData().ai_context_count).toBe(2);
		expect(response.getData().ai_context_total).toBe(3);
	});

	it("chosen context starts from, replaces and clears saved exclusions", async () => {
		const { app, settings, canvas, prompt } = fixture();
		const response = canvas.makeNode("existing-response", "OLD ANSWER");
		response.setData({ ai_context_excluded: ["parent"] });
		canvas.selection = new Set([{ from: { node: prompt }, to: { node: response } }]);
		const menu = new Element();
		await addRegenerateResponse(app, settings, menu as any);
		await run(() => menu.children[1].click());
		const firstModal: any = vi.mocked(PromptContextModal.prototype.open).mock.instances[0];
		expect([...firstModal.selectedNodeIds]).toEqual(["prompt", "oldest"]);
		await run(() => firstModal.onSubmit(new Set(["prompt", "parent"])));
		expect(response.getData().ai_context_excluded).toEqual(["oldest"]);

		await run(() => menu.children[1].click());
		const secondModal: any = vi.mocked(PromptContextModal.prototype.open).mock.instances[1];
		expect([...secondModal.selectedNodeIds]).toEqual(["prompt", "parent"]);
		await run(() => secondModal.onSubmit(new Set(["prompt", "parent", "oldest"])));
		expect(response.getData().ai_context_excluded).toBeUndefined();
	});

	it("the always-ask picker starts with saved exclusions switched off", async () => {
		const { app, settings, canvas, prompt } = fixture();
		settings.alwaysAskPromptContext = true;
		const response = canvas.makeNode("existing-response", "OLD ANSWER");
		response.setData({ ai_context_excluded: ["oldest"] });
		await run(() => noteGenerator(app, settings, prompt, response).generateNote());
		const modal: any = vi.mocked(PromptContextModal.prototype.open).mock.instances[0];
		expect([...modal.selectedNodeIds]).toEqual(["prompt", "parent"]);
		expect(streamResponse).not.toHaveBeenCalled();
	});

	it("keeps the context badge during streaming and restores it through canvas events", async () => {
		const { app, canvas, settings, events } = fixture();
		const cleanup = setupCanvasIndicatorPersistence(app);
		vi.mocked(streamResponse).mockImplementation(async (provider, messages, options, callback) => {
			const response = canvas.nodes.get("response");
			expect(badge(response).querySelector(".ai-model-indicator-label")!.textContent).toBe("3 cards • generating");
			callback("ANSWER", null, null, null);
			expect(badge(response).querySelector(".ai-model-indicator-label")!.textContent).toBe("3 cards • generating");
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

	it.each(["styles.css", "src/styles/settings.css"])("%s sets the badge override to 12px", (path) => {
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

	it("records an oversized attachment on the response card", async () => {
		const { app, canvas, settings, provider, prompt } = fixture(false);
		provider.type = "Gemini";
		attachFile(app, prompt, "mp4", 24 * 1024 * 1024);
		await run(() => noteGenerator(app, settings).generateNote());
		const response = canvas.nodes.get("response");
		expect(response.getData().ai_notes).toEqual(["Skipped attachment.mp4, 24.0 MB exceeds the 20.0 MB limit"]);
		expect(response.nodeEl.querySelector(".ai-card-notes")!.children[0].textContent).toBe(response.getData().ai_notes[0]);
		expect(app.vault.readBinary).not.toHaveBeenCalled();
	});

	it("reads and sends an image card through Bifrost", async () => {
		const { app, settings, provider, prompt } = fixture(false);
		provider.type = "Bifrost";
		const bytes = attachFile(app, prompt, "png");
		await run(() => noteGenerator(app, settings).generateNote());
		expect(app.vault.readBinary).toHaveBeenCalledOnce();
		expect(sentParts()).toContainEqual({ type: "image", image: bytes, mediaType: "image/png" });
	});

	it.each(["png", "pdf"])("ignores a legacy gateway-wide failure for %s media", async (extension) => {
		const { app, settings, provider, prompt } = fixture(false);
		Object.assign(provider, { type: "Bifrost", capabilityReport: {
			image: "no", pdf: "no", video: "untested", youtube: "untested", search: "untested", urlContext: "untested",
		} });
		attachFile(app, prompt, extension);
		await run(() => noteGenerator(app, settings).generateNote());
		expect(sentParts().filter((part: any) => part.type === "image" || part.type === "file")).toHaveLength(1);
	});

	it("ignores legacy failures when sending native Bifrost YouTube input", async () => {
		const { app, settings, provider, prompt } = fixture(false);
		Object.assign(provider, { type: "Bifrost", geminiNative: true, capabilityReport: {
			image: "yes", pdf: "yes", video: "untested", youtube: "no", search: "no", urlContext: "no",
		} });
		prompt.setData({ type: "link", url: "https://youtu.be/dQw4w9WgXcQ" });
		await run(() => noteGenerator(app, settings).generateNote());
		expect(sentParts()).toContainEqual({type:"file",data:"https://www.youtube.com/watch?v=dQw4w9WgXcQ",mediaType:"video/mp4"});
		expect(obsidian.Notice).not.toHaveBeenCalledWith("Bifrost cannot take YouTube links. Use a Gemini provider for this card.");
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
		const { app, settings, provider, prompt, canvas } = fixture(false);
		provider.type = "Bifrost";
		attachFile(app, prompt, "mp4", size);
		await run(() => noteGenerator(app, settings).generateNote());
		expect(canvas.nodes.get("response").getData().ai_notes).toEqual(["Video file not sent to Bifrost"]);
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
		expect(canvas.nodes.get("response").getData().ai_notes).toEqual(["YouTube link not sent to Bifrost"]);
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

describe("in-card generation state", () => {
	it("writes a clear line when the model returns no answer text", async () => {
		const { app, canvas, settings } = fixture(false);
		vi.mocked(streamResponse).mockImplementation(async (_provider, _messages, _options, callback) => {
			callback(null, null, null, "Reasoning without an answer.");
			callback(null, { text: "" }, null, null);
		});
		await run(() => noteGenerator(app, settings).generateNote());
		expect(canvas.nodes.get("response").text).toBe("The model returned an empty answer.");
	});

	it("shows a quiet status and elapsed time until the first answer", async () => {
		const { app, canvas, settings } = fixture();
		vi.mocked(streamResponse).mockImplementation(async (_provider, _messages, _options, callback) => {
			const response = canvas.nodes.get("response");
			const status = response.nodeEl.querySelector(".ai-generation-status")!;
			expect(status).not.toBeNull();
			expect(status.attributes.get("data-state")).toBe("waiting");
			expect(status.children).toHaveLength(2);
			expect(status.querySelector(".ai-generation-phase")!.textContent).toBe("Generating…");
			expect(status.querySelector(".ai-generation-timer")!.textContent).toBe("0s");
			await vi.advanceTimersByTimeAsync(3000);
			expect(status.querySelector(".ai-generation-timer")!.textContent).toBe("3s");
			expect(response.text).toBe("");
			callback(null, null, null, "Checking context.");
			expect(status.querySelector(".ai-generation-phase")!.textContent).toBe("Thinking…");
			callback(null, null, { type: "tool-call", toolName: "lookup", toolCallId: "one" }, null);
			expect(status.querySelector(".ai-generation-phase")!.textContent).toBe("Using lookup…");
			callback("Answer", null, null, null);
			expect(status.attributes.get("data-state")).toBe("streaming");
			expect(status.querySelector(".ai-generation-stop")).not.toBeNull();
			callback(null, { text: "Answer" }, null, null);
			expect(response.nodeEl.querySelector(".ai-generation-status")).toBeNull();
		});
		await run(() => noteGenerator(app, settings).generateNote());
		expect(canvas.nodes.get("response").text).toBe("Answer");
	});

	it.each([false, true])("stops generation and saves a usable card (partial answer: %s)", async partial => {
		const { app, canvas, settings } = fixture(false);
		vi.mocked(streamResponse).mockImplementation(async (_provider, _messages, options, callback) => {
			const response = canvas.nodes.get("response");
			if (partial) callback("Partial answer", null, null, null);
			expect(options!.abortSignal).toBeDefined();
			const stopped = new Promise<never>((_, reject) => options!.abortSignal!.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true }));
			response.nodeEl.querySelector(".ai-generation-stop")!.click();
			expect(options!.abortSignal!.aborted).toBe(true);
			await stopped;
		});
		await run(() => noteGenerator(app, settings).generateNote());
		const response = canvas.nodes.get("response");
		expect(response.text).toBe(partial ? "Partial answer" : "Generation stopped.");
		expect(response.text).not.toBe("The model returned an empty answer.");
		expect(response.getData().ai_notes).toContain("Generation stopped");
		expect(response.nodeEl.querySelector(".ai-generation-status")).toBeNull();
		expect(response.nodeEl.className).not.toContain("ai-generating");
		expect(canvas.requestSave).toHaveBeenCalled();
	});

	it("removes the loading state and timer on an error", async () => {
		const { app, canvas, settings } = fixture(false);
		vi.mocked(streamResponse).mockRejectedValue(new Error("HTTP 402: Budget exceeded"));
		await run(() => noteGenerator(app, settings).generateNote());
		const response = canvas.nodes.get("response");
		expect(response.nodeEl.querySelector(".ai-generation-status")).toBeNull();
		expect(response.text).toContain("HTTP 402: Budget exceeded");
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each(["delete", "unload"])("stops an active request on %s", async action => {
		const { app, canvas, settings } = fixture(false);
		vi.mocked(streamResponse).mockImplementation(async (_provider, _messages, options) => {
			const response = canvas.nodes.get("response");
			const stopped = new Promise<never>((_, reject) => options!.abortSignal!.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true }));
			// Attach the rejection handler before advancing the timer.
			const settled = stopped.catch(error => error);
			if (action === "delete") {
				canvas.nodes.delete(response.id);
				await vi.advanceTimersByTimeAsync(1000);
			} else {
				cancelActiveGenerations();
			}
			expect(options!.abortSignal!.aborted).toBe(true);
			expect(response.nodeEl.querySelector(".ai-generation-status")).toBeNull();
			throw await settled;
		});
		await run(() => noteGenerator(app, settings).generateNote());
		expect(vi.getTimerCount()).toBe(0);
	});

	it("stops while tools are connecting without starting an AI request", async () => {
		const { app, canvas, settings } = fixture(false);
		settings.mcpEnabled = true;
		settings.mcpServers = [{ id: "pending", enabled: true }];
		vi.mocked(getAllMCPTools).mockImplementation(() => {
			const response = canvas.nodes.get("response");
			expect(response.nodeEl.querySelector(".ai-generation-phase")!.textContent).toBe("Connecting tools…");
			response.nodeEl.querySelector(".ai-generation-stop")!.click();
			return new Promise(() => {});
		});
		await run(() => noteGenerator(app, settings).generateNote());
		expect(streamResponse).not.toHaveBeenCalled();
		expect(canvas.nodes.get("response").text).toBe("Generation stopped.");
		expect(vi.getTimerCount()).toBe(0);
	});

	it("anchors the model badge to the card outside replaceable markdown", () => {
		const { prompt } = fixture(false);
		addModelIndicator(prompt, "Custom", "test-model");
		expect(prompt.nodeEl.querySelector(".ai-model-indicator")).not.toBeNull();
		expect(prompt.contentEl.querySelector(".ai-model-indicator")).toBeNull();
	});

	it("moves an existing badge out of markdown when restoring cards", () => {
		const { prompt, canvas } = fixture(false);
		prompt.setData({ ai_provider: "Custom", ai_model: "test-model" });
		prompt.nodeEl.appendChild(prompt.contentEl);
		addModelIndicator(prompt, "Custom", "test-model");
		const indicator = badge(prompt);
		prompt.contentEl.appendChild(indicator);
		restoreModelIndicators(canvas);
		expect(badge(prompt)).toBe(indicator);
		expect(indicator.parentElement).toBe(prompt.nodeEl);
	});
});

describe("the folder a local CLI runs in", () => {
	it("is the folder of the canvas file inside the vault", async () => {
		const { app, canvas, settings } = fixture(false);
		app.vault = { adapter: { getBasePath: () => "/home/me/Vault" } };
		app.workspace.getActiveViewOfType = () => ({ canvas, file: { parent: { path: "Projects/Alpha" } } });
		await run(() => noteGenerator(app, settings).generateNote());
		expect(vi.mocked(streamResponse).mock.calls[0][2].cwd).toBe("/home/me/Vault/Projects/Alpha");
	});

	it("is the vault itself for a canvas at the vault root", async () => {
		const { app, canvas, settings } = fixture(false);
		app.vault = { adapter: { getBasePath: () => "/home/me/Vault" } };
		app.workspace.getActiveViewOfType = () => ({ canvas, file: { parent: { path: "/" } } });
		await run(() => noteGenerator(app, settings).generateNote());
		expect(vi.mocked(streamResponse).mock.calls[0][2].cwd).toBe("/home/me/Vault");
	});

	it("is left out where the vault has no folder on disk", async () => {
		const { app, settings } = fixture(false);
		await run(() => noteGenerator(app, settings).generateNote());
		expect(vi.mocked(streamResponse).mock.calls[0][2].cwd).toBeUndefined();
	});
});

describe("a Pi card and its Pi session", () => {
	const piFixture = (sessions: Record<string, string> = {}, type = "Pi CLI") => {
		const set = fixture();
		set.provider.type = type;
		set.model.model = "default";
		for (const [id, session] of Object.entries(sessions)) set.canvas.nodes.get(id).setData({ pi_session: session });
		return set;
	};
	const sentContents = () => vi.mocked(streamResponse).mock.calls[0][1].map((message: any) => message.content);
	const sentOptions = () => vi.mocked(streamResponse).mock.calls[0][2];

	it("sends the whole chain and no fork when no card has a session", async () => {
		const { app, settings } = piFixture();
		await run(() => noteGenerator(app, settings).generateNote());
		expect(sentOptions().forkSession).toBeUndefined();
		expect(sentContents()).toEqual(["SYSTEM", "OLDEST", "PARENT", "edge label", "CURRENT"]);
	});

	it("continues the session above and sends only the cards added since", async () => {
		const { app, settings, canvas } = piFixture({ oldest: "session-oldest" });
		await run(() => noteGenerator(app, settings).generateNote());
		expect(sentOptions().forkSession).toBe("session-oldest");
		expect(sentContents()).toEqual(["PARENT", "edge label", "CURRENT"]);
		expect(canvas.nodes.get("response").getData().ai_context_count).toBe(3);
		expect(canvas.nodes.get("response").getData().ai_context_total).toBe(3);
	});

	it("picks the session nearest to the card being asked from", async () => {
		const { app, settings } = piFixture({ oldest: "session-oldest", parent: "session-parent" });
		await run(() => noteGenerator(app, settings).generateNote());
		expect(sentOptions().forkSession).toBe("session-parent");
		expect(sentContents()).toEqual(["CURRENT"]);
	});

	it("branches from an older card without sending the cards that came after it", async () => {
		const { app, settings, canvas } = piFixture({ oldest: "session-oldest", parent: "session-parent" });
		await run(() => noteGenerator(app, settings, canvas.nodes.get("parent")).generateNote("Another way?"));
		expect(sentOptions().forkSession).toBe("session-parent");
		expect(sentContents()).toEqual(["Another way?"]);
	});

	it("continues from the answer card itself with Continue. as the only new message", async () => {
		const { app, settings } = piFixture({ prompt: "session-prompt" });
		await run(() => noteGenerator(app, settings).generateNote());
		expect(sentOptions().forkSession).toBe("session-prompt");
		expect(sentContents()).toEqual(["Continue."]);
	});

	it("does not continue from a card the user switched off", async () => {
		const { app, settings } = piFixture({ oldest: "session-oldest", parent: "session-parent" });
		await run(() => noteGenerator(app, settings).generateNote(undefined, new Set(["prompt", "oldest"])));
		expect(sentOptions().forkSession).toBe("session-oldest");
		expect(sentContents()).toEqual(["CURRENT"]);
	});

	it("keeps a system prompt card that was added after the session", async () => {
		const { app, settings, canvas } = piFixture({ oldest: "session-oldest" });
		canvas.nodes.get("parent").setText("SYSTEM PROMPT Be brief.");
		await run(() => noteGenerator(app, settings).generateNote());
		expect(sentContents()).toEqual(["Be brief.", "CURRENT"]);
	});

	it("ignores the sessions when the active provider is not Pi", async () => {
		const { app, settings } = piFixture({ oldest: "session-oldest" }, "Custom");
		await run(() => noteGenerator(app, settings).generateNote());
		expect(sentOptions().forkSession).toBeUndefined();
		expect(sentContents()).toEqual(["SYSTEM", "OLDEST", "PARENT", "edge label", "CURRENT"]);
	});

	it("keeps the session Pi reports on the answer card, with Pi's cost and model", async () => {
		const { app, settings, canvas } = piFixture();
		vi.mocked(streamResponse).mockImplementation(async (provider, messages, options, callback) => {
			callback("ANSWER", null, null, null);
			callback(null, { text: "ANSWER" }, null, null);
			options?.onComplete?.({
				inputTokens: 10, outputTokens: 2, totalText: "ANSWER",
				sessionId: "session-new", costUsd: 0.25, model: "gpt-5.6-sol",
			});
		});
		await run(() => noteGenerator(app, settings).generateNote());
		const data = canvas.nodes.get("response").getData();
		expect(data.pi_session).toBe("session-new");
		expect(data.ai_cost).toBe(0.25);
		expect(data.ai_model).toBe("gpt-5.6-sol");
	});

	it("hands over the whole chain for Pi to start fresh with if the session is gone", async () => {
		const { app, settings } = piFixture({ oldest: "session-oldest" });
		await run(() => noteGenerator(app, settings).generateNote());
		expect(sentOptions().fallbackMessages.map((message: any) => message.content))
			.toEqual(["SYSTEM", "OLDEST", "PARENT", "edge label", "CURRENT"]);
	});

	it("gives no fallback when there is no session to lose", async () => {
		const { app, settings } = piFixture();
		await run(() => noteGenerator(app, settings).generateNote());
		expect(sentOptions().fallbackMessages).toBeUndefined();
	});

	it("notes on the card that a fresh Pi session was started", async () => {
		const { app, settings, canvas } = piFixture({ oldest: "session-oldest" });
		vi.mocked(streamResponse).mockImplementation(async (provider, messages, options, callback) => {
			callback("ANSWER", null, null, null);
			callback(null, { text: "ANSWER" }, null, null);
			options?.onComplete?.({
				inputTokens: 1, outputTokens: 1, totalText: "ANSWER", sessionId: "session-new", startedFreshSession: true,
			});
		});
		await run(() => noteGenerator(app, settings).generateNote());
		expect(canvas.nodes.get("response").getData().ai_notes)
			.toEqual(["Started a fresh Pi session; the earlier one was not found."]);
	});

	it("forgets the old session of a card that is regenerated", async () => {
		const { app, settings, canvas, prompt } = piFixture();
		const existing = canvas.makeNode("existing", "old answer");
		existing.setData({ pi_session: "session-stale" });
		await run(() => noteGenerator(app, settings, prompt, existing).generateNote());
		expect(existing.getData().pi_session).toBeUndefined();
	});
});
