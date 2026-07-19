import { afterEach, describe, expect, it, vi } from "vitest";
import {
	extractHtmlCodeBlocks,
	restoreHtmlPreviews,
	setupHtmlPreviewPersistence,
} from "../src/utils/htmlPreview";

class FakeElement {
	attributes = new Map<string, string>();
	className = "";
	children: FakeElement[] = [];
	eventListeners = new Map<string, Array<(event: { preventDefault(): void; stopPropagation(): void }) => void>>();
	parentElement: FakeElement | null = null;
	sandbox = { add: vi.fn() };
	srcdoc = "";
	style: Record<string, string> = {};
	textContent = "";

	constructor(public tagName = "div") {}

	createEl(tagName: string, options?: { cls?: string; text?: string }) {
		const child = new FakeElement(tagName);
		child.parentElement = this;
		child.className = options?.cls || "";
		child.textContent = options?.text || "";
		this.children.push(child);
		return child;
	}

	querySelector(selector: string): FakeElement | null {
		const className = selector.startsWith(".") ? selector.slice(1) : "";
		for (const child of this.children) {
			if (className && child.className.split(" ").includes(className)) return child;
			if (!className && child.tagName === selector) return child;
			const nested = child.querySelector(selector);
			if (nested) return nested;
		}
		return null;
	}

	querySelectorAll(selector: string): FakeElement[] {
		const matches = this.children.filter(child => selector.startsWith(".")
			? child.className.split(" ").includes(selector.slice(1))
			: child.tagName === selector);
		return matches.concat(this.children.flatMap(child => child.querySelectorAll(selector)));
	}

	appendChild(child: FakeElement) {
		child.parentElement = this;
		this.children.push(child);
	}
	setAttribute(name: string, value: string) { this.attributes.set(name, value); }
	getAttribute(name: string) { return this.attributes.get(name) ?? null; }
	addEventListener(type: string, listener: (event: { preventDefault(): void; stopPropagation(): void }) => void) {
		this.eventListeners.set(type, [...(this.eventListeners.get(type) ?? []), listener]);
	}
	click() {
		const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
		this.eventListeners.get("click")?.forEach(listener => listener(event));
	}
	addClass(className: string) { this.className += ` ${className}`; }
	removeClass(className: string) {
		this.className = this.className.split(" ").filter(value => value !== className).join(" ");
	}
	remove() {
		if (this.parentElement) {
			this.parentElement.children = this.parentElement.children.filter(child => child !== this);
		}
	}
}

const createTextNode = (id: string, text: string) => {
	const contentEl = new FakeElement();
	const markdownEl = new FakeElement();
	markdownEl.addClass("markdown-embed-content");
	contentEl.appendChild(markdownEl);
	return {
		node: {
			id,
			text,
			contentEl,
			getData: () => ({ type: "text" }),
		},
		contentEl,
		markdownEl,
	};
};

const findButton = (root: FakeElement, label: string) =>
	root.querySelectorAll("button").find(button => button.getAttribute("aria-label") === label);

