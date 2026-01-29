import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

config(); // Load .env

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		testTimeout: 60000,
		hookTimeout: 30000,
	},
});
