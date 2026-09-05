import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const block = (css: string, selector: string) => {
	const start = css.indexOf(`${selector} {`);
	expect(start).toBeGreaterThanOrEqual(0);
	let depth = 0;
	for (let index = css.indexOf("{", start); index < css.length; index++) {
		if (css[index] === "{") depth++;
		if (css[index] === "}" && --depth === 0) return css.slice(start, index + 1);
	}
	throw new Error(`Unclosed CSS block: ${selector}`);
};

describe("canvas sizing and motion", () => {
	it.each(["styles.css", "src/styles/settings.css"])("%s scopes sizing to generation and respects reduced motion", (path) => {
		const css = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
		const sizing = block(css, ".canvas-node.ai-generating");
		expect(sizing).toContain("min-width: 300px !important;");
		expect(sizing).toContain("min-height: 500px !important;");
		expect(css).not.toContain('.canvas-node[data-node-type="text"] {');
		expect(css.match(/@media \(prefers-reduced-motion: no-preference\)/g)).toHaveLength(1);
		const motion = block(css, "@media (prefers-reduced-motion: no-preference)");
		expect(block(motion, ".modal-button-container button")).toContain("transition: all 0.2s;");
		expect(block(motion, ".ai-model-indicator")).toContain("transition: opacity 0.2s ease !important;");
		expect(block(motion, ".canvas-node.ai-generating")).toContain("transition: width 0.1s ease-out, height 0.1s ease-out !important;");
		expect(block(motion, ".canvas-node.ai-image-placeholder .canvas-node-content")).toContain("animation: ai-image-pulse 1.4s ease-in-out infinite;");
		const withoutMotion = css.replace(motion, "");
		expect(withoutMotion).not.toMatch(/transition:/);
		expect(withoutMotion).not.toContain("animation: ai-image-pulse");
		const badge = block(css, ".ai-model-indicator");
		expect(badge).toContain("display: inline-grid;");
		expect(block(css, ".ai-model-indicator > span")).toContain("grid-area: 1 / 1;");
		expect(block(css, ".ai-model-indicator-loading-size")).toContain("visibility: hidden;");
		expect(badge).not.toContain("backdrop-filter");
		expect(badge).toContain("background: var(--background-primary) !important;");
		expect(badge).toContain("font-size: 12px !important;");
	});
});


describe("tool pill sizing", () => {
	it("keeps result text readable and reserves a fixed status glyph cell", () => {
		const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
		for (const selector of [".mcp-tool-status", ".mcp-tool-args"]) {
			expect(block(css, selector)).toContain("font-size: 12px;");
		}
		expect(block(css, ".mcp-tool-status")).toContain("border-left: 2px solid transparent;");
		expect(block(css, ".mcp-tool-status")).toContain("grid-template-columns: 20px minmax(0, 1fr);");
		expect(block(css, ".mcp-tool-status-glyph")).toContain("width: 20px;");
		expect(block(css, ".mcp-tools-container")).toContain("width: 100%;");
	});
});


it("keeps the feature line at a fixed available width with 12px text", () => {
	const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
	const features = block(css, ".ai-features-indicator");
	expect(features).toContain("width: 100%;");
	expect(features).toContain("font-size: 12px;");
	expect(block(css, ".ai-features-indicator > span")).toContain("flex: 1;");
});


it.each(["styles.css", "src/styles/settings.css"])("%s keeps card notes at 12px without affecting badge width", (path) => {
	const css = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
	const notes = block(css, ".ai-card-notes");
	expect(notes).toContain("font-size: 12px;");
	expect(notes).toContain("grid-area: 2 / 1;");
	expect(notes).toContain("contain: inline-size;");
});
