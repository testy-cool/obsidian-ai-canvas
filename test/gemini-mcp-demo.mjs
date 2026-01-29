import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import 'dotenv/config';

const MCP_URL = 'https://windmill.voidxd.cloud/api/mcp/w/main/sse?token=FDYWBRm6fHYwb1DLJ1PHpiuOKTfoH4cp';

// Store schemas for the fetch patch
const toolSchemas = new Map();

function convertToGeminiSchema(schema) {
    if (!schema) return { type: 'OBJECT', properties: {} };
    const result = {};
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

// Patch fetch to fix Gemini schemas and log all API calls
let apiCallCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes('generativelanguage.googleapis.com')) {
        apiCallCount++;
        console.log(`\n[API CALL #${apiCallCount}] ${url.split('?')[0].split('/').pop()}`);

        if (init?.body && typeof init.body === 'string') {
            let body;
            try {
                body = JSON.parse(init.body);

                // Log what's being sent
                if (body.contents) {
                    console.log(`  Contents: ${body.contents.length} messages`);
                    for (const c of body.contents) {
                        const parts = c.parts?.map(p => {
                            if (p.text) return `text(${p.text.substring(0,50)}...)`;
                            if (p.functionCall) return `functionCall(${p.functionCall.name})`;
                            if (p.functionResponse) return `functionResponse(${p.functionResponse.name}: ${JSON.stringify(p.functionResponse.response).substring(0,80)}...)`;
                            return JSON.stringify(p).substring(0, 100);
                        });
                        console.log(`    [${c.role}]: ${parts?.join(', ')}`);
                    }
                }

                if (body.tools) {
                    for (const toolGroup of body.tools) {
                        if (toolGroup.functionDeclarations) {
                            for (const func of toolGroup.functionDeclarations) {
                                const stored = toolSchemas.get(func.name);
                                if (stored) {
                                    func.parameters = convertToGeminiSchema(stored);
                                    console.log('  [PATCH] Fixed schema for:', func.name);
                                }
                            }
                        }
                    }
                    init = { ...init, body: JSON.stringify(body) };
                }
            } catch (e) {}
        }
    }
    return originalFetch(input, init);
};

async function mcpRequest(method, params = {}, id = 1) {
    const response = await originalFetch(MCP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const text = await response.text();
    return text.startsWith('data: ') ? JSON.parse(text.replace(/^data: /, '').trim()) : JSON.parse(text);
}

async function run() {
    await mcpRequest('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } });
    const tools = await mcpRequest('tools/list', {}, 2);
    const scraperTool = tools.result.tools.find(t => t.name.includes('rnet__scraper'));

    // Store schema for the patch
    toolSchemas.set('scraper', { type: 'object', properties: { url: { type: 'string', description: 'URL to scrape' } }, required: ['url'] });

    const mcpTools = {
        scraper: tool({
            description: 'Scrape a webpage and return its content as markdown',
            parameters: z.object({ url: z.string().describe('URL to scrape') }),
            execute: ({ url }) => {
                console.log('[TOOL EXECUTE] url:', url);
                return `Page content: Example.com is a reserved domain for documentation. URL was ${url}`;
            },
        }),
    };

    const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });

    console.log('=== Asking Gemini to scrape and summarize ===\n');

    const result = await streamText({
        model: google('gemini-2.0-flash'),
        messages: [{ role: 'user', content: 'Use the scraper tool to fetch https://example.com and tell me what the page is about.' }],
        tools: mcpTools,
        maxSteps: 10,
        onStepFinish: ({ stepType, finishReason, toolCalls, toolResults, text }) => {
            console.log(`\n[STEP FINISHED] type=${stepType} reason=${finishReason}`);
            if (toolCalls?.length) console.log('  toolCalls:', toolCalls.map(t => t.toolName));
            if (toolResults?.length) {
                console.log('  toolResults:', toolResults.length, 'results');
                for (const r of toolResults) {
                    console.log('    -', r.toolName, ':', typeof r.result, String(r.result).substring(0, 100));
                }
            }
            if (text) console.log('  text:', text.substring(0, 100) + '...');
        },
    });

    console.log('\n=== GEMINI OUTPUT ===\n');

    // Add timeout
    const timeout = setTimeout(() => {
        console.log('\n[TIMEOUT] Stream took too long, exiting...');
        process.exit(1);
    }, 30000);

    for await (const part of result.fullStream) {
        console.log('[EVENT]', part.type);
        if (part.type === 'text-delta') {
            process.stdout.write(part.textDelta);
        } else if (part.type === 'tool-call') {
            console.log('  -> Tool:', part.toolName, 'Args:', JSON.stringify(part.args));
        } else if (part.type === 'tool-result') {
            console.log('  -> tool-result keys:', Object.keys(part));
            console.log('  -> full part:', JSON.stringify(part, null, 2).substring(0, 500));
        } else if (part.type === 'step-finish') {
            console.log('  -> Step finished, reason:', part.finishReason);
        } else if (part.type === 'finish') {
            console.log('  -> Stream finished, reason:', part.finishReason);
        }
    }

    clearTimeout(timeout);
    console.log('\n=== FINAL TEXT ===');
    console.log(await result.text);
    console.log('\n');
}

run().catch(console.error);
