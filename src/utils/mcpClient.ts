import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp';
import { MCPServer } from '../settings/AugmentedCanvasSettings';
import { logDebug } from '../logDebug';

type MCPClientInstance = Awaited<ReturnType<typeof createMCPClient>>;

// Cache of active MCP clients
const clientCache = new Map<string, MCPClientInstance>();

// Cache of tools per server
const toolsCache = new Map<string, any>();

/**
 * Create transport config based on server settings
 */
const getTransportConfig = (server: MCPServer) => {
	const headers: Record<string, string> = { ...server.headers };
	if (server.apiKey) {
		headers['Authorization'] = `Bearer ${server.apiKey}`;
	}

	switch (server.transport) {
		case 'http':
			return {
				type: 'http' as const,
				url: server.url,
				headers,
			};
		case 'sse':
			return {
				type: 'sse' as const,
				url: server.url,
				headers,
			};
		default:
			return {
				type: 'http' as const,
				url: server.url,
				headers,
			};
	}
};

/**
 * Get or create an MCP client for a server
 */
export const getMCPClient = async (server: MCPServer): Promise<MCPClientInstance> => {
	const cached = clientCache.get(server.id);
	if (cached) {
		return cached;
	}

	logDebug('Creating MCP client for server:', server.name);

	const client = await createMCPClient({
		transport: getTransportConfig(server),
	});

	clientCache.set(server.id, client);
	return client;
};

/**
 * Get tools from an MCP server (cached)
 */
export const getMCPTools = async (server: MCPServer): Promise<any> => {
	const cached = toolsCache.get(server.id);
	if (cached) {
		return cached;
	}

	const client = await getMCPClient(server);
	const tools = await client.tools();

	toolsCache.set(server.id, tools);
	return tools;
};

/**
 * Get combined tools from all enabled MCP servers
 */
export const getAllMCPTools = async (servers: MCPServer[]): Promise<Record<string, any>> => {
	const enabledServers = servers.filter(s => s.enabled);
	if (!enabledServers.length) {
		return {};
	}

	const allTools: Record<string, any> = {};

	for (const server of enabledServers) {
		try {
			const tools = await getMCPTools(server);
			// Namespace tools by server id to avoid conflicts
			for (const [toolName, tool] of Object.entries(tools)) {
				const namespacedName = `${server.id}__${toolName}`;
				allTools[namespacedName] = tool;
			}
		} catch (error) {
			logDebug(`Failed to get tools from MCP server ${server.name}:`, error);
		}
	}

	return allTools;
};

/**
 * Test connection to an MCP server and return tool count
 */
export const testMCPServer = async (server: MCPServer): Promise<{ success: boolean; toolCount?: number; error?: string }> => {
	try {
		// Clear cache to force fresh connection
		await closeMCPClient(server.id);

		const client = await getMCPClient(server);
		const tools = await client.tools();
		const toolCount = Object.keys(tools).length;

		// Update tools cache
		toolsCache.set(server.id, tools);

		return { success: true, toolCount };
	} catch (error: any) {
		return { success: false, error: error.message || String(error) };
	}
};

/**
 * Close an MCP client connection
 */
export const closeMCPClient = async (serverId: string): Promise<void> => {
	const client = clientCache.get(serverId);
	if (client) {
		try {
			await client.close();
		} catch (error) {
			logDebug('Error closing MCP client:', error);
		}
		clientCache.delete(serverId);
		toolsCache.delete(serverId);
	}
};

/**
 * Close all MCP client connections
 */
export const closeAllMCPClients = async (): Promise<void> => {
	for (const [serverId] of clientCache) {
		await closeMCPClient(serverId);
	}
};

/**
 * Refresh tools cache for a server
 */
export const refreshMCPTools = async (server: MCPServer): Promise<void> => {
	toolsCache.delete(server.id);
	await getMCPTools(server);
};
