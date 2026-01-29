import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import 'dotenv/config';

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

let apiCallCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes('generativelanguage.googleapis.com')) {
        apiCallCount++;
        console.log(`\n========== API CALL #${apiCallCount} ==========`);

        if (init?.body && typeof init.body === 'string') {
            try {
                const body = JSON.parse(init.body);
                console.log('Messages:', body.contents?.length);

                if (body.contents) {
                    for (const c of body.contents) {
                        console.log(`  [${c.role}]:`);
                        for (const p of c.parts || []) {
                            if (p.text) console.log(`    text: "${p.text.substring(0, 60)}..."`);
                            if (p.functionCall) console.log(`    functionCall: ${p.functionCall.name}(${JSON.stringify(p.functionCall.args)})`);
                            if (p.functionResponse) console.log(`    functionResponse: ${p.functionResponse.name} -> ${JSON.stringify(p.functionResponse.response).substring(0, 100)}`);
                        }
                    }
                }

                // Apply schema fix
                if (body.tools) {
                    for (const toolGroup of body.tools) {
                        if (toolGroup.functionDeclarations) {
                            for (const func of toolGroup.functionDeclarations) {
                                const stored = toolSchemas.get(func.name);
                                if (stored) {
                                    func.parameters = convertToGeminiSchema(stored);
                                    console.log('PATCHED tool schema:', func.name);
                                }
                            }
                        }
                    }
                    init = { ...init, body: JSON.stringify(body) };
                }
            } catch (e) {
                console.log('Parse error:', e.message);
            }
        }

        // Make the actual call and log the response
        console.log('Calling Gemini API...');
        const response = await originalFetch(input, init);
        console.log('Response status:', response.status);

        // Clone response to read body without consuming it
        const clone = response.clone();
        try {
            const text = await clone.text();
            if (text.length < 1000) {
                console.log('Response body:', text);
            } else {
                console.log('Response body (truncated):', text.substring(0, 500) + '...');
            }
        } catch (e) {
            console.log('Could not read response:', e.message);
        }

        return response;
    }
    return originalFetch(input, init);
};

// Register tool schema
toolSchemas.set('get_info', { type: 'object', properties: { topic: { type: 'string', description: 'Topic to look up' } }, required: ['topic'] });

const myTools = {
    get_info: tool({
        description: 'Get information about a topic',
        parameters: z.object({ topic: z.string().describe('Topic to look up') }),
        execute: ({ topic }) => {
            console.log('\n>>> TOOL EXECUTED: get_info("' + topic + '")');
            return `Information about ${topic}: It is a very interesting topic with many aspects.`;
        },
    }),
};

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });

console.log('=== STARTING TEST ===\n');

const result = await generateText({
    model: google('gemini-2.0-flash'),
    messages: [{ role: 'user', content: 'Use the get_info tool to learn about "cats" and tell me what you found.' }],
    tools: myTools,
    stopWhen: stepCountIs(5),  // New API: use stopWhen instead of maxSteps
    toolChoice: 'auto',
    onStepFinish: ({ stepType, finishReason, toolCalls, toolResults }) => {
        console.log(`\n>>> STEP FINISHED: type=${stepType} reason=${finishReason} calls=${toolCalls?.length} results=${toolResults?.length}`);
    },
});

console.log('\n=== FINAL RESULT ===');
console.log('Steps:', result.steps?.length);
console.log('Total API calls:', apiCallCount);
console.log('Final text:', result.text || '(empty)');
