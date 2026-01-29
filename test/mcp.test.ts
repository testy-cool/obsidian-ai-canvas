import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPServer, MCPTransportType } from '../src/settings/AugmentedCanvasSettings';

// Mock the @ai-sdk/mcp module
vi.mock('@ai-sdk/mcp', () => ({
	experimental_createMCPClient: vi.fn(),
}));

import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp';
import {
	getMCPClient,
	getMCPTools,
	getAllMCPTools,
	testMCPServer,
	closeMCPClient,
	closeAllMCPClients,
} from '../src/utils/mcpClient';

const mockCreateMCPClient = vi.mocked(createMCPClient);

describe('MCP Client Utilities', () => {
	const mockServer: MCPServer = {
		id: 'test-server',
		name: 'Test Server',
		url: 'https://mcp.example.com/mcp',
		transport: 'http',
		enabled: true,
	};

	const mockTools = {
		search: { description: 'Search the web', parameters: {} },
		read_file: { description: 'Read a file', parameters: {} },
	};

	let mockClient: {
		tools: ReturnType<typeof vi.fn>;
		close: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockClient = {
			tools: vi.fn().mockResolvedValue(mockTools),
			close: vi.fn().mockResolvedValue(undefined),
		};
		mockCreateMCPClient.mockResolvedValue(mockClient as any);
	});

	afterEach(async () => {
		await closeAllMCPClients();
	});

	describe('MCPServer interface', () => {
		it('accepts valid server configuration', () => {
			const server: MCPServer = {
				id: 'my-server',
				name: 'My Server',
				url: 'https://example.com/mcp',
				transport: 'http',
				enabled: true,
			};
			expect(server.id).toBe('my-server');
			expect(server.transport).toBe('http');
		});

		it('accepts optional fields', () => {
			const server: MCPServer = {
				id: 'auth-server',
				name: 'Auth Server',
				url: 'https://example.com/mcp',
				transport: 'sse',
				apiKey: 'secret-key',
				headers: { 'X-Custom': 'value' },
				enabled: false,
				toolCount: 5,
			};
			expect(server.apiKey).toBe('secret-key');
			expect(server.headers).toEqual({ 'X-Custom': 'value' });
			expect(server.toolCount).toBe(5);
		});

		it('supports all transport types', () => {
			const transports: MCPTransportType[] = ['http', 'sse', 'websocket'];
			transports.forEach(transport => {
				const server: MCPServer = {
					id: `${transport}-server`,
					name: `${transport} Server`,
					url: 'https://example.com/mcp',
					transport,
					enabled: true,
				};
				expect(server.transport).toBe(transport);
			});
		});
	});

	describe('getMCPClient', () => {
		it('creates a new client for a server', async () => {
			const client = await getMCPClient(mockServer);

			expect(mockCreateMCPClient).toHaveBeenCalledWith({
				transport: {
					type: 'http',
					url: mockServer.url,
					headers: {},
				},
			});
			expect(client).toBe(mockClient);
		});

		it('caches clients by server id', async () => {
			const client1 = await getMCPClient(mockServer);
			const client2 = await getMCPClient(mockServer);

			expect(mockCreateMCPClient).toHaveBeenCalledTimes(1);
			expect(client1).toBe(client2);
		});

		it('includes Authorization header when apiKey is set', async () => {
			const serverWithAuth: MCPServer = {
				...mockServer,
				apiKey: 'my-secret-key',
			};

			await getMCPClient(serverWithAuth);

			expect(mockCreateMCPClient).toHaveBeenCalledWith({
				transport: {
					type: 'http',
					url: serverWithAuth.url,
					headers: { Authorization: 'Bearer my-secret-key' },
				},
			});
		});

		it('merges custom headers with auth header', async () => {
			const serverWithHeaders: MCPServer = {
				...mockServer,
				apiKey: 'key',
				headers: { 'X-Custom': 'value' },
			};

			await getMCPClient(serverWithHeaders);

			expect(mockCreateMCPClient).toHaveBeenCalledWith({
				transport: {
					type: 'http',
					url: serverWithHeaders.url,
					headers: {
						'X-Custom': 'value',
						Authorization: 'Bearer key',
					},
				},
			});
		});

		it('uses SSE transport when configured', async () => {
			const sseServer: MCPServer = {
				...mockServer,
				transport: 'sse',
			};

			await getMCPClient(sseServer);

			expect(mockCreateMCPClient).toHaveBeenCalledWith({
				transport: expect.objectContaining({ type: 'sse' }),
			});
		});
	});

	describe('getMCPTools', () => {
		it('returns tools from the server', async () => {
			const tools = await getMCPTools(mockServer);

			expect(tools).toEqual(mockTools);
			expect(mockClient.tools).toHaveBeenCalled();
		});

		it('caches tools', async () => {
			await getMCPTools(mockServer);
			await getMCPTools(mockServer);

			expect(mockClient.tools).toHaveBeenCalledTimes(1);
		});
	});

	describe('getAllMCPTools', () => {
		it('returns empty object when no servers', async () => {
			const tools = await getAllMCPTools([]);
			expect(tools).toEqual({});
		});

		it('returns empty object when no enabled servers', async () => {
			const disabledServer: MCPServer = { ...mockServer, enabled: false };
			const tools = await getAllMCPTools([disabledServer]);
			expect(tools).toEqual({});
		});

		it('namespaces tools by server id', async () => {
			const tools = await getAllMCPTools([mockServer]);

			expect(tools).toHaveProperty('test-server__search');
			expect(tools).toHaveProperty('test-server__read_file');
		});

		it('combines tools from multiple servers', async () => {
			const server2: MCPServer = {
				id: 'server-2',
				name: 'Server 2',
				url: 'https://other.example.com/mcp',
				transport: 'http',
				enabled: true,
			};

			const tools = await getAllMCPTools([mockServer, server2]);

			expect(Object.keys(tools)).toHaveLength(4);
			expect(tools).toHaveProperty('test-server__search');
			expect(tools).toHaveProperty('server-2__search');
		});

		it('skips servers that fail to connect', async () => {
			const failingServer: MCPServer = {
				id: 'failing-server',
				name: 'Failing Server',
				url: 'https://fail.example.com/mcp',
				transport: 'http',
				enabled: true,
			};

			// Make the second call fail
			mockCreateMCPClient
				.mockResolvedValueOnce(mockClient as any)
				.mockRejectedValueOnce(new Error('Connection failed'));

			const tools = await getAllMCPTools([mockServer, failingServer]);

			// Should still have tools from the working server
			expect(tools).toHaveProperty('test-server__search');
			expect(tools).not.toHaveProperty('failing-server__search');
		});
	});

	describe('testMCPServer', () => {
		it('returns success with tool count on successful connection', async () => {
			const result = await testMCPServer(mockServer);

			expect(result.success).toBe(true);
			expect(result.toolCount).toBe(2);
			expect(result.error).toBeUndefined();
		});

		it('returns error on connection failure', async () => {
			mockCreateMCPClient.mockRejectedValueOnce(new Error('Connection refused'));

			const result = await testMCPServer(mockServer);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Connection refused');
			expect(result.toolCount).toBeUndefined();
		});

		it('clears cache before testing', async () => {
			// First call caches the client
			await getMCPClient(mockServer);
			expect(mockCreateMCPClient).toHaveBeenCalledTimes(1);

			// Test should create a fresh connection
			await testMCPServer(mockServer);
			expect(mockCreateMCPClient).toHaveBeenCalledTimes(2);
		});
	});

	describe('closeMCPClient', () => {
		it('closes and removes client from cache', async () => {
			await getMCPClient(mockServer);
			await closeMCPClient(mockServer.id);

			expect(mockClient.close).toHaveBeenCalled();

			// Should create a new client on next call
			await getMCPClient(mockServer);
			expect(mockCreateMCPClient).toHaveBeenCalledTimes(2);
		});

		it('handles non-existent client gracefully', async () => {
			await expect(closeMCPClient('non-existent')).resolves.toBeUndefined();
		});
	});

	describe('closeAllMCPClients', () => {
		it('closes all cached clients', async () => {
			const server2: MCPServer = { ...mockServer, id: 'server-2' };

			await getMCPClient(mockServer);
			await getMCPClient(server2);

			await closeAllMCPClients();

			expect(mockClient.close).toHaveBeenCalledTimes(2);
		});
	});
});

describe('MCP Settings Integration', () => {
	it('has correct default settings', async () => {
		const { DEFAULT_SETTINGS } = await import('../src/settings/AugmentedCanvasSettings');

		expect(DEFAULT_SETTINGS.mcpServers).toEqual([]);
		expect(DEFAULT_SETTINGS.mcpEnabled).toBe(true);
		expect(DEFAULT_SETTINGS.mcpMaxSteps).toBe(5);
		expect(DEFAULT_SETTINGS.mcpRequireApproval).toBe(false);
	});
});
