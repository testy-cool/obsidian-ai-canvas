import { describe, it, expect, vi } from "vitest";

vi.mock("../src/utils/mcpClient", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/utils/mcpClient")>()),
	closeAllMCPClients: vi.fn(),
}));

import AugmentedCanvasPlugin from "../src/AugmentedCanvasPlugin";
import { closeAllMCPClients } from "../src/utils/mcpClient";

describe("plugin unload", () => {
	it("stops MCP servers it launched, so a reload does not leave them running", () => {
		AugmentedCanvasPlugin.prototype.onunload.call({ observabilityClient: null } as any);
		expect(closeAllMCPClients).toHaveBeenCalled();
	});
});
