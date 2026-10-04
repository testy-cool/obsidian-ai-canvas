import fs from "fs";
import os from "os";
import path from "path";

export const fixturePath = (name: string) => path.join(__dirname, "..", "fixtures", name);

export const fixtureLines = (name: string): string[] =>
	fs.readFileSync(fixturePath(name), "utf8").split("\n").filter(line => line.trim());

export type FakePiCall = { args: string[]; cwd: string };

/**
 * A stand-in for the `pi` command: it records its arguments and working
 * directory, then prints a recorded run. `script` may name one fixture or a
 * list, used one per call. `failures` lists calls (0-based) that exit 1 with
 * the given message on stderr and print nothing.
 */
export const makeFakePi = ({ script, failures = {} }: { script: string | string[]; failures?: Record<number, string> }) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-pi-"));
	const binary = path.join(dir, "pi");
	const log = path.join(dir, "calls.jsonl");
	const runs = Array.isArray(script) ? script : [script];
	fs.writeFileSync(binary, `#!${process.execPath}
const fs = require("fs");
const log = ${JSON.stringify(log)};
const runs = ${JSON.stringify(runs.map(fixturePath))};
const failures = ${JSON.stringify(failures)};
const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\\n").filter(Boolean).length : 0;
fs.appendFileSync(log, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + "\\n");
if (failures[calls] !== undefined) {
	process.stderr.write(failures[calls]);
	process.exit(1);
}
process.stdout.write(fs.readFileSync(runs[Math.min(calls, runs.length - 1)], "utf8"));
`);
	fs.chmodSync(binary, 0o755);
	return {
		binary,
		calls: (): FakePiCall[] =>
			fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)) : [],
		cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
	};
};
