import { describe, it, expect, beforeAll } from 'vitest';
import { createGoogleGenerativeAI, google } from '@ai-sdk/google';
import { generateText, streamText } from 'ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

describe.skipIf(!GEMINI_API_KEY)('Gemini API Tests', () => {
	const provider = createGoogleGenerativeAI({ apiKey: GEMINI_API_KEY });

	const MODELS = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-flash-preview'];

	const tryWithModels = async <T>(fn: (model: string) => Promise<T>): Promise<T> => {
		let lastError: Error | null = null;
		for (const model of MODELS) {
			try {
				console.log(`Trying ${model}...`);
				return await fn(model);
			} catch (e: any) {
				console.log(`${model} failed: ${e.message}`);
				lastError = e;
				if (!e.message?.includes('exhausted') && !e.message?.includes('overloaded')) throw e;
			}
		}
		throw lastError;
	};

	describe('Basic Generation', () => {
		it('generates a response', async () => {
			const { text } = await tryWithModels(model => generateText({
				model: provider(model),
				prompt: 'Say "hello" and nothing else.',
			}));
			expect(text.toLowerCase()).toContain('hello');
		}, 60000);

		it('streams a response', async () => {
			let lastError: Error | null = null;
			for (const model of MODELS) {
				try {
					console.log(`Streaming with ${model}...`);
					const result = streamText({
						model: provider(model),
						prompt: 'Count from 1 to 3.',
					});

					const text = await result.text;
					console.log(`${model} response: "${text.slice(0, 50)}..."`);
					if (!text) {
						console.log(`${model}: empty response, trying next...`);
						continue;
					}
					expect(text).toMatch(/1.*2.*3/s);
					return;
				} catch (e: any) {
					console.log(`${model} failed: ${e.message}`);
					lastError = e;
					const msg = e.message || '';
					const isRetryable = msg.includes('exhausted') || msg.includes('overloaded') || msg.includes('not found');
					if (!isRetryable) throw e;
				}
			}
			throw lastError ?? new Error('All models failed');
		}, 60000);
	});

	describe('URL Context', () => {
		// URL context requires gemini-2.5+ or gemini-3
		const URL_MODELS = ['gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-3-pro-preview'];

		it('fetches and reads webpage content', async () => {
			let lastError: Error | null = null;
			for (const model of URL_MODELS) {
				try {
					console.log(`URL context with ${model}...`);
					const { text } = await generateText({
						model: provider(model),
						prompt: 'Read https://example.com - What does the page say? Reply briefly.',
						tools: { url_context: google.tools.urlContext({}) },
					});
					console.log('URL context response:', text);
					if (!text) {
						console.log(`${model}: empty response, trying next...`);
						continue;
					}
					expect(text.toLowerCase()).toMatch(/example|domain|documentation|illustrative/);
					return;
				} catch (e: any) {
					console.log(`${model} failed: ${e.message}`);
					lastError = e;
					const msg = e.message || '';
					if (!msg.includes('exhausted') && !msg.includes('overloaded')) throw e;
				}
			}
			throw lastError ?? new Error('All URL context models failed');
		}, 120000);
	});

	describe('Search Grounding', () => {
		const SEARCH_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro'];

		it('uses search grounding for current info', async () => {
			let lastError: Error | null = null;
			for (const model of SEARCH_MODELS) {
				try {
					console.log(`Search grounding with ${model}...`);
					const { text } = await generateText({
						model: provider(model, { useSearchGrounding: true }),
						prompt: 'What year is it currently? Just the year number.',
					});
					expect(text).toMatch(/202[4-9]/);
					return;
				} catch (e: any) {
					console.log(`${model} failed: ${e.message}`);
					lastError = e;
					if (!e.message?.includes('exhausted') && !e.message?.includes('overloaded')) throw e;
				}
			}
			throw lastError;
		}, 60000);
	});
});
