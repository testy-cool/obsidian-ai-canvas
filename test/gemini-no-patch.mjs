import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import 'dotenv/config';

// Just logging, no patching
let apiCallCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url || '';
    if (url.includes('generativelanguage.googleapis.com')) {
        apiCallCount++;
        console.log(`\n[API CALL #${apiCallCount}]`);
        if (init?.body && typeof init.body === 'string') {
            try {
                const body = JSON.parse(init.body);
                console.log(`  Messages: ${body.contents?.length}`);
            } catch (e) {}
        }
    }
    return originalFetch(input, init);
};

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });

// Simple tool - no schema registration, no patch
const myTools = {
    add_numbers: tool({
        description: 'Add two numbers',
        parameters: z.object({
            a: z.number(),
            b: z.number(),
        }),
        execute: ({ a, b }) => {
            console.log('[EXECUTE] Adding', a, '+', b);
            return { result: a + b };
        },
    }),
};

console.log('Testing WITHOUT fetch patch...');

try {
    const result = await generateText({
        model: google('gemini-2.0-flash'),
        messages: [{ role: 'user', content: 'What is 5 + 7? Use the add_numbers tool.' }],
        tools: myTools,
        maxSteps: 5,
    });

    console.log('\nSteps:', result.steps?.length);
    console.log('Text:', result.text?.substring(0, 200) || '(empty)');
} catch (e) {
    console.log('\nERROR:', e.message);
    console.log('Total API calls before error:', apiCallCount);
}
