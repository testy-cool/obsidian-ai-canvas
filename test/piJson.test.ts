import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { Platform } from "obsidian";
import { CLI_ADAPTERS, buildCliInvocation, createPiJsonParser, streamLocalCliResponse, CliEvent } from "../src/utils/localCli";
import { canvasFolderPath } from "../src/utils/canvasFolder";
import { fixtureLines, makeFakePi } from "./helpers/fakePi";

afterEach(() => { Platform.isDesktopApp = true; });

const readRun = (lines: string[]): CliEvent[] => {
	const parse = createPiJsonParser();
	return lines.map(parse).filter((event): event is NonNullable<CliEvent> => event !== null);
};

const assistantStart = JSON.stringify({ type: "message_start", message: { role: "assistant", content: [] } });
const textDelta = (delta: string) => JSON.stringify({
	type: "message_update",
	assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
});
const agentEnd = (...parts: any[]) => JSON.stringify({
	type: "agent_end",
	messages: [{ role: "assistant", content: parts, model: "m", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0.5 } } }],
});
const signed = (text: string, phase: string) => ({ type: "text", text, textSignature: JSON.stringify({ v: 1, id: "msg", phase }) });

describe("reading one Pi run in json mode", () => {
	it("gives the answer, the usage, the cost and the model of a one-message run", () => {
		const events = readRun(fixtureLines("pi-answer.jsonl"));
		expect(events.filter(event => event.textDelta).map(event => event.textDelta).join("")).toBe("OK");
		expect(events.some(event => event.textReplace !== undefined)).toBe(false);
		expect(events.at(-1)).toEqual({
			usage: { inputTokens: 64568, outputTokens: 254 },
			cost: 0.263352,
			model: "gpt-5.6-sol",
		});
	});

	it("sums every message of a run that used tools, not only the last one", () => {
		const done = readRun(fixtureLines("pi-tool-run.jsonl")).at(-1)!;
		expect(done.usage).toEqual({
			inputTokens: 64239 + (599 + 64128) + (363 + 64640),
			outputTokens: 317 + 262 + 5,
			cachedInputTokens: 64128 + 64640,
		});
		expect(done.cost).toBeCloseTo(0.263296 + 0.0332872 + 0.027408, 6);
	});

	it("never writes thinking or tool calls into the answer", () => {
		const events = readRun(fixtureLines("pi-tool-run.jsonl"));
		const written = events.filter(event => event.textDelta).map(event => event.textDelta).join("");
		expect(written).toBe("DONE");
		expect(JSON.stringify(events)).not.toContain("Planning session-start");
	});

	it("reports what Pi is doing as a status phase", () => {
		const phases = readRun(fixtureLines("pi-tool-run.jsonl")).map(event => event.phase).filter(Boolean);
		expect(phases).toContain("Thinking…");
		expect(phases).toContain("Using write…");
		expect(phases).toContain("Using bash…");
	});

	it("ignores lines that are not events", () => {
		const parse = createPiJsonParser();
		expect(parse("not json")).toBeNull();
		expect(parse(JSON.stringify({ type: "agent_start" }))).toBeNull();
		expect(parse(JSON.stringify({ type: "message_start", message: { role: "user" } }))).toBeNull();
	});
});

describe("replacing text that was only a step on the way", () => {
	it("clears the text of a message when the next assistant message starts", () => {
		const events = readRun([
			assistantStart,
			textDelta("Let me look at the file."),
			assistantStart,
			textDelta("The answer."),
			agentEnd(signed("The answer.", "final_answer")),
		]);
		expect(events.map(event => event.textDelta ?? event.textReplace)).toEqual([
			"Let me look at the file.", "", "The answer.", undefined,
		]);
		expect(events.at(-1)).not.toHaveProperty("textReplace");
	});

	it("ends on exactly the final answer when the last message also held other text", () => {
		const events = readRun([
			assistantStart,
			textDelta("Checking. "),
			textDelta("All done."),
			agentEnd(signed("Checking. ", "commentary"), signed("All done.", "final_answer")),
		]);
		expect(events.at(-1)?.textReplace).toBe("All done.");
	});

	it("uses every text part when none is marked as the final answer", () => {
		const events = readRun([
			assistantStart,
			agentEnd({ type: "text", text: "one " }, { type: "text", text: "two" }),
		]);
		expect(events.at(-1)?.textReplace).toBe("one two");
	});

	it("leaves the card empty when the last message has no text", () => {
		const events = readRun([assistantStart, textDelta("half a thought"), agentEnd({ type: "thinking", thinking: "x" })]);
		expect(events.at(-1)?.textReplace).toBe("");
	});
});

