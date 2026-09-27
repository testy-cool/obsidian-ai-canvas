import { MCPServer } from "../settings/AugmentedCanvasSettings";
import { listMCPPrompts, listMCPResources, MCPPromptRef, MCPResourceRef } from "./mcpClient";

export type McpContent = {
	resources: MCPResourceRef[];
	prompts: MCPPromptRef[];
	/** One line per server that could not be reached, for showing in the picker. */
	errors: string[];
};

/**
 * Everything the enabled servers offer besides tools. One unreachable server
 * must not hide what the others have, so its failure is collected, not thrown.
 */
export const gatherMcpContent = async (servers: MCPServer[]): Promise<McpContent> => {
	const content: McpContent = { resources: [], prompts: [], errors: [] };

	for (const server of servers.filter(candidate => candidate.enabled)) {
		try {
			content.resources.push(...(await listMCPResources(server)));
			content.prompts.push(...(await listMCPPrompts(server)));
		} catch (error) {
			content.errors.push(`${server.name}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	return content;
};
