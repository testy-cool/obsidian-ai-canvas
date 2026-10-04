import { Platform } from "obsidian";
import { ModelMessage } from "@ai-sdk/provider-utils";
import { LLMProvider } from "../settings/AugmentedCanvasSettings";
import { logDebug } from "../logDebug";
import type { StreamOptions, ToolEvent } from "./ai";

/** Model id meaning "whatever the CLI is already configured for". */
export const CLI_DEFAULT_MODEL = "default";

export type CliUsage = { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
export type CliEvent = {
	textDelta?: string;
	/** Swap everything written so far for this text, for a CLI whose last message is not what it streamed. */
	textReplace?: string;
	reasoningDelta?: string;
	/** What the CLI is doing, for the card's status line. */
	phase?: string;
	usage?: CliUsage;
	/** Dollars, when the CLI reports its own cost. */
	cost?: number;
	/** The model the CLI actually used. */
	model?: string;
	/** The id of the session this run belongs to, for a CLI that keeps sessions. */
	session?: string;
	error?: string;
} | null;

export type CliAdapter = {
	id: string;
	/** Provider type string shown in settings. */
	providerType: string;
	/** Command looked up on PATH when no binary path is set. */
	binary: string;
	/** Suggested models; empty means whatever the CLI is configured for. */
	models: string[];
	installHint: string;
	modelFlag?: string;
	/** How the prompt reaches the command. */
	promptVia: "stdin" | "arg" | "flag";
	promptFlag?: string;
	baseArgs: string[];
	/** Left undefined when the command simply prints its answer. */
	parseLine?: (line: string) => CliEvent;
	/** Like `parseLine`, for a CLI whose events only make sense in order. Called once per run. */
	createParser?: () => (line: string) => CliEvent;
	/** Work in the canvas's own folder, not a temporary one. For a CLI that acts on files and keeps its sessions per folder. */
	runsInCanvasFolder?: boolean;
	/** Flag that starts a run as a copy of an earlier session, leaving that session as it was. */
	forkFlag?: string;
};

/**
 * Read one line of `claude -p --output-format stream-json`. The CLI opens with
 * hook and session events that carry no answer, so anything unrecognised is
 * skipped rather than treated as text.
 */
export const parseClaudeCliEvent = (line: string): CliEvent => {
	let event: any;
	try {
		event = JSON.parse(line);
	} catch {
		return null;
	}

	if (event?.type === "assistant") {
		const text = (event.message?.content ?? [])
			.filter((part: any) => part?.type === "text" && typeof part.text === "string")
			.map((part: any) => part.text)
			.join("");
		return text ? { textDelta: text } : null;
	}

	if (event?.type === "result") {
		if (event.is_error && event.result) return { error: String(event.result) };
		const usage = event.usage ?? {};
		return {
			usage: {
				inputTokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
				outputTokens: usage.output_tokens ?? 0,
				...(usage.cache_read_input_tokens ? { cachedInputTokens: usage.cache_read_input_tokens } : {}),
			},
		};
	}

	return null;
};

const piTextPhase = (part: any): string | undefined => {
	try {
		return JSON.parse(part.textSignature)?.phase;
	} catch {
		return undefined;
	}
};

/**
 * Read the lines of `pi -p --mode json` for one run. Pi may write several
 * assistant messages (one per tool round) and only the last is the answer, so
 * the text streamed while a message is being written is swapped out when the
 * next message starts, and again at the end for exactly the answer. Usage and
 * cost are summed over every assistant message of the run, because the last one
 * alone reports only its own round.
 */
export const createPiJsonParser = () => {
	let written = "";

	return (line: string): CliEvent => {
		let event: any;
		try {
			event = JSON.parse(line);
		} catch {
			return null;
		}

		switch (event?.type) {
			case "session":
				return typeof event.id === "string" ? { session: event.id } : null;
			case "message_start": {
				if (event.message?.role !== "assistant" || !written) return null;
				written = "";
				return { textReplace: "" };
			}
			case "message_update": {
				const update = event.assistantMessageEvent;
				if (update?.type === "text_delta" && typeof update.delta === "string") {
					written += update.delta;
					return { textDelta: update.delta };
				}
				if (update?.type === "thinking_start") return { phase: "Thinking…" };
				if (update?.type === "toolcall_start") return { phase: `Using ${update.toolName || "tool"}…` };
				return null;
			}
			case "tool_execution_start":
				return { phase: `Using ${event.toolName || "tool"}…` };
			case "tool_execution_end":
				return { phase: "Generating…" };
			case "agent_end": {
				const assistants: any[] = (event.messages ?? []).filter((message: any) => message?.role === "assistant");
				const last = assistants[assistants.length - 1];
				const parts = (last?.content ?? []).filter((part: any) => part?.type === "text" && typeof part.text === "string");
				const marked = parts.filter((part: any) => piTextPhase(part) === "final_answer");
				const answer = (marked.length ? marked : parts).map((part: any) => part.text).join("");

				let inputTokens = 0;
				let outputTokens = 0;
				let cachedInputTokens = 0;
				let cost = 0;
				let reported = false;
				for (const message of assistants) {
					const usage = message.usage;
					if (!usage) continue;
					reported = true;
					inputTokens += (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
					outputTokens += usage.output ?? 0;
					cachedInputTokens += usage.cacheRead ?? 0;
					cost += usage.cost?.total ?? 0;
				}

				const result: NonNullable<CliEvent> = {};
				if (answer !== written) result.textReplace = answer;
				written = answer;
				if (reported) {
					result.usage = { inputTokens, outputTokens, ...(cachedInputTokens ? { cachedInputTokens } : {}) };
					result.cost = cost;
				}
				if (typeof last?.model === "string") result.model = last.model;
				return Object.keys(result).length ? result : null;
			}
			default:
				return null;
		}
	};
};

export const CLI_ADAPTERS: Record<string, CliAdapter> = {
	claude: {
		id: "claude",
		providerType: "Claude CLI",
		binary: "claude",
		models: [CLI_DEFAULT_MODEL, "opus", "sonnet", "haiku"],
		installHint: "Install Claude Code, or set the binary path in the provider settings.",
		modelFlag: "--model",
		promptVia: "stdin",
		baseArgs: ["-p", "--output-format", "stream-json", "--verbose"],
		parseLine: parseClaudeCliEvent,
	},
	pi: {
		id: "pi",
		providerType: "Pi CLI",
		binary: "pi",
		models: [CLI_DEFAULT_MODEL],
		installHint: "Install pi, or set the binary path in the provider settings.",
		modelFlag: "--model",
		promptVia: "arg",
		baseArgs: ["-p", "--mode", "json"],
		createParser: createPiJsonParser,
		runsInCanvasFolder: true,
		forkFlag: "--fork",
	},
	hermes: {
		id: "hermes",
		providerType: "Hermes CLI",
		binary: "hermes",
		models: [CLI_DEFAULT_MODEL],
		installHint: "Install Hermes Agent, or set the binary path in the provider settings.",
		modelFlag: "-m",
		promptVia: "flag",
		promptFlag: "-z",
		baseArgs: [],
	},
	custom: {
		id: "custom",
		providerType: "Local command",
		binary: "",
		models: [CLI_DEFAULT_MODEL],
		installHint: "Set the binary path for the command to run.",
		promptVia: "stdin",
		baseArgs: [],
	},
};

export const cliAdapterForProviderType = (type: string): CliAdapter | undefined =>
	Object.values(CLI_ADAPTERS).find(adapter => adapter.providerType === type);

export type CliInvocation = { args: string[]; stdin?: string };

/** Assemble argv for one adapter. The prompt goes last so it cannot be read as a flag value. */
export const buildCliInvocation = (
	adapter: CliAdapter,
	{ prompt, model, extraArgs, forkSession }: { prompt: string; model?: string; extraArgs?: string[]; forkSession?: string }
): CliInvocation => {
	const args = [...adapter.baseArgs];
	if (model && model !== CLI_DEFAULT_MODEL && adapter.modelFlag) args.push(adapter.modelFlag, model);
	if (forkSession && adapter.forkFlag) args.push(adapter.forkFlag, forkSession);
	if (extraArgs?.length) args.push(...extraArgs);

	if (adapter.promptVia === "flag" && adapter.promptFlag) {
		args.push(adapter.promptFlag, prompt);
		return { args };
	}
	if (adapter.promptVia === "arg") {
		args.push(prompt);
		return { args };
	}
	return { args, stdin: prompt };
};

const COMMON_BIN_DIRS = ["~/.local/bin", "~/.local/share/pnpm", "~/bin", "/usr/local/bin", "/usr/bin"];

/** Find the command, preferring an explicit path, then PATH, then the usual places. */
export const findCliBinary = (adapter: CliAdapter, override?: string): string | null => {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const fs = require("fs");
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const path = require("path");
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const os = require("os");
	const home = os.homedir();

	if (override) {
		const expanded = override.replace(/^~/, home);
		return fs.existsSync(expanded) ? expanded : null;
	}
	if (!adapter.binary) return null;

	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { execSync } = require("child_process");
		const found = execSync(`which ${adapter.binary}`, { encoding: "utf8", timeout: 3000 }).trim();
		if (found) return found;
	} catch {
		// Fall through to the well-known directories.
	}
	for (const dir of COMMON_BIN_DIRS) {
		const candidate = path.join(dir.replace(/^~/, home), adapter.binary);
		if (fs.existsSync(candidate)) return candidate;
	}
	return null;
};

/** Flatten the card chain into one prompt. CLI agents take a single prompt, not a message list. */
const flattenMessages = (messages: ModelMessage[]): string =>
	messages
		.map(message => {
			const content = typeof message.content === "string"
				? message.content
				: (message.content as any[]).map(part => (part.type === "text" ? part.text : "")).join("");
			return message.role === "system" ? content : `${message.role}: ${content}`;
		})
		.join("\n\n");

/**
 * Run a local agent CLI and adapt its output to the streaming callback contract.
 * Codex keeps its own runner because its event format is unlike the others.
 */
export const streamLocalCliResponse = async (
	provider: LLMProvider,
	messages: ModelMessage[],
	{ model, timeoutMs, onComplete, onReplaceText, onPhase, cwd, forkSession, fallbackMessages, abortSignal }: StreamOptions,
	cb: (chunk: string | null, final: any, tool: ToolEvent | null, reasoningDelta: any) => void
): Promise<void> => {
	if (abortSignal?.aborted) throw new DOMException("Generation stopped", "AbortError");
	if (!Platform.isDesktopApp) {
		throw new Error(`The ${provider.type} provider runs a local command, which only works in the desktop app.`);
	}

	const adapter = cliAdapterForProviderType(provider.type);
	if (!adapter) throw new Error(`No local CLI adapter for provider type "${provider.type}".`);

	const binary = findCliBinary(adapter, provider.binaryPath);
	if (!binary) throw new Error(`${adapter.providerType} not found. ${adapter.installHint}`);

	const extraArgs = provider.cliArgs?.trim() ? provider.cliArgs.trim().split(/\s+/) : undefined;
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const { spawn } = require("child_process");
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const os = require("os");
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const fs = require("fs");
	const workingDirectory = adapter.runsInCanvasFolder && cwd && fs.existsSync(cwd) ? cwd : os.tmpdir();

	/**
	 * One run of the command. When `mayRetry` is set and the command fails
	 * before it names a session, the run ends quietly as "retry" so the caller
	 * can start again; any other failure rejects as usual.
	 */
	const runOnce = (
		runMessages: ModelMessage[],
		runFork: string | undefined,
		mayRetry: boolean,
		startedFresh: boolean
	) => new Promise<"done" | "retry">((resolve, reject) => {
		const { args, stdin } = buildCliInvocation(adapter, { prompt: flattenMessages(runMessages), model, extraArgs, forkSession: runFork });
		logDebug(`[${adapter.providerType}] spawning`, { binary, args });
		const child = spawn(binary, args, { cwd: workingDirectory, stdio: ["pipe", "pipe", "pipe"] });
		const timeout = timeoutMs ?? 300_000;
		let streamedText = "";
		let stderrTail = "";
		let usage: CliUsage | undefined;
		let costUsd: number | undefined;
		let reportedModel: string | undefined;
		let sessionId: string | undefined;
		const parseLine = adapter.createParser?.() ?? adapter.parseLine;
		let buffer = "";
		let settled = false;

		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			settle(new Error(`${adapter.providerType} timed out after ${Math.round(timeout / 1000)}s`));
		}, timeout);

		const onAbort = () => {
			child.kill("SIGKILL");
			settle(new DOMException("Generation stopped", "AbortError"));
		};

		const settle = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			abortSignal?.removeEventListener("abort", onAbort);
			if (error) {
				onComplete?.({ inputTokens: 0, outputTokens: 0, totalText: streamedText, error: error.message });
				reject(error);
				return;
			}
			cb(null, { text: streamedText }, null, null);
			onComplete?.({
				inputTokens: usage?.inputTokens ?? 0,
				outputTokens: usage?.outputTokens ?? 0,
				cachedInputTokens: usage?.cachedInputTokens,
				totalText: streamedText,
				...(costUsd === undefined ? {} : { costUsd }),
				...(reportedModel ? { model: reportedModel } : {}),
				...(sessionId ? { sessionId } : {}),
				...(startedFresh ? { startedFreshSession: true } : {}),
			});
			resolve("done");
		};

		abortSignal?.addEventListener("abort", onAbort, { once: true });

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			if (settled) return;
			if (!parseLine) {
				streamedText += chunk;
				cb(chunk, null, null, null);
				return;
			}
			buffer += chunk;
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				const event = parseLine(line);
				if (!event) continue;
				if (event.error) {
					child.kill("SIGKILL");
					settle(new Error(event.error));
					return;
				}
				if (event.usage) usage = event.usage;
				if (event.cost !== undefined) costUsd = event.cost;
				if (event.model) reportedModel = event.model;
				if (event.session) sessionId = event.session;
				if (event.phase) onPhase?.(event.phase);
				if (event.textReplace !== undefined) {
					streamedText = event.textReplace;
					onReplaceText?.(event.textReplace);
				}
				if (event.reasoningDelta) cb(null, null, null, event.reasoningDelta);
				if (event.textDelta) {
					streamedText += event.textDelta;
					cb(event.textDelta, null, null, null);
				}
			}
		});

		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderrTail = `${stderrTail}${chunk}`.slice(-2000);
			logDebug(`[${adapter.providerType}] ${chunk.trim()}`);
		});

		child.on("error", (error: Error) => settle(new Error(`Could not run ${binary}: ${error.message}`)));
		child.on("close", (code: number | null) => {
			if (code === 0) return settle();
			if (mayRetry && !sessionId && !settled) {
				settled = true;
				clearTimeout(timer);
				abortSignal?.removeEventListener("abort", onAbort);
				logDebug(`[${adapter.providerType}] the session to fork is gone, starting a fresh one`, { stderr: stderrTail.trim() });
				resolve("retry");
				return;
			}
			const detail = stderrTail.trim() || streamedText.trim() || "no output";
			settle(new Error(`${adapter.providerType} exited with code ${code}: ${detail}`));
		});

		if (stdin !== undefined) {
			child.stdin.write(stdin);
			child.stdin.end();
		} else {
			child.stdin.end();
		}
	});

	const canRestart = !!forkSession && !!adapter.forkFlag && !!fallbackMessages;
	const outcome = await runOnce(messages, forkSession, canRestart, false);
	if (outcome === "retry") {
		if (abortSignal?.aborted) throw new DOMException("Generation stopped", "AbortError");
		await runOnce(await fallbackMessages!(), undefined, false, true);
	}
};
