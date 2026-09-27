/**
 * One opt-in run against the real thing: a local MCP server over stdio, a real
 * generation through the vault's configured provider, the cost of that run, and
 * the trace it leaves. Skipped unless LIVE=1, because it spends tokens.
 *
 *   LIVE=1 pnpm exec vitest run test/live.test.ts
 */
import { describe, it, expect, vi } from "vitest";
import { LIVE, vaultDataExists, readVaultData, vaultProvider, findLangfuseTrace, writeStdioMcpServer } from "./helpers/live";

vi.mock("obsidian", async (importOriginal) => ({
	...(await importOriginal<any>()),
	requestUrl: (await import("./helpers/live")).realRequestUrl,
}));

const MCP_SERVER = `
const send = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
let buf = "";
process.stdin.on("data", (d) => { buf += d; let i;
	while ((i = buf.indexOf("\\n")) >= 0) {
		const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
		if (!line) continue;
		const m = JSON.parse(line);
		if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "live", version: "1" } } });
		else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "vault_size", description: "Return the number of notes in the vault.", inputSchema: { type: "object", properties: {} } }] } });
		else if (m.method === "tools/call") send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "1743" }] } });
	}
});
`;

describe.skipIf(!LIVE || !vaultDataExists())("live: the whole generation path", () => {
	it("calls a local MCP tool, costs the run and traces it", async () => {
		const marker = `live-${Date.now()}`;
		const provider = vaultProvider("openai");
		const model = "vertex/gemini-3.1-flash-lite";

		const { getAllMCPTools, closeAllMCPClients } = await import("../src/utils/mcpClient");
		const { streamResponse } = await import("../src/utils/llm");
		const { configureLLMObservability } = await import("../src/utils/llmObservability");
		const { ObservabilityClient } = await import("../src/utils/observability");
		const { costForModel, formatCost } = await import("../src/utils/cost");

		const prices = { inputCostPerMillion: 0.1, outputCostPerMillion: 0.4, cachedInputCostPerMillion: 0.025 };
		const client = new ObservabilityClient(readVaultData().observability);
		configureLLMObservability(client, () => ({ pluginVersion: marker, vaultName: "live-test", canvasName: "live", ...prices }));

		const tools = await getAllMCPTools([{
			id: "live", name: "live", url: "", transport: "stdio",
			command: process.execPath, args: [writeStdioMcpServer(MCP_SERVER)], enabled: true,
		} as any]);
		expect(Object.keys(tools)).toContain("live__vault_size");

		let text = "";
		const toolEvents: string[] = [];
		let usage: any;
		await streamResponse(
			provider,
			[{ role: "user", content: "Call the live__vault_size tool and reply with only the number it returns." }] as any,
			{ model, tools, max_tokens: 200, temperature: 0, onComplete: result => { usage = result; } },
			(chunk, _final, tool) => { if (chunk) text += chunk; if (tool?.type) toolEvents.push(tool.type); },
		);

		const cost = costForModel([{ providerId: provider.id, model, ...prices }] as any, provider.id, model, usage);
		console.log("live run:", JSON.stringify({ text: text.trim(), toolEvents, usage, badge: cost != null ? formatCost(cost) : "no cost" }));

		expect(text).toContain("1743");
		expect(toolEvents).toContain("tool-call");
		expect(cost).toBeGreaterThan(0);

		await client.shutdown();
		expect(client.lastError, "trace export").toBeNull();
		await closeAllMCPClients();

		const trace = await findLangfuseTrace(marker);
		expect(trace, "a Langfuse trace for this run").toBeTruthy();
	}, 240000);
});
