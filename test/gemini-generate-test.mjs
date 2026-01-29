import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import 'dotenv/config';

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

// Patch fetch
let apiCallCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes('generativelanguage.googleapis.com')) {
        apiCallCount++;
        console.log(`\n[API CALL #${apiCallCount}]`);

        if (init?.body && typeof init.body === 'string') {
            try {
                const body = JSON.parse(init.body);

                if (body.contents) {
                    console.log(`  Messages: ${body.contents.length}`);
                    for (const c of body.contents) {
                        const parts = c.parts?.map(p => {
                            if (p.text) return `text(${p.text.substring(0,40)}...)`;
                            if (p.functionCall) return `functionCall(${p.functionCall.name})`;
                            if (p.functionResponse) return `functionResponse(${p.functionResponse.name})`;
                            return '?';
                        });
                        console.log(`    [${c.role}]: ${parts?.join(', ')}`);
                    }
                }

                let needsPatch = false;
                if (body.tools) {
                    for (const toolGroup of body.tools) {
                        if (toolGroup.functionDeclarations) {
                            for (const func of toolGroup.functionDeclarations) {
                                const stored = toolSchemas.get(func.name);
                                if (stored) {
                                    func.parameters = convertToGeminiSchema(stored);
                                    console.log('  [PATCH] Fixed:', func.name);
                                    needsPatch = true;
                                }
                            }
                        }
                    }
                }
                if (needsPatch) {
                    // Mutate init directly to ensure the changes take effect
                    Object.defineProperty(init, 'body', {
                        value: JSON.stringify(body),
                        writable: true,
                        configurable: true,
                    });
                }
            } catch (e) {
                console.log('  [ERROR]', e.message);
            }
        }
    }
    return originalFetch(input, init);
};

// Register tool schema
toolSchemas.set('get_info', { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] });

const myTools = {
    get_info: tool({
        description: 'Get information about a topic',
        parameters: z.object({ topic: z.string() }),
        execute: ({ topic }) => {
            console.log('[EXECUTE] topic:', topic);
            return `Information about ${topic}: This is a test response with some content about the topic.`;
        },
    }),
};

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });

console.log('=== Using generateText (non-streaming) ===\n');

const result = await generateText({
    model: google('gemini-2.0-flash'),
    messages: [{ role: 'user', content: 'Use the get_info tool to find out about "climate change" and summarize what you learn.' }],
    tools: myTools,
    maxSteps: 5,
});

console.log('\n=== RESULT ===');
console.log('Steps:', result.steps?.length);
if (result.steps) {
    for (let i = 0; i < result.steps.length; i++) {
        const step = result.steps[i];
        console.log(`\nStep ${i + 1}:`);
        console.log('  finishReason:', step.finishReason);
        console.log('  text:', step.text ? step.text.substring(0, 100) + '...' : '(empty)');
        console.log('  toolCalls:', step.toolCalls?.length || 0);
        console.log('  toolResults:', step.toolResults?.length || 0);
        if (step.toolResults?.length) {
            for (const tr of step.toolResults) {
                console.log('    - keys:', Object.keys(tr));
                console.log('    - full:', JSON.stringify(tr, null, 2).substring(0, 300));
            }
        }
    }
}
console.log('\nFinal text:', result.text || '(empty)');
