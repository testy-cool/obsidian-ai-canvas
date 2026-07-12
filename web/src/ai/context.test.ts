import { describe, expect, it } from "vitest";
import { buildCanvasPrompt, collectPromptContext } from "./context";
import type { JsonCanvasData } from "../canvas/types";

const canvas: JsonCanvasData = {
	nodes: [
		{ id: "current", type: "text", text: "CURRENT QUESTION", x: 600, y: 0, width: 300, height: 180 },
		{ id: "skip", type: "text", text: "DO NOT SEND", x: 300, y: 0, width: 240, height: 160 },
		{ id: "keep", type: "text", text: "KEEP THIS CONTEXT", x: 0, y: 0, width: 240, height: 160 },
		{ id: "link", type: "link", url: "https://jsoncanvas.org", x: 0, y: 260, width: 240, height: 140 },
	],
	edges: [
		{ id: "skip-current", fromNode: "skip", toNode: "current", label: "excluded edge label" },
		{ id: "keep-skip", fromNode: "keep", toNode: "skip", label: "included edge label" },
		{ id: "link-current", fromNode: "link", toNode: "current", label: "reference" },
	],
};

describe("AI prompt context", () => {
	it("collects the current card and every unique incoming ancestor", () => {
		expect(collectPromptContext(canvas, "current").map(({ node, depth, edgeLabel }) => ({
			id: node.id,
			depth,
			edgeLabel,
		}))).toEqual([
			{ id: "current", depth: 0, edgeLabel: undefined },
			{ id: "skip", depth: 1, edgeLabel: "excluded edge label" },
			{ id: "link", depth: 1, edgeLabel: "reference" },
			{ id: "keep", depth: 2, edgeLabel: "included edge label" },
		]);
	});

	it("builds the exact prompt from checked cards while traversing through unchecked cards", () => {
		const prompt = buildCanvasPrompt(
			canvas,
			"current",
			new Set(["current", "keep"]),
			"Answer the question using only the selected context."
		);
		expect(prompt).toContain("KEEP THIS CONTEXT");
		expect(prompt).toContain("included edge label");
		expect(prompt).toContain("CURRENT QUESTION");
		expect(prompt).toContain("Answer the question using only the selected context.");
		expect(prompt).not.toContain("DO NOT SEND");
		expect(prompt).not.toContain("excluded edge label");
	});

	it("includes link and embedded file content in selected context", () => {
		const withFile: JsonCanvasData = {
			...canvas,
			nodes: [...canvas.nodes, { id: "file", type: "file", file: "brief.md", web_file_text: "EMBEDDED BRIEF", x: 0, y: 450, width: 240, height: 160 }],
			edges: [...canvas.edges, { id: "file-current", fromNode: "file", toNode: "current" }],
		};
		const prompt = buildCanvasPrompt(withFile, "current", new Set(["current", "link", "file"]), "Synthesize");
		expect(prompt).toContain("https://jsoncanvas.org");
		expect(prompt).toContain("EMBEDDED BRIEF");
	});
});
