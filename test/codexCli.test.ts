import { describe, it, expect } from "vitest";
import { parseCodexEvent, buildCodexArgs } from "../src/utils/codexCli";

// Fixtures below are copied verbatim (modulo JSON.stringify formatting) from
// real `codex exec --json --ephemeral --skip-git-repo-check -s read-only -C /tmp
// 'Reply with exactly: ping'` runs against codex-cli 0.144.0. Unlike the
// baseline assumed in the design brief, this version of the CLI never emits
// incremental `item.delta` events for agent_message — only `item.completed`.
// It also emits `item.completed` events with `item.type === "error"` as
// *non-fatal* informational notices (e.g. skill-budget warnings, unknown
// model metadata) that do not end the turn — only a top-level
// `{"type":"error"}` or `{"type":"turn.failed"}` event is fatal.
describe("parseCodexEvent", () => {
	it("extracts final agent message from a real item.completed event", () => {
		const line = JSON.stringify({
			type: "item.completed",
			item: { id: "item_1", type: "agent_message", text: "ping" },
		});
		expect(parseCodexEvent(line)).toEqual({ finalText: "ping" });
	});

	it("extracts deltas when present (forward-compat; not observed in 0.144.0)", () => {
		const line = JSON.stringify({
			type: "item.delta",
			item: { type: "agent_message" },
			delta: "he",
		});
		expect(parseCodexEvent(line)?.textDelta).toBe("he");
	});

	it("ignores non-fatal item-level error notices (skill budget warning)", () => {
		// Real line observed on every run in this environment — must NOT be
		// treated as fatal or every Codex call would fail.
		const line = JSON.stringify({
			type: "item.completed",
			item: {
				id: "item_0",
				type: "error",
				message:
					"Skill descriptions were shortened to fit the 2% skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.",
			},
		});
		expect(parseCodexEvent(line)).toBeNull();
	});

	it("ignores non-fatal item-level error notices (unknown model metadata)", () => {
		const line = JSON.stringify({
			type: "item.completed",
			item: {
				id: "item_0",
				type: "error",
				message:
					"Model metadata for `totally-not-a-real-model-xyz` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.",
			},
		});
		expect(parseCodexEvent(line)).toBeNull();
	});

	it("surfaces fatal top-level error events", () => {
		// Real line observed when passing an invalid -m model id.
		const line = JSON.stringify({
			type: "error",
			message:
				'{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'totally-not-a-real-model-xyz\' model is not supported when using Codex with a ChatGPT account."}}',
		});
		const result = parseCodexEvent(line);
		expect(result?.error).toContain("invalid_request_error");
	});

	it("surfaces fatal turn.failed events as a fallback", () => {
		// Real line observed immediately after the top-level error event above.
		const line = JSON.stringify({
			type: "turn.failed",
			error: { message: "boom" },
		});
		expect(parseCodexEvent(line)).toEqual({ error: "boom" });
	});

	it("ignores unrelated lifecycle events and junk", () => {
		expect(parseCodexEvent(JSON.stringify({ type: "thread.started", thread_id: "abc" }))).toBeNull();
		expect(parseCodexEvent(JSON.stringify({ type: "turn.started" }))).toBeNull();
		expect(
			parseCodexEvent(
				JSON.stringify({
					type: "turn.completed",
					usage: { input_tokens: 24035, cached_input_tokens: 8960, output_tokens: 5, reasoning_output_tokens: 0 },
				})
			)
		).toBeNull();
		expect(parseCodexEvent("not json")).toBeNull();
	});
});

describe("buildCodexArgs", () => {
	it("always runs sandboxed, ephemeral, json", () => {
		const args = buildCodexArgs({});
		expect(args).toContain("exec");
		expect(args).toContain("--json");
		expect(args).toContain("--ephemeral");
		expect(args).toContain("--skip-git-repo-check");
		expect(args.join(" ")).toContain("-s read-only");
	});

	it("passes model and reasoning effort", () => {
		const args = buildCodexArgs({ model: "gpt-5.6-terra", reasoningEffort: "high" });
		expect(args.join(" ")).toContain("-m gpt-5.6-terra");
		expect(args.join(" ")).toContain('-c model_reasoning_effort="high"');
	});

	it("omits -m for the default model sentinel", () => {
		expect(buildCodexArgs({ model: "default" }).join(" ")).not.toContain("-m");
	});
});
