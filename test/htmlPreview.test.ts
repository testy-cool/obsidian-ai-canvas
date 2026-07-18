import { afterEach, describe, expect, it, vi } from "vitest";
import {
	extractHtmlCodeBlocks,
	restoreHtmlPreviews,
} from "../src/utils/htmlPreview";

class FakeElement {
	className = "";
	children: FakeElement[] = [];
	sandbox = { add: vi.fn() };
	srcdoc = "";
	style: Record<string, string> = {};
	textContent = "";

	constructor(public tagName = "div") {}

	createEl(tagName: string, options?: { cls?: string; text?: string }) {
		const child = new FakeElement(tagName);
		child.className = options?.cls || "";
		child.textContent = options?.text || "";
		this.children.push(child);
		return child;
	}

	querySelector(selector: string): FakeElement | null {
		const className = selector.startsWith(".") ? selector.slice(1) : "";
		for (const child of this.children) {
			if (className && child.className.split(" ").includes(className)) return child;
			const nested = child.querySelector(selector);
			if (nested) return nested;
		}
		return null;
	}

	querySelectorAll(selector: string): FakeElement[] {
		const matches = this.children.filter(child => child.tagName === selector);
		return matches.concat(this.children.flatMap(child => child.querySelectorAll(selector)));
	}

	appendChild(child: FakeElement) { this.children.push(child); }
	setAttribute() {}
	addEventListener() {}
	addClass(className: string) { this.className += ` ${className}`; }
	removeClass(className: string) {
		this.className = this.className.split(" ").filter(value => value !== className).join(" ");
	}
	remove() {}
}

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

	it("attaches a preview to a plain text node with an html fence", () => {
		installFakeDocument();
		const contentEl = new FakeElement();
		const node = {
			text: "```html\n<main>Saved preview</main>\n```",
			contentEl,
			getData: () => ({ type: "text" }),
		};

		restoreHtmlPreviews({ nodes: new Map([["node", node]]) });

		expect(contentEl.querySelector(".html-preview-container")).not.toBeNull();
	});

	it("leaves a plain text node without an html fence untouched", () => {
		installFakeDocument();
		const contentEl = new FakeElement();
		const node = {
			text: "A normal text card",
			contentEl,
			getData: () => ({ type: "text" }),
		};

		restoreHtmlPreviews({ nodes: new Map([["node", node]]) });

		expect(contentEl.querySelector(".html-preview-container")).toBeNull();
	});
});
