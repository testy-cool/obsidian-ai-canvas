import { Platform } from "obsidian";
import type { ModelMessage } from "@ai-sdk/provider-utils";
import type { LLMProvider } from "src/settings/AugmentedCanvasSettings";
import type { StreamOptions, ToolEvent } from "./ai";
import { logDebug } from "src/logDebug";

export const CODEX_DEFAULT_MODEL = "default";
export const CODEX_MODELS = [
	CODEX_DEFAULT_MODEL, // uses ~/.codex/config.toml
	"gpt-5.6-sol",
	"gpt-5.6-terra",
	"gpt-5.6-luna",
	"gpt-5.3-codex",
];

const COMMON_BIN_DIRS = [
	"~/.local/share/pnpm",
	"~/.local/bin",
	"~/.bun/bin",
	"/usr/local/bin",
	"/opt/homebrew/bin",
];

const expandHome = (p: string, home: string) => p.replace(/^~/, home);

/** Locate the codex binary. Returns an absolute path or null. */
export const findCodexBinary = (override?: string): string | null => {
	if (!Platform.isDesktopApp) return null;
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const fs = require("fs");
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const os = require("os");
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const path = require("path");
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const { execSync } = require("child_process");

	const home = os.homedir();
	const candidates: string[] = [];
	if (override?.trim()) candidates.push(expandHome(override.trim(), home));
	try {
		const which = execSync("which codex", { encoding: "utf8", timeout: 3000 }).trim();
		if (which) candidates.push(which);
	} catch {
		// not on PATH — Obsidian's Electron often gets a minimal PATH
	}
	for (const dir of COMMON_BIN_DIRS) {
		candidates.push(path.join(expandHome(dir, home), "codex"));
	}
	// nvm installs: ~/.nvm/versions/node/*/bin/codex
	try {
		const nvmBase = path.join(home, ".nvm", "versions", "node");
		for (const v of fs.readdirSync(nvmBase)) {
			candidates.push(path.join(nvmBase, v, "bin", "codex"));
		}
	} catch {
		// no nvm
	}
	for (const c of candidates) {
		try {
			fs.accessSync(c, fs.constants.X_OK);
			return c;
		} catch {
			// keep looking
		}
	}
	return null;
};

/**
 * Parse one JSONL event line from `codex exec --json`.
 *
 * Observed against codex-cli 0.144.0 (`codex exec --json --ephemeral
 * --skip-git-repo-check -s read-only -C /tmp '<prompt>'`):
 *   {"type":"thread.started","thread_id":"..."}
 *   {"type":"turn.started"}
 *   {"type":"item.completed","item":{"id":"item_0","type":"error","message":"Skill descriptions were shortened..."}}
 *   {"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"ping"}}
 *   {"type":"turn.completed","usage":{"input_tokens":24035,"cached_input_tokens":8960,"output_tokens":5,"reasoning_output_tokens":0}}
 *
 * On failure (e.g. invalid -m model id):
 *   {"type":"item.completed","item":{"id":"item_0","type":"error","message":"Model metadata for `x` not found..."}}
 *   {"type":"error","message":"{\"type\":\"error\",\"status\":400,\"error\":{...}}"}
 *   {"type":"turn.failed","error":{"message":"{...same as above...}"}}
 *
 * Important: `item.completed` events whose `item.type` is `"error"` are
 * *non-fatal informational notices* (skill-budget warnings, unknown-model
 * fallback warnings, etc.) — they appear even on fully successful runs and
 * must NOT abort the stream. Only a top-level `{"type":"error"}` or
 * `{"type":"turn.failed"}` event is fatal. No `item.delta` events were
 * observed in this version; that case is kept for forward compatibility.
 */
export const parseCodexEvent = (
	line: string
): { textDelta?: string; finalText?: string; error?: string } | null => {
	let event: any;
	try {
		event = JSON.parse(line);
	} catch {
		return null;
	}
	if (!event || typeof event !== "object") return null;

	// Fatal stream-level errors (invalid model, upstream 4xx/5xx, etc.)
	if (event.type === "error") {
		return { error: event.message ?? "Codex error" };
	}
	if (event.type === "turn.failed") {
		return { error: event.error?.message ?? "Codex turn failed" };
	}

	const itemType = event.item?.type ?? event.item?.item_type;
	if (itemType === "agent_message") {
		if (event.type === "item.completed" && typeof event.item?.text === "string") {
			return { finalText: event.item.text };
		}
		if (typeof event.delta === "string") {
			return { textDelta: event.delta };
		}
	}
	// Other item types (including item.completed "error" notices) are
	// informational only and intentionally ignored.
	return null;
};