describe("running Pi through the plugin", () => {
	const provider = (binaryPath: string) => ({
		id: "pi", type: "Pi CLI", baseUrl: "", apiKey: "", enabled: true, binaryPath,
	}) as any;

	it("leaves a card with only the final answer, and the cost Pi reported", async () => {
		const pi = makeFakePi({ script: "pi-tool-run.jsonl" });
		try {
			let text = "";
			const phases: string[] = [];
			let completion: any;
			await streamLocalCliResponse(
				provider(pi.binary),
				[{ role: "user", content: "Create a.txt, then reply DONE." }] as any,
				{
					onComplete: result => { completion = result; },
					onReplaceText: replaced => { text = replaced; },
					onPhase: phase => phases.push(phase),
				},
				chunk => { if (chunk) text += chunk; },
			);
			expect(text).toBe("DONE");
			expect(completion.totalText).toBe("DONE");
			expect(completion.model).toBe("gpt-5.6-sol");
			expect(completion.costUsd).toBeCloseTo(0.3240, 3);
			expect(phases).toContain("Using write…");
		} finally {
			pi.cleanup();
		}
	}, 30000);

	it("returns only the final answer to callers that wait for the whole text", async () => {
		const { getResponse } = await import("../src/utils/ai");
		const pi = makeFakePi({ script: "pi-tool-run.jsonl" });
		try {
			const text = await getResponse(provider(pi.binary), [{ role: "user", content: "x" }] as any, {});
			expect(text).toBe("DONE");
		} finally {
			pi.cleanup();
		}
	}, 30000);
});

describe("where a CLI runs", () => {
	const provider = (type: string, binaryPath: string, cliArgs?: string) => ({
		id: "cli", type, baseUrl: "", apiKey: "", enabled: true, binaryPath, cliArgs,
	}) as any;

	it("runs Pi in the folder of the canvas", async () => {
		const pi = makeFakePi({ script: "pi-answer.jsonl" });
		const folder = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-folder-"));
		try {
			await streamLocalCliResponse(
				provider("Pi CLI", pi.binary), [{ role: "user", content: "x" }] as any, { cwd: folder }, () => {},
			);
			expect(fs.realpathSync(pi.calls()[0].cwd)).toBe(fs.realpathSync(folder));
		} finally {
			pi.cleanup();
			fs.rmSync(folder, { recursive: true, force: true });
		}
	}, 30000);

	it("falls back to a temporary folder when the canvas folder is not there", async () => {
		const pi = makeFakePi({ script: "pi-answer.jsonl" });
		try {
			await streamLocalCliResponse(
				provider("Pi CLI", pi.binary), [{ role: "user", content: "x" }] as any,
				{ cwd: path.join(os.tmpdir(), "no-such-canvas-folder") }, () => {},
			);
			expect(fs.realpathSync(pi.calls()[0].cwd)).toBe(fs.realpathSync(os.tmpdir()));
		} finally {
			pi.cleanup();
		}
	}, 30000);

	it("keeps every other CLI in a temporary folder", async () => {
		expect(Object.values(CLI_ADAPTERS).filter(adapter => adapter.runsInCanvasFolder).map(adapter => adapter.id)).toEqual(["pi"]);
		const folder = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-folder-"));
		try {
			let printed = "";
			await streamLocalCliResponse(
				provider("Local command", process.execPath, "-e process.stdout.write(process.cwd())"),
				[{ role: "user", content: "x" }] as any, { cwd: folder }, chunk => { if (chunk) printed += chunk; },
			);
			expect(fs.realpathSync(printed)).toBe(fs.realpathSync(os.tmpdir()));
		} finally {
			fs.rmSync(folder, { recursive: true, force: true });
		}
	}, 30000);
});

describe("the canvas folder", () => {
	it("joins the vault folder and the folder of the canvas file", () => {
		expect(canvasFolderPath("/home/me/Vault", "Projects/Alpha")).toBe("/home/me/Vault/Projects/Alpha");
	});

	it("is the vault folder itself for a canvas at the vault root", () => {
		expect(canvasFolderPath("/home/me/Vault", "/")).toBe("/home/me/Vault");
		expect(canvasFolderPath("/home/me/Vault", "")).toBe("/home/me/Vault");
	});
});

describe("Pi sessions", () => {
	const provider = (binaryPath: string) => ({
		id: "pi", type: "Pi CLI", baseUrl: "", apiKey: "", enabled: true, binaryPath,
	}) as any;

	it("reads the session id from the first event", () => {
		expect(readRun(fixtureLines("pi-answer.jsonl"))[0]).toEqual({ session: "11111111-2222-4333-8444-555555555555" });
	});

	it("reads the id of the new session when a run forked another", () => {
		expect(readRun(fixtureLines("pi-fork.jsonl"))[0]).toEqual({ session: "01a104dd-476c-7662-b338-57736c760c7c" });
	});

	it("forks the session before the prompt, which stays last", () => {
		const call = buildCliInvocation(CLI_ADAPTERS.pi, { prompt: "next", model: "m", forkSession: "abc" });
		expect(call.args).toEqual(["-p", "--mode", "json", "--model", "m", "--fork", "abc", "next"]);
	});

	it("starts a plain session when there is nothing to fork", () => {
		expect(buildCliInvocation(CLI_ADAPTERS.pi, { prompt: "next" }).args).toEqual(["-p", "--mode", "json", "next"]);
	});

	it("leaves the other CLIs without a fork flag", () => {
		for (const adapter of Object.values(CLI_ADAPTERS).filter(adapter => adapter.id !== "pi")) {
			const call = buildCliInvocation(adapter, { prompt: "next", forkSession: "abc" });
			expect([...call.args, call.stdin]).not.toContain("--fork");
			expect(call.args).not.toContain("abc");
		}
	});

	it("passes the fork to the command and reports the session of the run", async () => {
		const pi = makeFakePi({ script: "pi-fork.jsonl" });
		try {
			let completion: any;
			await streamLocalCliResponse(
				provider(pi.binary), [{ role: "user", content: "and now?" }] as any,
				{ forkSession: "01a104dc-7492-7183-854f-890681a92a30", onComplete: result => { completion = result; } },
				() => {},
			);
			const args = pi.calls()[0].args;
			expect(args.slice(-3)).toEqual(["--fork", "01a104dc-7492-7183-854f-890681a92a30", "user: and now?"]);
			expect(completion.sessionId).toBe("01a104dd-476c-7662-b338-57736c760c7c");
			expect(completion.totalText).toBe("hi");
		} finally {
			pi.cleanup();
		}
	}, 30000);
});

