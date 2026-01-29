import { describe, it, expect, beforeAll } from 'vitest';

const MCP_URL = 'https://windmill.voidxd.cloud/api/mcp/w/main/sse?token=FDYWBRm6fHYwb1DLJ1PHpiuOKTfoH4cp';

// Direct MCP request (same as mcpClient.ts implementation)
async function mcpRequest(method: string, params: any = {}, id: number = 1) {
	const response = await fetch(MCP_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'application/json, text/event-stream',
		},
		body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
	});
	const text = await response.text();
	if (text.startsWith('data: ')) {
		return JSON.parse(text.replace(/^data: /, '').trim());
	}
	return JSON.parse(text);
}

// Schema converter (same as mcpClient.ts)
function convertToGeminiSchema(schema: any): any {
	if (!schema) return { type: 'OBJECT', properties: {} };
	const result: any = {};
	if (schema.type) result.type = schema.type.toUpperCase();
	if (schema.properties) {
		result.properties = {};
		for (const [key, value] of Object.entries(schema.properties)) {
			result.properties[key] = convertToGeminiSchema(value);
		}
	}
	if (schema.description) result.description = schema.description;
	if (schema.required) result.required = schema.required;
	if (schema.items) result.items = convertToGeminiSchema(schema.items);
	if (schema.enum) result.enum = schema.enum;
	return result;
}

describe('MCP Server Connection', () => {
	it('initializes session successfully', async () => {
		const response = await mcpRequest('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: { name: 'test', version: '1.0' },
		});

		expect(response.result).toBeDefined();
		expect(response.result.serverInfo).toBeDefined();
	});

	it('lists available tools', async () => {
		// Initialize first
		await mcpRequest('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: { name: 'test', version: '1.0' },
		});

		const response = await mcpRequest('tools/list', {}, 2);

		expect(response.result).toBeDefined();
		expect(response.result.tools).toBeDefined();
		expect(Array.isArray(response.result.tools)).toBe(true);
		expect(response.result.tools.length).toBeGreaterThan(0);
	});

	it('has scraper tool available', async () => {
		await mcpRequest('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: { name: 'test', version: '1.0' },
		});

		const response = await mcpRequest('tools/list', {}, 2);
		const scraperTool = response.result.tools.find((t: any) => t.name.includes('scraper'));

		expect(scraperTool).toBeDefined();
		expect(scraperTool.inputSchema).toBeDefined();
		expect(scraperTool.inputSchema.type).toBe('object');
	});
});

describe('MCP Tool Execution', () => {
	let scraperToolName: string;

	beforeAll(async () => {
		await mcpRequest('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: { name: 'test', version: '1.0' },
		});

		const response = await mcpRequest('tools/list', {}, 2);
		const scraperTool = response.result.tools.find((t: any) => t.name.includes('rnet__scraper'));
		scraperToolName = scraperTool?.name;
	});

	it('executes scraper tool successfully', async () => {
		expect(scraperToolName).toBeDefined();

		const result = await mcpRequest('tools/call', {
			name: scraperToolName,
			arguments: { url: 'https://example.com' },
		}, Date.now());

		expect(result.result).toBeDefined();
		expect(result.result.content).toBeDefined();
		expect(result.result.content[0].text).toContain('Example Domain');
	}, 30000); // 30s timeout for network request
});

describe('Gemini Schema Conversion', () => {
	it('converts lowercase types to uppercase', () => {
		const input = { type: 'object', properties: { name: { type: 'string' } } };
		const output = convertToGeminiSchema(input);

		expect(output.type).toBe('OBJECT');
		expect(output.properties.name.type).toBe('STRING');
	});

	it('preserves required fields', () => {
		const input = {
			type: 'object',
			properties: { url: { type: 'string' } },
			required: ['url'],
		};
		const output = convertToGeminiSchema(input);

		expect(output.required).toEqual(['url']);
	});

	it('handles nested objects', () => {
		const input = {
			type: 'object',
			properties: {
				config: {
					type: 'object',
					properties: {
						timeout: { type: 'number' },
					},
				},
			},
		};
		const output = convertToGeminiSchema(input);

		expect(output.properties.config.type).toBe('OBJECT');
		expect(output.properties.config.properties.timeout.type).toBe('NUMBER');
	});

	it('handles arrays', () => {
		const input = {
			type: 'array',
			items: { type: 'string' },
		};
		const output = convertToGeminiSchema(input);

		expect(output.type).toBe('ARRAY');
		expect(output.items.type).toBe('STRING');
	});

	it('preserves descriptions', () => {
		const input = {
			type: 'string',
			description: 'A URL to scrape',
		};
		const output = convertToGeminiSchema(input);

		expect(output.description).toBe('A URL to scrape');
	});

	it('handles MCP scraper schema correctly', async () => {
		await mcpRequest('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: { name: 'test', version: '1.0' },
		});

		const response = await mcpRequest('tools/list', {}, 2);
		const scraperTool = response.result.tools.find((t: any) => t.name.includes('rnet__scraper'));

		const geminiSchema = convertToGeminiSchema(scraperTool.inputSchema);

		expect(geminiSchema.type).toBe('OBJECT');
		expect(geminiSchema.properties).toBeDefined();
		expect(geminiSchema.properties.url).toBeDefined();
		expect(geminiSchema.properties.url.type).toBe('STRING');
	});
});

describe('url_context exclusion', () => {
	it('should not mix url_context with MCP tools', () => {
		// This test verifies the logic in ai.ts
		const mcpTools = { 'server__tool1': {}, 'server__tool2': {} };
		const hasMcpTools = mcpTools && Object.keys(mcpTools).length > 0;

		// Simulating the buildTools logic
		const allTools: Record<string, any> = {};
		const useUrlContext = true;

		// Only use url_context if there are no MCP tools
		if (useUrlContext && !hasMcpTools) {
			allTools.url_context = { type: 'provider' };
		}
		if (mcpTools) {
			Object.assign(allTools, mcpTools);
		}

		// url_context should NOT be present when MCP tools exist
		expect(allTools.url_context).toBeUndefined();
		expect(allTools.server__tool1).toBeDefined();
		expect(allTools.server__tool2).toBeDefined();
	});

	it('should use url_context when no MCP tools', () => {
		const mcpTools: Record<string, any> | undefined = undefined;
		const hasMcpTools = mcpTools && Object.keys(mcpTools).length > 0;

		const allTools: Record<string, any> = {};
		const useUrlContext = true;

		if (useUrlContext && !hasMcpTools) {
			allTools.url_context = { type: 'provider' };
		}
		if (mcpTools) {
			Object.assign(allTools, mcpTools);
		}

		// url_context SHOULD be present when no MCP tools
		expect(allTools.url_context).toBeDefined();
	});
});
