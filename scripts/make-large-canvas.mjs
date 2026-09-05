/**
 * Manual measurement recipe (do not run Obsidian from this script):
 * 1. Run node scripts/make-large-canvas.mjs, then open
 *    test/fixtures/large-canvas.canvas in Obsidian and zoom out to fit.
 * 2. Run: obsidian dev:cdp method=Performance.enable
 * 3. Run: obsidian dev:cdp method=Performance.getMetrics
 *    Record Nodes, LayoutCount, and JSHeapUsedSize for the zoomed-out view.
 * 4. Drag a card for 5 seconds, then run Performance.getMetrics again.
 *    Record the same metrics and compare the LayoutCount delta.
 * Use the same zoom and card for before/after comparisons. Also capture
 * metrics after panning previews offscreen and waiting 3 seconds to park.
 */
import { mkdir, writeFile } from "node:fs/promises";

const nodeId = index => (index + 1).toString(16).padStart(16, "0");
const nodes = Array.from({ length: 200 }, (_, index) => {
	const label = String(index + 1).padStart(3, "0");
	const generated = index >= 40 && index < 100;
	const text = index < 40
		? `HTML preview ${label}\n\n\`\`\`html\n<!doctype html><html><head><meta charset="utf-8"><style>body { margin: 16px; font: 16px/1.5 sans-serif; }</style></head><body><h1>Preview ${label}</h1><p>Deterministic canvas preview ${label}.</p></body></html>\n\`\`\``
		: `Card ${label}\n\n${generated ? "Generated response" : "Plain text note"} ${label}.\n\nDeterministic content for canvas restoration and drag measurements.`;
	return {
		id: nodeId(index),
		type: "text",
		x: (index % 20) * 360,
		y: Math.floor(index / 20) * 260,
		width: 320,
		height: 220,
		text,
		...(generated ? { chat_role: "assistant", ai_provider: "Fixture", ai_model: "fixture-model" } : {}),
	};
});

const edges = Array.from({ length: 60 }, (_, index) => ({
	id: `e${(index + 1).toString(16).padStart(15, "0")}`,
	fromNode: nodeId(index + 39),
	fromSide: "right",
	toNode: nodeId(index + 40),
	toSide: "left",
	isGenerated: true,
}));

await mkdir(new URL("../test/fixtures/", import.meta.url), { recursive: true });
await writeFile(new URL("../test/fixtures/large-canvas.canvas", import.meta.url), `${JSON.stringify({ nodes, edges }, null, "\t")}\n`);
console.log("Wrote test/fixtures/large-canvas.canvas: 200 text cards, 40 HTML previews, 60 AI cards, 60 generated edges.");