const installFakeDocument = () => {
	vi.stubGlobal("document", {
		createElement: (tagName: string) => new FakeElement(tagName),
	});
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("extractHtmlCodeBlocks", () => {
	it("extracts a lowercase html fence with a newline", () => {
		const blocks = extractHtmlCodeBlocks("Before\n```html\n<h1>Hello</h1>\n```\nAfter");

		expect(blocks.map(block => block.content)).toEqual(["<h1>Hello</h1>"]);
	});

	it("accepts uppercase HTML fences", () => {
		const blocks = extractHtmlCodeBlocks("```HTML\n<p>Uppercase</p>\n```");

		expect(blocks.map(block => block.content)).toEqual(["<p>Uppercase</p>"]);
	});

	it("accepts content immediately after the html fence label", () => {
		const blocks = extractHtmlCodeBlocks("```html<div>No leading newline</div>```");

		expect(blocks.map(block => block.content)).toEqual([
			"<div>No leading newline</div>",
		]);
	});

	it("extracts multiple html blocks", () => {
		const blocks = extractHtmlCodeBlocks(
			"```html\n<section>One</section>\n```\ntext\n```HTML\n<section>Two</section>\n```"
		);

		expect(blocks.map(block => block.content)).toEqual([
			"<section>One</section>",
			"<section>Two</section>",
		]);
	});

	it("ignores empty html blocks", () => {
		const blocks = extractHtmlCodeBlocks("```html\n   \n```");

		expect(blocks).toEqual([]);
	});

	it("starts fenced cards in Render mode and hides the markdown host", () => {
		installFakeDocument();
		const { node, contentEl, markdownEl } = createTextNode(
			"render-default",
			"```html\n<main>Saved preview</main>\n```"
		);

		restoreHtmlPreviews({ nodes: new Map([[node.id, node]]) }, true);

		expect(contentEl.querySelector(".html-preview-container")).not.toBeNull();
		expect(contentEl.querySelector(".html-preview-toolbar")).not.toBeNull();
		expect(contentEl.querySelector("details")).toBeNull();
		expect(findButton(contentEl, "Open in new window")).toBeDefined();
		expect(findButton(contentEl, "Render HTML")?.getAttribute("data-icon")).toBe("eye");
		expect(findButton(contentEl, "Show code")?.getAttribute("data-icon")).toBe("code-2");
		expect(findButton(contentEl, "Open in new window")?.getAttribute("data-icon"))
			.toBe("external-link");
		expect(findButton(contentEl, "Render HTML")?.className.split(" ")).toContain("clickable-icon");
		expect(markdownEl.className.split(" ")).toContain("html-preview-code-hidden");
		expect(findButton(contentEl, "Render HTML")?.className.split(" ")).toContain("is-active");
		expect(findButton(contentEl, "Show code")?.className.split(" ")).not.toContain("is-active");
		const iframe = contentEl.querySelector("iframe");
		expect(iframe?.style).toMatchObject({ width: "100%", height: "100%" });
		expect(iframe?.sandbox.add).toHaveBeenCalledWith("allow-scripts");
		expect(iframe?.sandbox.add).not.toHaveBeenCalledWith("allow-same-origin");
	});

	it("leaves a plain text node without an html fence untouched", () => {
		installFakeDocument();
		const { node, contentEl } = createTextNode("no-fence", "A normal text card");

		restoreHtmlPreviews({ nodes: new Map([[node.id, node]]) }, true);

		expect(contentEl.querySelector(".html-preview-container")).toBeNull();
	});

	it("removes preview UI and restores markdown when the html fence is deleted", () => {
		installFakeDocument();
		const { node, contentEl, markdownEl } = createTextNode(
			"removed-fence",
			"```html\n<h1>Temporary preview</h1>\n```"
		);

		restoreHtmlPreviews({ nodes: new Map([[node.id, node]]) }, true);
		node.text = "The card is plain markdown now";
		restoreHtmlPreviews({ nodes: new Map([[node.id, node]]) }, true);

		expect(contentEl.querySelector(".html-preview-container")).toBeNull();
		expect(contentEl.querySelector("iframe")).toBeNull();
		expect(contentEl.className.split(" ")).not.toContain("html-preview-card");
		expect(markdownEl.className.split(" ")).not.toContain("html-preview-code-hidden");
		expect(markdownEl.className.split(" ")).not.toContain("html-preview-code-pane");
	});

	it("reattaches preview UI with the default mode after a fence returns", () => {
		installFakeDocument();
		const fencedText = "```html\n<h1>Back again</h1>\n```";
		const { node, contentEl, markdownEl } = createTextNode("returning-fence", fencedText);

		restoreHtmlPreviews({ nodes: new Map([[node.id, node]]) }, true);
		findButton(contentEl, "Show code")?.click();
		node.text = "No HTML here";
		restoreHtmlPreviews({ nodes: new Map([[node.id, node]]) }, true);
		node.text = fencedText;
		restoreHtmlPreviews({ nodes: new Map([[node.id, node]]) }, true);

		expect(contentEl.querySelector(".html-preview-container")).not.toBeNull();
		expect(contentEl.querySelector("iframe")).not.toBeNull();
		expect(markdownEl.className.split(" ")).toContain("html-preview-code-hidden");
		expect(findButton(contentEl, "Render HTML")?.className.split(" "))
			.toContain("is-active");
	});

	it("starts fenced cards in Code mode when automatic rendering is disabled", () => {
		installFakeDocument();
		const { node, contentEl, markdownEl } = createTextNode(
			"code-default",
			"```html\n<html><h1>Lala</h1></html>\n```"
		);

		restoreHtmlPreviews({ nodes: new Map([[node.id, node]]) }, false);

		expect(contentEl.querySelector(".html-preview-toolbar")).not.toBeNull();
		expect(markdownEl.className.split(" ")).not.toContain("html-preview-code-hidden");
		expect(contentEl.querySelector(".html-preview-render-surface")?.className.split(" "))
			.toContain("html-preview-render-hidden");
		expect(findButton(contentEl, "Show code")?.className.split(" ")).toContain("is-active");
	});

	it("switches between the rendered iframe and the markdown code", () => {
		installFakeDocument();
		const { node, contentEl, markdownEl } = createTextNode(
			"toggle-card",
			"```html\n<h1>Toggle</h1>\n```"
		);

		restoreHtmlPreviews({ nodes: new Map([[node.id, node]]) }, true);
		findButton(contentEl, "Show code")?.click();

		expect(markdownEl.className.split(" ")).not.toContain("html-preview-code-hidden");
		expect(contentEl.querySelector(".html-preview-render-surface")?.className.split(" "))
			.toContain("html-preview-render-hidden");
		expect(findButton(contentEl, "Show code")?.getAttribute("aria-pressed")).toBe("true");

		findButton(contentEl, "Render HTML")?.click();

		expect(markdownEl.className.split(" ")).toContain("html-preview-code-hidden");
		expect(contentEl.querySelector(".html-preview-render-surface")?.className.split(" "))
			.not.toContain("html-preview-render-hidden");
		expect(findButton(contentEl, "Render HTML")?.getAttribute("aria-pressed")).toBe("true");
	});

	it("remembers a card's selected mode across reattachment for the session", () => {
		installFakeDocument();
		const first = createTextNode("session-card", "```html\n<h1>Session</h1>\n```");
		restoreHtmlPreviews({ nodes: new Map([[first.node.id, first.node]]) }, true);
		findButton(first.contentEl, "Show code")?.click();

		const reopened = createTextNode("session-card", first.node.text);
		restoreHtmlPreviews({ nodes: new Map([[reopened.node.id, reopened.node]]) }, true);

		expect(reopened.markdownEl.className.split(" ")).not.toContain("html-preview-code-hidden");
		expect(findButton(reopened.contentEl, "Show code")?.className.split(" "))
			.toContain("is-active");
	});

	it("opens the first fence in an isolated Electron window and closes it on cleanup", async () => {
		installFakeDocument();
		const html = "<html>\n<h1>Lala</h1>\n</html>";
		const loadURL = vi.fn().mockResolvedValue(undefined);
		const show = vi.fn();
		const close = vi.fn();
		const previewWindow = {
			setMenuBarVisibility: vi.fn(),
			setTitle: vi.fn(),
			loadURL,
			show,
			close,
			isDestroyed: vi.fn(() => false),
			on: vi.fn(),
		};
		const BrowserWindow = vi.fn(function () { return previewWindow; });
		const electronRequire = vi.fn(() => ({ BrowserWindow }));
		vi.stubGlobal("require", electronRequire);
		vi.stubGlobal("window", { open: vi.fn(() => null) });
		const { node, contentEl } = createTextNode(
			"window-card",
			`\`\`\`html\n${html}\n\`\`\``
		);

		restoreHtmlPreviews({ nodes: new Map([[node.id, node]]) }, true);
		findButton(contentEl, "Open in new window")?.click();

		await vi.waitFor(() => expect(loadURL).toHaveBeenCalledOnce());
		expect(electronRequire).toHaveBeenCalledWith("@electron/remote");
		expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
			show: false,
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				sandbox: true,
			},
		}));
		const url = loadURL.mock.calls[0][0];
		expect(url).toMatch(/^data:text\/html;charset=utf-8,/);
		expect(decodeURIComponent(url.slice(url.indexOf(",") + 1))).toBe(html);
		expect(show).toHaveBeenCalledOnce();

		const workspace = { activeLeaf: null, on: vi.fn(), off: vi.fn() };
		const cleanup = setupHtmlPreviewPersistence({ workspace }, () => true);
		cleanup();
		expect(close).toHaveBeenCalledOnce();
	});

	it("renders only the first HTML fence", () => {
		installFakeDocument();
		const { node, contentEl } = createTextNode(
			"multiple-fences",
			"```html\n<h1>First</h1>\n```\n```html\n<h1>Second</h1>\n```"
		);

		restoreHtmlPreviews({ nodes: new Map([[node.id, node]]) }, true);

		expect(contentEl.querySelectorAll("iframe")).toHaveLength(1);
		expect(contentEl.querySelector("iframe")?.srcdoc).toBe("<h1>First</h1>");
	});
});
