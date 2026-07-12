import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	retries: 0,
	reporter: "line",
	use: {
		baseURL: "http://127.0.0.1:4173",
		browserName: "chromium",
		channel: "chrome",
		headless: true,
		launchOptions: {
			args: ["--disable-gpu", "--run-all-compositor-stages-before-draw"],
		},
		trace: "retain-on-failure",
	},
	webServer: {
		command: "pnpm dev --host 127.0.0.1 --port 4173",
		url: "http://127.0.0.1:4173",
		reuseExistingServer: false,
		timeout: 30_000,
	},
});
