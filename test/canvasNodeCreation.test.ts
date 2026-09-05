import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNode, type DirectionBias } from "../src/obsidian/canvas-patches";

const fixture = () => {
	const nodes: any[] = [];
	const canvas: any = {
		x: 100, y: 200,
		getEdgesForNode: () => [],
		createTextNode: vi.fn((options: any) => {
			const node = { id: "response", ...options.pos, ...options.size, setData: vi.fn() };
			nodes.push(node);
			return node;
		}),
		deselectAll: vi.fn(), addNode: vi.fn(),
		getData: () => ({ nodes, edges: [] }),
		importData: vi.fn(), requestFrame: vi.fn(),
	};
	const parent: any = { id: "prompt", x: 10, y: 20, width: 400, height: 400, canvas };
	return { canvas, parent };
};

beforeEach(() => vi.stubGlobal("parent", {}));
afterEach(() => vi.unstubAllGlobals());

describe("empty response card geometry", () => {
	it.each<DirectionBias>(["up", "down", "left", "right", "none"])("retains the requested dimensions and finite coordinates when placed %s", direction => {
		const { canvas, parent } = fixture();
		createNode(canvas, { text: "", size: { width: 300, height: 500 } }, parent, { chat_role: "assistant" } as any, undefined, direction);
		const options = canvas.createTextNode.mock.calls[0][0];
		expect(options.size).toEqual({ width: 300, height: 500 });
		for (const value of Object.values(options.pos)) expect(Number.isFinite(value)).toBe(true);
		expect(options.text).toBe("");
		const saved = canvas.importData.mock.calls[0][0];
		expect(saved.edges[0]).toMatchObject({ fromNode: "prompt", toNode: "response", isGenerated: true });
		expect(Number.isFinite(saved.nodes[0].y)).toBe(true);
	});

	it("gives a blank card finite fallback dimensions without a parent", () => {
		const { canvas } = fixture();
		createNode(canvas, { text: "" });
		const options = canvas.createTextNode.mock.calls[0][0];
		for (const value of [...Object.values(options.pos), ...Object.values(options.size)]) expect(Number.isFinite(value)).toBe(true);
	});
});
