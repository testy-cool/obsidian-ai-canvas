import { expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

it("routes source console logging through logDebug", () => {
	const root = new URL("../src/", import.meta.url).pathname;
	const violations: string[] = [];
	const visit = (directory: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) visit(path);
			// Prompt CSV text is user-facing data, not executable logging.
			else if (/\.[cm]?[jt]sx?$/.test(entry.name) && relative(root, path) !== "logDebug.ts") {
				if (/console\.log\s*\(/.test(readFileSync(path, "utf8"))) violations.push(relative(root, path));
			}
		}
	};
	visit(root);
	expect(violations).toEqual([]);
});