export const buildCodexArgs = (opts: {
	model?: string;
	reasoningEffort?: string;
}): string[] => {
	const args = [
		"exec",
		"--json",
		"--ephemeral",
		"--skip-git-repo-check",
		"-s",
		"read-only",
	];
	if (opts.model && opts.model !== CODEX_DEFAULT_MODEL) {
		args.push("-m", opts.model);
	}
	if (opts.reasoningEffort) {
		args.push("-c", `model_reasoning_effort="${opts.reasoningEffort}"`);
	}
	return args;
};

/** Flatten chat messages into a single prompt (codex exec takes one prompt via stdin). */
const flattenMessages = (messages: ModelMessage[]): string =>
	messages
		.map((m) => {
			const content =
				typeof m.content === "string"
					? m.content
					: m.content
							.map((part: any) => (part.type === "text" ? part.text : ""))
							.join("");
			return m.role === "system" ? content : `${m.role}: ${content}`;
		})
		.join("\n\n");

/** Run codex exec and adapt its JSONL output to the streamResponse callback contract. */
export const streamCodexResponse = async (
	provider: LLMProvider,
	messages: ModelMessage[],
	{ model, providerParams, timeoutMs, onComplete }: StreamOptions,
	cb: (chunk: string | null, final: any, tool: ToolEvent | null, reasoningDelta: any) => void
): Promise<void> => {
	if (!Platform.isDesktopApp) {
		throw new Error("The Codex provider only works in the desktop app.");
	}
	const binary = findCodexBinary(provider.binaryPath);
	if (!binary) {
		throw new Error(
			"Codex CLI not found. Install it (npm i -g @openai/codex) or set the binary path in the provider settings."
		);
	}
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const { spawn } = require("child_process");
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const os = require("os");

	const args = buildCodexArgs({
		model,
		reasoningEffort: providerParams?.reasoningEffort as string | undefined,
	});
	const prompt = flattenMessages(messages);
	logDebug("[Codex] spawning", { binary, args });

	return new Promise<void>((resolve, reject) => {
		const child = spawn(binary, args, { cwd: os.tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
		const timeout = timeoutMs ?? 300_000;
		let finalText = "";
		let streamedText = "";
		let stderrTail = "";
		let settled = false;

		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			settle(new Error(`Codex timed out after ${Math.round(timeout / 1000)}s`));
		}, timeout);

		const settle = (err?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (err) {
				onComplete?.({ inputTokens: 0, outputTokens: 0, totalText: "", error: err.message });
				reject(err);
				return;
			}
			const text = finalText || streamedText;
			// Emit any final text not already streamed, then the final marker.
			if (finalText && !streamedText) cb(finalText, null, null, null);
			cb(null, { text }, null, null);
			onComplete?.({ inputTokens: 0, outputTokens: 0, totalText: text });
			resolve();
		};

		let buffer = "";
		child.stdout.on("data", (chunk: Buffer) => {
			buffer += chunk.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				const parsed = parseCodexEvent(line);
				if (!parsed) continue;
				if (parsed.error) {
					settle(new Error(parsed.error));
					return;
				}
				if (parsed.textDelta) {
					streamedText += parsed.textDelta;
					cb(parsed.textDelta, null, null, null);
				}
				if (parsed.finalText) {
					finalText = parsed.finalText;
				}
			}
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderrTail = (stderrTail + chunk.toString()).slice(-500);
		});
		child.on("error", (err: Error) => settle(new Error(`Failed to run codex: ${err.message}`)));
		child.on("close", (code: number) => {
			if (code !== 0 && !finalText && !streamedText) {
				settle(new Error(`codex exited with code ${code}: ${stderrTail.trim()}`));
			} else {
				settle();
			}
		});
		// The child may exit (or its stdin pipe may close) before we finish
		// writing — e.g. it crashes on startup. Without an 'error' listener,
		// Node treats that as an uncaught exception and would crash Obsidian's
		// renderer. child.on("close"/"error") above already settle() the
		// promise with a useful message, so this handler only needs to
		// swallow the EPIPE/ECONNRESET noise, not react further.
		child.stdin.on("error", (err: Error) => {
			logDebug("[Codex] stdin write error (likely closed early)", err?.message);
		});
		try {
			child.stdin.write(prompt);
			child.stdin.end();
		} catch (err: any) {
			logDebug("[Codex] stdin write threw synchronously", err?.message);
		}
	});
};