describe("starting fresh when the Pi session is gone", () => {
	const provider = (binaryPath: string) => ({
		id: "pi", type: "Pi CLI", baseUrl: "", apiKey: "", enabled: true, binaryPath,
	}) as any;
	const onlyNew = [{ role: "user", content: "next question" }] as any;
	const wholeChain = [{ role: "user", content: "first question" }, { role: "assistant", content: "first answer" }, { role: "user", content: "next question" }] as any;
	const gone = "No session found matching 'old-session'";

	it("runs again without --fork, with the whole chain, and says so", async () => {
		const pi = makeFakePi({ script: "pi-answer.jsonl", failures: { 0: gone } });
		try {
			let completion: any;
			let text = "";
			await streamLocalCliResponse(
				provider(pi.binary), onlyNew,
				{ forkSession: "old-session", fallbackMessages: wholeChain, onComplete: result => { completion = result; } },
				chunk => { if (chunk) text += chunk; },
			);
			const calls = pi.calls();
			expect(calls).toHaveLength(2);
			expect(calls[0].args.slice(-3)).toEqual(["--fork", "old-session", "user: next question"]);
			expect(calls[1].args).toEqual(["-p", "--mode", "json", "user: first question\n\nassistant: first answer\n\nuser: next question"]);
			expect(text).toBe("OK");
			expect(completion.startedFreshSession).toBe(true);
			expect(completion.sessionId).toBe("11111111-2222-4333-8444-555555555555");
			expect(completion.error).toBeUndefined();
		} finally {
			pi.cleanup();
		}
	}, 30000);

	it("does not start over when the fork worked", async () => {
		const pi = makeFakePi({ script: "pi-fork.jsonl" });
		try {
			let completion: any;
			await streamLocalCliResponse(
				provider(pi.binary), onlyNew,
				{ forkSession: "old-session", fallbackMessages: wholeChain, onComplete: result => { completion = result; } },
				() => {},
			);
			expect(pi.calls()).toHaveLength(1);
			expect(completion.startedFreshSession).toBeUndefined();
		} finally {
			pi.cleanup();
		}
	}, 30000);

	it("reports a failure that came after the session started instead of starting over", async () => {
		const pi = makeFakePi({ script: "pi-fork.jsonl", lateFailures: { 0: "provider exploded" } });
		try {
			await expect(streamLocalCliResponse(
				provider(pi.binary), onlyNew, { forkSession: "old-session", fallbackMessages: wholeChain }, () => {},
			)).rejects.toThrow(/provider exploded/);
			expect(pi.calls()).toHaveLength(1);
		} finally {
			pi.cleanup();
		}
	}, 30000);

	it("tries only once more", async () => {
		const pi = makeFakePi({ script: "pi-answer.jsonl", failures: { 0: gone, 1: "Error: Model not found" } });
		try {
			await expect(streamLocalCliResponse(
				provider(pi.binary), onlyNew, { forkSession: "old-session", fallbackMessages: wholeChain }, () => {},
			)).rejects.toThrow(/Model not found/);
			expect(pi.calls()).toHaveLength(2);
		} finally {
			pi.cleanup();
		}
	}, 30000);

	it("has nothing to start over with when no full chain was given", async () => {
		const pi = makeFakePi({ script: "pi-answer.jsonl", failures: { 0: gone } });
		try {
			await expect(streamLocalCliResponse(
				provider(pi.binary), onlyNew, { forkSession: "old-session" }, () => {},
			)).rejects.toThrow(/No session found/);
			expect(pi.calls()).toHaveLength(1);
		} finally {
			pi.cleanup();
		}
	}, 30000);

	it("does not retry a run that never asked for a fork", async () => {
		const pi = makeFakePi({ script: "pi-answer.jsonl", failures: { 0: "Error: Model not found" } });
		try {
			await expect(streamLocalCliResponse(
				provider(pi.binary), onlyNew, { fallbackMessages: wholeChain }, () => {},
			)).rejects.toThrow(/Model not found/);
			expect(pi.calls()).toHaveLength(1);
		} finally {
			pi.cleanup();
		}
	}, 30000);
});

