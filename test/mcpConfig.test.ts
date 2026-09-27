import { describe, it, expect } from "vitest";
import { parseMCPServersConfig, buildManualMCPServer, serializeMCPServers } from "../src/utils/mcpConfig";

describe("parseMCPServersConfig", () => {
	it("imports a local server that is launched by a command", () => {
		const result = parseMCPServersConfig(JSON.stringify({
			mcpServers: {
				filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/me/notes"] },
			},
		}));
		expect(result).toEqual({
			servers: [{
				id: "filesystem",
				name: "filesystem",
				url: "",
				transport: "stdio",
				command: "npx",
				args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/me/notes"],
				enabled: true,
			}],
		});
	});

	it("keeps the environment a local server needs", () => {
		const result = parseMCPServersConfig(JSON.stringify({
			mcpServers: { gh: { command: "gh-mcp", env: { GITHUB_TOKEN: "abc" } } },
		}));
		expect("servers" in result && result.servers[0].env).toEqual({ GITHUB_TOKEN: "abc" });
	});

	it("still imports a remote server and lifts its bearer token out of the headers", () => {
		const result = parseMCPServersConfig(JSON.stringify({
			mcpServers: {
				remote: { url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer secret", "X-Trace": "1" } },
			},
		}));
		expect("servers" in result && result.servers[0]).toEqual({
			id: "remote",
			name: "remote",
			url: "https://mcp.example.com/mcp",
			transport: "http",
			apiKey: "secret",
			headers: { "X-Trace": "1" },
			enabled: true,
		});
	});

	it("names the server that has neither a url nor a command", () => {
		const result = parseMCPServersConfig(JSON.stringify({ mcpServers: { broken: { type: "http" } } }));
		expect(result).toEqual({ error: 'Server "broken" needs either a url or a command.' });
	});

	it("explains unusable input instead of throwing", () => {
		expect(parseMCPServersConfig("not json")).toHaveProperty("error");
		expect(parseMCPServersConfig(JSON.stringify({ mcpServers: [] }))).toEqual({
			error: "Expected { mcpServers: { ... } } format",
		});
	});
});

describe("buildManualMCPServer", () => {
	it("requires a command for a local server, not a url", () => {
		expect(buildManualMCPServer({ id: "local", name: "Local", transport: "stdio", url: "", command: "" }))
			.toEqual({ error: "ID, Name, and Command are required" });
		expect(buildManualMCPServer({ id: "local", name: "Local", transport: "stdio", url: "", command: "my-mcp --flag x" }))
			.toEqual({ server: { id: "local", name: "Local", url: "", transport: "stdio", command: "my-mcp", args: ["--flag", "x"], apiKey: undefined, enabled: true, toolCount: undefined } });
	});

	it("requires a url for a remote server", () => {
		expect(buildManualMCPServer({ id: "r", name: "R", transport: "http", url: "", command: "" }))
			.toEqual({ error: "ID, Name, and URL are required" });
	});
});

describe("serializeMCPServers", () => {
	it("writes a local server back as a command, not an empty url", () => {
		const config = serializeMCPServers([{
			id: "fs", name: "fs", url: "", transport: "stdio",
			command: "npx", args: ["-y", "server-filesystem"], env: { ROOT: "/notes" }, enabled: true,
		}]);
		expect(config).toEqual({ mcpServers: { fs: { command: "npx", args: ["-y", "server-filesystem"], env: { ROOT: "/notes" } } } });
	});

	it("survives a round trip through the parser", () => {
		const servers = [
			{ id: "fs", name: "fs", url: "", transport: "stdio" as const, command: "npx", args: ["-y", "x"], enabled: true },
			{ id: "remote", name: "remote", url: "https://mcp.example.com/mcp", transport: "http" as const, apiKey: "secret", enabled: true },
		];
		const back = parseMCPServersConfig(JSON.stringify(serializeMCPServers(servers)));
		expect("servers" in back && back.servers).toEqual(servers);
	});
});

describe("editing a local server", () => {
	it("keeps the environment and working directory the form cannot show", () => {
		const existing = {
			id: "fs", name: "fs", url: "", transport: "stdio" as const,
			command: "npx", args: ["old"], env: { ROOT: "/notes" }, cwd: "/tmp", enabled: true,
		};
		const built = buildManualMCPServer({ id: "fs", name: "fs renamed", transport: "stdio", url: "", command: "npx new", existing });
		expect("server" in built && built.server.env).toEqual({ ROOT: "/notes" });
		expect("server" in built && built.server.cwd).toBe("/tmp");
		expect("server" in built && built.server.args).toEqual(["new"]);
	});
});
