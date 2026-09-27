import { describe, it, expect, afterEach } from "vitest";
import { Platform } from "obsidian";
import {
	CLI_ADAPTERS,
	cliAdapterForProviderType,
	parseClaudeCliEvent,
	buildCliInvocation,
	streamLocalCliResponse,
	CLI_DEFAULT_MODEL,
} from "../src/utils/localCli";

afterEach(() => { Platform.isDesktopApp = true; });

describe("choosing an adapter", () => {
	it("maps each local CLI provider type to its adapter", () => {
		expect(cliAdapterForProviderType("Claude CLI")?.id).toBe("claude");
		expect(cliAdapterForProviderType("Pi CLI")?.id).toBe("pi");
		expect(cliAdapterForProviderType("Hermes CLI")?.id).toBe("hermes");
		expect(cliAdapterForProviderType("Local command")?.id).toBe("custom");
		expect(cliAdapterForProviderType("OpenAI")).toBeUndefined();
	});
});

describe("building the invocation", () => {
	it("asks the Claude CLI for streaming json and feeds the prompt on stdin", () => {
		const call = buildCliInvocation(CLI_ADAPTERS.claude, { prompt: "hello", model: "sonnet" });
		expect(call.args).toEqual(["-p", "--output-format", "stream-json", "--verbose", "--model", "sonnet"]);
		expect(call.stdin).toBe("hello");
	});

	it("leaves the model out when none is chosen", () => {
		expect(buildCliInvocation(CLI_ADAPTERS.claude, { prompt: "hello" }).args)
			.toEqual(["-p", "--output-format", "stream-json", "--verbose"]);
	});

	it("passes the prompt to Pi as an argument, in plain text mode", () => {
		const call = buildCliInvocation(CLI_ADAPTERS.pi, { prompt: "hello", model: "google/gemini-3-flash" });
		expect(call.args).toEqual(["-p", "--mode", "text", "--model", "google/gemini-3-flash", "hello"]);
		expect(call.stdin).toBeUndefined();
	});

	it("carries the prompt in the Hermes prompt flag", () => {
		const call = buildCliInvocation(CLI_ADAPTERS.hermes, { prompt: "hello", model: "opus" });
		expect(call.args).toEqual(["-m", "opus", "-z", "hello"]);
	});

	it("adds the user's own arguments before the prompt", () => {
		const call = buildCliInvocation(CLI_ADAPTERS.hermes, { prompt: "hello", extraArgs: ["--provider", "openrouter"] });
		expect(call.args).toEqual(["--provider", "openrouter", "-z", "hello"]);
	});
});

describe("reading Claude CLI events", () => {
	it("takes the assistant text out of a message event", () => {
		const event = parseClaudeCliEvent(JSON.stringify({
			type: "assistant",
			message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
		}));
		expect(event).toEqual({ textDelta: "ok" });
	});

	it("takes token counts, including cache reads, from the result event", () => {
		const event = parseClaudeCliEvent(JSON.stringify({
			type: "result",
			usage: { input_tokens: 2, output_tokens: 4, cache_read_input_tokens: 13116 },
		}));
		expect(event).toEqual({ usage: { inputTokens: 2, outputTokens: 4, cachedInputTokens: 13116 } });
	});

	it("ignores the hook and session noise the CLI prints first", () => {
		expect(parseClaudeCliEvent(JSON.stringify({ type: "system", subtype: "hook_started" }))).toBeNull();
		expect(parseClaudeCliEvent("not json")).toBeNull();
	});
});

describe("running a local CLI", () => {
	const provider = (overrides: Record<string, unknown> = {}) => ({
		id: "local", type: "Local command", baseUrl: "", apiKey: "", enabled: true,
		binaryPath: process.execPath, ...overrides,
	}) as any;

	it("streams plain stdout into the card", async () => {
		const chunks: string[] = [];
		let completion: any;
		await streamLocalCliResponse(
			provider({ cliArgs: '-e process.stdout.write("hel");process.stdout.write("lo")' }),
			[{ role: "user", content: "ignored" }] as any,
			{ onComplete: (r) => { completion = r; } },
			(chunk) => { if (chunk) chunks.push(chunk); },
		);
		expect(chunks.join("")).toBe("hello");
		expect(completion.totalText).toBe("hello");
	}, 30000);

	it("fails with the command's own error output when it exits badly", async () => {
		await expect(streamLocalCliResponse(
			provider({ cliArgs: '-e process.stderr.write("no-credentials");process.exit(3)' }),
			[{ role: "user", content: "x" }] as any, {}, () => {},
		)).rejects.toThrow(/no-credentials/);
	}, 30000);

	it("says which binary is missing instead of failing obscurely", async () => {
		await expect(streamLocalCliResponse(
			{ id: "local", type: "Claude CLI", baseUrl: "", apiKey: "", enabled: true, binaryPath: "/nonexistent/claude" } as any,
			[{ role: "user", content: "x" }] as any, {}, () => {},
		)).rejects.toThrow(/Claude CLI/);
	});

	it("refuses to run on mobile", async () => {
		Platform.isDesktopApp = false;
		await expect(streamLocalCliResponse(provider(), [{ role: "user", content: "x" }] as any, {}, () => {}))
			.rejects.toThrow(/desktop/i);
	});
});

describe("routing", () => {
	it("sends a local CLI provider through the shared streaming entry point", async () => {
		const { streamResponse } = await import("../src/utils/ai");
		const chunks: string[] = [];
		await streamResponse(
			{
				id: "local", type: "Local command", baseUrl: "", apiKey: "", enabled: true,
				binaryPath: process.execPath, cliArgs: '-e process.stdout.write("routed")',
			} as any,
			[{ role: "user", content: "x" }] as any,
			{},
			(chunk) => { if (chunk) chunks.push(chunk); },
		);
		expect(chunks.join("")).toBe("routed");
	}, 30000);
});

describe("the default model", () => {
	it("sends no model flag, so the CLI uses its own configuration", () => {
		expect(buildCliInvocation(CLI_ADAPTERS.claude, { prompt: "hi", model: CLI_DEFAULT_MODEL }).args)
			.toEqual(["-p", "--output-format", "stream-json", "--verbose"]);
	});

	it("is offered first by every adapter, so a provider is usable before picking a model", () => {
		for (const adapter of Object.values(CLI_ADAPTERS)) {
			expect(adapter.models[0]).toBe(CLI_DEFAULT_MODEL);
		}
	});
});
