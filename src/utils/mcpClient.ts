import { requestUrl } from 'obsidian';
import { MCPServer } from '../settings/AugmentedCanvasSettings';
import { logDebug } from '../logDebug';
import { jsonSchema, tool as createTool } from 'ai';

// Cache of tools per server
const toolsCache = new Map<string, any>();

// Session IDs for servers (for Streamable HTTP)
const sessionIds = new Map<string, string>();

/**
 * Make an MCP JSON-RPC request using Obsidian's requestUrl (bypasses CORS)
 */
const mcpRequest = async (server: MCPServer, method: string, params: any = {}, id: number = 1) => {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'Accept': 'application/json, text/event-stream',
		...server.headers,
	};
	if (server.apiKey) {
		headers['Authorization'] = `Bearer ${server.apiKey}`;
	}

	// Add session ID if we have one
	const sessionId = sessionIds.get(server.id);
	if (sessionId) {
		headers['Mcp-Session-Id'] = sessionId;
	}

	const body = JSON.stringify({
		jsonrpc: '2.0',
		id,
		method,
		params,
	});

	const response = await requestUrl({
		url: server.url,
		method: 'POST',
		headers,
		body,
	});

	// Store session ID from response if present
	const newSessionId = response.headers['mcp-session-id'];
	if (newSessionId) {
		sessionIds.set(server.id, newSessionId);
	}

	// Parse SSE or JSON response
	const text = response.text;
	if (text.startsWith('data: ')) {
		// SSE format - extract JSON from data line
		const jsonStr = text.replace(/^data: /, '').trim();
		return JSON.parse(jsonStr);
	}
	return JSON.parse(text);
};

/**
 * Initialize MCP session with server
 */
const initializeSession = async (server: MCPServer) => {
	const response = await mcpRequest(server, 'initialize', {
		protocolVersion: '2024-11-05',
		capabilities: {},
		clientInfo: { name: 'obsidian-ai-canvas', version: '1.0' },
	});
	return response.result;
};

/**
 * Fetch and convert MCP tools to AI SDK format
 */
const fetchMCPTools = async (server: MCPServer): Promise<Record<string, any>> => {
	// Initialize session first
	await initializeSession(server);

	// List tools
	const response = await mcpRequest(server, 'tools/list', {}, 2);
	const mcpTools = response.result?.tools || [];

	// Convert to AI SDK tools using jsonSchema
	const tools: Record<string, any> = {};
	for (const mcpTool of mcpTools) {
		const toolName = mcpTool.name;
		const inputSchema = mcpTool.inputSchema || { type: 'object', properties: {} };

		tools[toolName] = createTool({
			description: mcpTool.description || mcpTool.title || toolName,
			inputSchema: jsonSchema(inputSchema),
			execute: async (args: Record<string, unknown>) => {
				const result = await mcpRequest(server, 'tools/call', {
					name: toolName,
					arguments: args,
				}, Date.now());
				return result.result?.content?.[0]?.text || JSON.stringify(result.result);
			},
		});
	}

	return tools;
};

/**
 * Get tools from an MCP server (cached)
 */
export const getMCPTools = async (server: MCPServer): Promise<Record<string, any>> => {
	const cached = toolsCache.get(server.id);
	if (cached) {
		return cached;
	}

	const tools = await fetchMCPTools(server);
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
			logDebug(`Failed to get tools from MCP server ${server.name}: ${error}`);
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
		clearMCPCache(server.id);

		const tools = await fetchMCPTools(server);
		const toolCount = Object.keys(tools).length;

		// Update tools cache
		toolsCache.set(server.id, tools);

		return { success: true, toolCount };
	} catch (error: any) {
		return { success: false, error: error.message || String(error) };
	}
};

/**
 * Clear MCP cache for a server
 */
export const clearMCPCache = (serverId: string): void => {
	toolsCache.delete(serverId);
	sessionIds.delete(serverId);
};

/**
 * Close all MCP client connections (clear caches)
 */
export const closeAllMCPClients = async (): Promise<void> => {
	toolsCache.clear();
	sessionIds.clear();
};

/**
 * Refresh tools cache for a server
 */
export const refreshMCPTools = async (server: MCPServer): Promise<void> => {
	clearMCPCache(server.id);
	await getMCPTools(server);
};
