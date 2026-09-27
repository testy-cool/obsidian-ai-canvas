import { describe, it, expect, vi } from "vitest";

vi.mock("../src/utils/mcpClient", () => ({
	listMCPResources: vi.fn(),
	listMCPPrompts: vi.fn(),
}));

import { gatherMcpContent } from "../src/utils/mcpContent";
import { listMCPResources, listMCPPrompts } from "../src/utils/mcpClient";

const servers = [
	{ id: "notes", name: "notes", url: "", transport: "stdio" as const, enabled: true },
	{ id: "broken", name: "broken", url: "", transport: "stdio" as const, enabled: true },
	{ id: "off", name: "off", url: "", transport: "stdio" as const, enabled: false },
];

describe("gatherMcpContent", () => {
	it("merges what every enabled server offers and skips disabled ones", async () => {
		vi.mocked(listMCPResources).mockImplementation(async (server: any) =>
			server.id === "notes" ? [{ uri: "note://a", name: "A", serverId: "notes", serverName: "notes" }] as any : []);
		vi.mocked(listMCPPrompts).mockImplementation(async (server: any) =>
			server.id === "notes" ? [{ name: "summarise", serverId: "notes", serverName: "notes" }] as any : []);

		const content = await gatherMcpContent(servers as any);
		expect(content.resources.map(r => r.uri)).toEqual(["note://a"]);
		expect(content.prompts.map(p => p.name)).toEqual(["summarise"]);
		expect(vi.mocked(listMCPResources).mock.calls.map(([s]: any) => s.id)).toEqual(["notes", "broken"]);
	});

	it("keeps one unreachable server from hiding the others", async () => {
		vi.mocked(listMCPResources).mockImplementation(async (server: any) => {
			if (server.id === "broken") throw new Error("connection refused");
			return [{ uri: "note://a", name: "A", serverId: "notes", serverName: "notes" }] as any;
		});
		vi.mocked(listMCPPrompts).mockResolvedValue([]);

		const content = await gatherMcpContent(servers as any);
		expect(content.resources.map(r => r.uri)).toEqual(["note://a"]);
		expect(content.errors).toEqual(["broken: connection refused"]);
	});
});
