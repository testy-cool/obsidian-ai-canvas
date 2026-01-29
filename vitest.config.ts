import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

config(); // Load .env

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		testTimeout: 60000,
		hookTimeout: 30000,
		alias: {
			'obsidian': new URL('./test/__mocks__/obsidian.ts', import.meta.url).pathname,
		},
	},
});
