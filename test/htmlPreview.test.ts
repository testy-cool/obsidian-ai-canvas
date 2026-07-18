import { describe, expect, it, vi } from "vitest";
import {
	extractHtmlCodeBlocks,
	restoreHtmlPreviews,
} from "../src/utils/htmlPreview";

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

	it("restores model-tagged AI nodes that predate chat_role metadata", () => {
		const querySelector = vi.fn(() => ({}));
		const node = {
			text: "```html\n<main>Saved preview</main>\n```",
			contentEl: { querySelector },
			getData: () => ({
				type: "text",
				ai_model: "test-model",
				ai_provider: "bifrost",
			}),
		};

		restoreHtmlPreviews({ nodes: new Map([["node", node]]) });

		expect(querySelector).toHaveBeenCalledWith(".html-preview-container");
	});
});
