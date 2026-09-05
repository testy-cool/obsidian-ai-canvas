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
		const motion = block(css, "@media (prefers-reduced-motion: no-preference)");
		expect(block(motion, ".canvas-node.ai-generating")).toContain("transition: width 0.1s ease-out, height 0.1s ease-out !important;");
		expect(block(motion, ".canvas-node.ai-image-placeholder .canvas-node-content")).toContain("animation: ai-image-pulse 1.4s ease-in-out infinite;");
		const withoutMotion = css.replace(motion, "");
		expect(withoutMotion).not.toMatch(/transition:\s*width/);
		expect(withoutMotion).not.toContain("animation: ai-image-pulse");
		const badge = block(css, ".ai-model-indicator");
		expect(badge).not.toContain("backdrop-filter");
		expect(badge).toContain("background: var(--background-primary) !important;");
		expect(badge).toContain("font-size: 12px !important;");
	});
});
