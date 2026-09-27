import { describe, it, expect, beforeAll, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { Platform } from "obsidian";
import type { MCPServer } from "../src/settings/AugmentedCanvasSettings";
import {
	getMCPTools,
	clearMCPCache,
	closeAllMCPClients,
	splitJsonLines,
} from "../src/utils/mcpClient";

// A real MCP server over stdio: newline-delimited JSON-RPC, one tool, and a log
// of every method it was sent so the handshake can be asserted from outside.
const SERVER = `
const fs = require("fs");
const log = process.env.PROBE_LOG;
fs.appendFileSync(log, "boot\\n");
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
		fs.appendFileSync(log, "rpc:" + m.method + (m.params && m.params.protocolVersion ? ":" + m.params.protocolVersion : "") + "\\n");
		if (m.method === "initialize")
			send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "probe", version: "1" } } });
		else if (m.method === "tools/list")
			send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "echo_pid", description: "Return the server process id and the text given.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] } });
		else if (m.method === "tools/call")
			send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: process.pid + ":" + m.params.arguments.text }] } });
	}
});
`;

let serverPath = "";
let logPath = "";
let counter = 0;

const stdioServer = (): MCPServer => {
	logPath = path.join(os.tmpdir(), `mcp-stdio-probe-${Date.now()}-${counter}.log`);
	fs.writeFileSync(logPath, "");
	return {
		id: `stdio-probe-${counter++}`,
		name: "stdio probe",
		url: "",
		transport: "stdio",
		command: process.execPath,
		args: [serverPath],
		env: { PROBE_LOG: logPath },
		enabled: true,
	};
};

const logLines = () => fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);

beforeAll(() => {
	serverPath = path.join(os.tmpdir(), `mcp-stdio-server-${Date.now()}.cjs`);
	fs.writeFileSync(serverPath, SERVER);
});

afterEach(async () => {
	await closeAllMCPClients();
	Platform.isDesktopApp = true;
});

describe("MCP over stdio", () => {
	it("lists the tools a launched server advertises", async () => {
		const tools = await getMCPTools(stdioServer());
		expect(Object.keys(tools)).toEqual(["echo_pid"]);
	});

	it("calls a tool on the launched server and returns its text", async () => {
		const tools = await getMCPTools(stdioServer());
		const result = await tools.echo_pid.execute({ text: "hello" });
		expect(result).toMatch(/^\d+:hello$/);
	});

	it("completes the handshake with an initialized notification", async () => {
		await getMCPTools(stdioServer());
		expect(logLines()).toEqual(["boot", "rpc:initialize:2025-06-18", "rpc:notifications/initialized", "rpc:tools/list"]);
	});

	it("reuses one child process across requests", async () => {
		const server = stdioServer();
		const tools = await getMCPTools(server);
		const first = await tools.echo_pid.execute({ text: "a" });
		clearMCPCache(server.id);
		const again = await getMCPTools(server);
		const second = await again.echo_pid.execute({ text: "b" });
		expect(logLines().filter((l) => l === "boot")).toHaveLength(1);
		expect(first.split(":")[0]).toBe(second.split(":")[0]);
	});

	it("stops the child process when connections are closed", async () => {
		const tools = await getMCPTools(stdioServer());
		const pid = Number((await tools.echo_pid.execute({ text: "x" })).split(":")[0]);
		expect(() => process.kill(pid, 0)).not.toThrow();
		await closeAllMCPClients();
		await new Promise((r) => setTimeout(r, 300));
		expect(() => process.kill(pid, 0)).toThrow();
	});

	it("refuses to launch a server on mobile instead of failing obscurely", async () => {
		Platform.isDesktopApp = false;
		await expect(getMCPTools(stdioServer())).rejects.toThrow(/desktop/i);
	});
});

describe("stdio framing", () => {
	it("holds back a message that is split across chunks", () => {
		const first = splitJsonLines('{"id":1}\n{"id":2');
		expect(first.messages).toEqual(['{"id":1}']);
		const second = splitJsonLines(first.rest + '}\n');
		expect(second.messages).toEqual(['{"id":2}']);
		expect(second.rest).toBe("");
	});
});
