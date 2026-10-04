import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const dirs: string[] = [];
const scratch = () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shell-env-"));
	dirs.push(dir);
	return dir;
};
const script = (dir: string, name: string, body: string) => {
	const file = path.join(dir, name);
	fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
	return file;
};
const originalShell = process.env.SHELL;

afterEach(() => {
	process.env.SHELL = originalShell;
	vi.resetModules();
	for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("the shell's PATH for local commands", () => {
	it("reads the PATH between the markers, ignoring what startup files print", async () => {
		const { readMarkedPath } = await import("../src/utils/shellEnv");
		expect(readMarkedPath("Welcome!\n__AI_CANVAS_PATH__/a/bin:/usr/bin__AI_CANVAS_PATH__\n")).toBe("/a/bin:/usr/bin");
		expect(readMarkedPath("no markers here")).toBeNull();
	});

	it("starts Pi's model list with the login shell's PATH, not Obsidian's", async () => {
		const dir = scratch();
		// Only the shell knows about this folder, as fnm's Node is only known to the shell.
		const shellOnly = path.join(dir, "shell-only-bin");
		fs.mkdirSync(shellOnly);
		process.env.SHELL = script(dir, "fake-shell", `cat > /dev/null\necho "rc noise"\nprintf '\\n__AI_CANVAS_PATH__%s__AI_CANVAS_PATH__\\n' "${shellOnly}:/usr/bin:/bin"`);
		const pi = script(dir, "pi", `cat > /dev/null\ncase ":$PATH:" in *":${shellOnly}:"*) ;; *) echo "old node" >&2; exit 1;; esac\nprintf 'provider model\\nopenai-codex gpt-5.6-sol\\n'`);

		const { CLI_ADAPTERS } = await import("../src/utils/localCli");
		expect(await CLI_ADAPTERS.pi.listModels!(pi)).toEqual(["openai-codex/gpt-5.6-sol"]);
	});

	it("keeps Obsidian's own environment when the shell does not answer", async () => {
		const dir = scratch();
		process.env.SHELL = script(dir, "broken-shell", "exit 1");
		const { getCliEnv } = await import("../src/utils/shellEnv");
		expect((await getCliEnv()).PATH).toBe(process.env.PATH);
	});
});
