import { describe, expect, it } from "vitest";
import { parseCanvasJson, serializeCanvas } from "./codec";

describe("JSON Canvas codec", () => {
	it("parses all official node types and edge fields", () => {
		const source = {
			nodes: [
				{ id: "text", type: "text", text: "# Hello", x: 10, y: 20, width: 320, height: 180, color: "2" },
				{ id: "file", type: "file", file: "Notes/Brief.md", subpath: "#Overview", x: 400, y: 20, width: 360, height: 240 },
				{ id: "link", type: "link", url: "https://jsoncanvas.org", x: 10, y: 260, width: 360, height: 180 },
				{ id: "group", type: "group", label: "Research", background: "Assets/grid.png", backgroundStyle: "cover", x: -20, y: -20, width: 820, height: 520 },
			],
			edges: [
				{ id: "edge", fromNode: "text", fromSide: "right", fromEnd: "none", toNode: "file", toSide: "left", toEnd: "arrow", color: "#7c3aed", label: "supports" },
			],
		};

		expect(parseCanvasJson(JSON.stringify(source))).toEqual(source);
	});

	it("preserves unknown custom fields while serializing edited data", () => {
		const source = {
			nodes: [{ id: "image", type: "file", file: "generated.png", x: 0, y: 0, width: 400, height: 300, ai_image_prompt: "A copper observatory", custom: { duration: 12 } }],
			edges: [],
			customRoot: { plugin: "augmented-canvas" },
		};

		const parsed = parseCanvasJson(JSON.stringify(source));
		parsed.nodes[0].x = 42;

		expect(JSON.parse(serializeCanvas(parsed))).toEqual({
			...source,
			nodes: [{ ...source.nodes[0], x: 42 }],
		});
	});

	it("rejects malformed canvases with a useful error", () => {
		expect(() => parseCanvasJson('{"nodes":[{"id":"broken"}],"edges":[]}')).toThrow(
			"Node broken is missing a valid type"
		);
	});

	it("rejects duplicate node and edge identifiers", () => {
		const duplicateNodes = JSON.stringify({
			nodes: [
				{ id: "same", type: "text", text: "A", x: 0, y: 0, width: 200, height: 100 },
				{ id: "same", type: "text", text: "B", x: 20, y: 20, width: 200, height: 100 },
			],
			edges: [],
		});
		expect(() => parseCanvasJson(duplicateNodes)).toThrow("Duplicate node id: same");
	});
});
