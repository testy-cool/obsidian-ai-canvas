/**
 * Build, then say what changed in the shipped bundle.
 *
 * A cleanup commit should be able to prove the build did not change, rather than
 * argue it from green tests. This keeps the current `main.js`, rebuilds, and
 * compares the two.
 *
 *   pnpm run build:diff            rebuild and report
 *   pnpm run build:diff -- 200     show up to 200 diff lines instead of 40
 *
 * Tree shaking is on, so code nothing reaches never enters the bundle. An added
 * export that no one imports shows up as no change at all, which is correct and
 * worth remembering before concluding the script is broken.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

const BUNDLE = "main.js";
const maxLines = Number(process.argv[2]) || 40;

const previous = fs.existsSync(BUNDLE) ? fs.readFileSync(BUNDLE, "utf8") : null;
if (!previous) console.log("No existing main.js, so this run only builds.");

// Type check and build exactly as a release does, without recursing through the
// npm script that calls this file.
const tsc = spawnSync("node", ["--max-old-space-size=4096", "./node_modules/typescript/bin/tsc", "-noEmit", "-skipLibCheck"], { stdio: "inherit" });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
const build = spawnSync("node", ["esbuild.config.mjs", "production"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

if (!previous) process.exit(0);

const current = fs.readFileSync(BUNDLE, "utf8");
const delta = current.length - previous.length;
const sign = delta > 0 ? "+" : "";
console.log(`\n${BUNDLE}: ${previous.length} to ${current.length} bytes (${sign}${delta})`);

if (current === previous) {
	console.log("The shipped bundle is byte for byte identical.");
	process.exit(0);
}

// esbuild does not minify here, but statements still share lines. Splitting on
// semicolons makes the diff readable without pulling in a diff library.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "build-diff-"));
const split = (text) => text.split(";").join(";\n");
const before = path.join(scratch, "before.js");
const after = path.join(scratch, "after.js");
fs.writeFileSync(before, split(previous));
fs.writeFileSync(after, split(current));

const diff = spawnSync("diff", ["-u", before, after], { encoding: "utf8" });
const body = (diff.stdout || "").split("\n").slice(2);
const changed = body.filter((line) => /^[+-]/.test(line)).length;
console.log(`${changed} changed statements. First ${Math.min(maxLines, body.length)} lines of the diff:\n`);
console.log(body.slice(0, maxLines).join("\n"));
if (body.length > maxLines) console.log(`\n… ${body.length - maxLines} more lines. Pass a larger number to see them.`);
console.log(`\nFull diff inputs: ${before} and ${after}`);
