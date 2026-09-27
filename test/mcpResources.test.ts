import { describe, it, expect, beforeAll, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { MCPServer } from "../src/settings/AugmentedCanvasSettings";
import {
	listMCPResources,
	readMCPResource,
	listMCPPrompts,
	getMCPPrompt,
	closeAllMCPClients,
} from "../src/utils/mcpClient";

const SERVER = (capabilities: string) => `
const send = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
let buf = "";
process.stdin.on("data", (d) => {
	buf += d;
	let i;
	while ((i = buf.indexOf("\\n")) >= 0) {
		const line = buf.slice(0, i).trim();
		buf = buf.slice(i + 1);
		if (!line) continue;
		const m = JSON.parse(line);
		if (m.method === "initialize")
			send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2024-11-05", capabilities: ${capabilities}, serverInfo: { name: "probe", version: "1" } } });
		else if (m.method === "resources/list")
			send({ jsonrpc: "2.0", id: m.id, result: { resources: [{ uri: "note://daily", name: "Daily note", mimeType: "text/markdown" }] } });
		else if (m.method === "resources/read")
			send({ jsonrpc: "2.0", id: m.id, result: { contents: [{ uri: m.params.uri, mimeType: "text/markdown", text: "# Monday\\n\\nship the thing" }] } });
		else if (m.method === "prompts/list")
			send({ jsonrpc: "2.0", id: m.id, result: { prompts: [{ name: "summarise", description: "Summarise a note", arguments: [{ name: "style", required: false }] }] } });
		else if (m.method === "prompts/get")
			send({ jsonrpc: "2.0", id: m.id, result: { messages: [{ role: "user", content: { type: "text", text: "Summarise in " + (m.params.arguments?.style ?? "prose") } }] } });
		else if (m.method === "tools/list")
			send({ jsonrpc: "2.0", id: m.id, result: { tools: [] } });
	}
});
`;

let full = "";
let toolsOnly = "";
let counter = 0;

const server = (script: string): MCPServer => ({
	id: `probe-${counter++}`, name: "probe", url: "", transport: "stdio",
	command: process.execPath, args: [script], enabled: true,
});

beforeAll(() => {
	full = path.join(os.tmpdir(), `mcp-res-${Date.now()}.cjs`);
	toolsOnly = path.join(os.tmpdir(), `mcp-tools-${Date.now()}.cjs`);
	fs.writeFileSync(full, SERVER('{ tools: {}, resources: {}, prompts: {} }'));
	fs.writeFileSync(toolsOnly, SERVER('{ tools: {} }'));
});

afterEach(async () => { await closeAllMCPClients(); });

describe("MCP resources", () => {
	it("lists what a server offers", async () => {
		expect(await listMCPResources(server(full))).toEqual([
			{ uri: "note://daily", name: "Daily note", mimeType: "text/markdown", description: undefined, serverId: expect.any(String), serverName: "probe" },
		]);
	});

	it("reads a resource as text a card can hold", async () => {
		expect(await readMCPResource(server(full), "note://daily")).toBe("# Monday\n\nship the thing");
	});

	it("returns nothing for a server that does not offer resources, without calling it", async () => {
		expect(await listMCPResources(server(toolsOnly))).toEqual([]);
	});
});

describe("MCP prompts", () => {
	it("lists the prompts a server offers", async () => {
		const prompts = await listMCPPrompts(server(full));
		expect(prompts).toEqual([
			{ name: "summarise", description: "Summarise a note", arguments: [{ name: "style", required: false }], serverId: expect.any(String), serverName: "probe" },
		]);
	});

	it("fills a prompt in and returns its text", async () => {
		expect(await getMCPPrompt(server(full), "summarise", { style: "bullets" })).toBe("Summarise in bullets");
	});

	it("returns nothing for a server that does not offer prompts", async () => {
		expect(await listMCPPrompts(server(toolsOnly))).toEqual([]);
	});
});
