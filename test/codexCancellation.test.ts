import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { streamCodexResponse } from "../src/utils/codexCli";

const childProcess = createRequire(import.meta.url)("child_process");
afterEach(() => vi.restoreAllMocks());

describe("Codex request cancellation", () => {
	it("stops its child and ignores late output and completion", async () => {
		const child = Object.assign(new EventEmitter(), {
			stdout: new EventEmitter(), stderr: new EventEmitter(),
			stdin: Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() }), kill: vi.fn(),
		});
		const spawn = vi.spyOn(childProcess, "spawn").mockReturnValue(child);
		const abort = new AbortController();
		const callback = vi.fn();
		const pending = streamCodexResponse({ id: "codex", type: "Codex", apiKey: "", baseUrl: "", enabled: true, binaryPath: process.execPath },
			[{ role: "user", content: "hello" }], { abortSignal: abort.signal }, callback);
		const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
		abort.abort();
		await rejected;
		child.stdout.emit("data", Buffer.from(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Late answer" } }) + "\n"));
		child.emit("close", 0);
		expect(spawn).toHaveBeenCalledOnce();
		expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
		expect(callback).not.toHaveBeenCalled();
	});
});
