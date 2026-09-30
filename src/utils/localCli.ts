import { Platform } from "obsidian";
import { ModelMessage } from "@ai-sdk/provider-utils";
import { LLMProvider } from "../settings/AugmentedCanvasSettings";
import { logDebug } from "../logDebug";
import type { StreamOptions, ToolEvent } from "./ai";

/** Model id meaning "whatever the CLI is already configured for". */
export const CLI_DEFAULT_MODEL = "default";

export type CliUsage = { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
export type CliEvent = { textDelta?: string; reasoningDelta?: string; usage?: CliUsage; error?: string } | null;

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
		baseArgs: ["-p", "--mode", "text"],
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
	{ prompt, model, extraArgs }: { prompt: string; model?: string; extraArgs?: string[] }
): CliInvocation => {
	const args = [...adapter.baseArgs];
	if (model && model !== CLI_DEFAULT_MODEL && adapter.modelFlag) args.push(adapter.modelFlag, model);
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
	{ model, timeoutMs, onComplete, abortSignal }: StreamOptions,
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
	const { args, stdin } = buildCliInvocation(adapter, { prompt: flattenMessages(messages), model, extraArgs });
	logDebug(`[${adapter.providerType}] spawning`, { binary, args });

	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const { spawn } = require("child_process");
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const os = require("os");

	return new Promise<void>((resolve, reject) => {
		const child = spawn(binary, args, { cwd: os.tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
		const timeout = timeoutMs ?? 300_000;
		let streamedText = "";
		let stderrTail = "";
		let usage: CliUsage | undefined;
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
			});
			resolve();
		};

		abortSignal?.addEventListener("abort", onAbort, { once: true });

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			if (settled) return;
			if (!adapter.parseLine) {
				streamedText += chunk;
				cb(chunk, null, null, null);
				return;
			}
			buffer += chunk;
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				const event = adapter.parseLine(line);
				if (!event) continue;
				if (event.error) {
					child.kill("SIGKILL");
					settle(new Error(event.error));
					return;
				}
				if (event.usage) usage = event.usage;
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
};
