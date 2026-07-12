import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
	plugins: [react()],
	base: "./",
	build: {
		rollupOptions: {
			output: {
				manualChunks: {
					flow: ["@xyflow/react"],
					content: ["dompurify", "fflate", "marked"],
					icons: ["lucide-react"],
				},
			},
		},
	},
	test: {
		include: ["src/**/*.test.{ts,tsx}"],
		environment: "jsdom",
		setupFiles: "./src/test/setup.ts",
	},
});
