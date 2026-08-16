import { describe, expect, it } from "vitest";
import { findCanvasMenuHost } from "../src/obsidian/canvas-patches";

// Obsidian 1.7+ keeps background tabs "deferred": the leaf still reports
// "canvas" from getViewType(), so getLeavesOfType("canvas") returns it, but the
// placeholder view has no `canvas` object behind it.
const deferredLeaf = { view: { getViewType: () => "canvas" } } as any;

const loadedLeaf = {
	view: { canvas: { menu: { selection: new Set() } } },
} as any;

describe("findCanvasMenuHost", () => {
	it("skips deferred canvas leaves and returns the loaded one", () => {
		expect(findCanvasMenuHost([deferredLeaf, loadedLeaf])).toBe(loadedLeaf.view);
	});

	it("returns null when every canvas leaf is still deferred", () => {
		expect(findCanvasMenuHost([deferredLeaf])).toBeNull();
	});

	it("returns null for an empty leaf list", () => {
		expect(findCanvasMenuHost([])).toBeNull();
	});

	it("skips a canvas whose menu is not built yet", () => {
		const menulessLeaf = { view: { canvas: {} } } as any;
		expect(findCanvasMenuHost([menulessLeaf, loadedLeaf])).toBe(loadedLeaf.view);
	});

	it("skips a menu without a selection tracker", () => {
		const selectionlessLeaf = { view: { canvas: { menu: {} } } } as any;
		expect(findCanvasMenuHost([selectionlessLeaf, loadedLeaf])).toBe(
			loadedLeaf.view
		);
	});
});
