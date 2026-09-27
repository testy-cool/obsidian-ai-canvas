/**
 * Helpers for tests that talk to the real world: the vault's own provider keys,
 * Obsidian's `requestUrl` replaced by real fetch, and a Langfuse lookup.
 *
 * Live tests are opt-in. Run them with `LIVE=1 pnpm exec vitest run test/live.test.ts`.
 * They spend real tokens against whatever the vault is configured to use.
 */
import fs from "fs";
import os from "os";
import path from "path";

export const LIVE = process.env.LIVE === "1";

const VAULT_DATA = path.join(os.homedir(), "Obsidian-New/.obsidian/plugins/obsidian-ai-canvas/data.json");

export type VaultData = {
	providers: { id: string; type: string; baseUrl?: string; apiKey?: string; enabled?: boolean }[];
	observability: { enabled: boolean; provider: string; host: string; publicKey: string; secretKey: string };
	mcpServers?: unknown[];
};

export const vaultDataExists = (): boolean => fs.existsSync(VAULT_DATA);

/** The live plugin's own settings. Never copy values out of here into the repo. */
export const readVaultData = (): VaultData => JSON.parse(fs.readFileSync(VAULT_DATA, "utf8"));

export const vaultProvider = (id: string) => {
	const provider = readVaultData().providers.find(candidate => candidate.id === id);
	if (!provider) throw new Error(`No provider "${id}" in the vault's data.json`);
	return provider as any;
};

/**
 * Stand-in for Obsidian's `requestUrl`, which bypasses CORS in the app and does
 * not exist outside it. Both the MCP client and the trace exporter use it, so a
 * live test needs this in place of the mock's empty version:
 *
 *   vi.mock("obsidian", async (importOriginal) => ({
 *     ...(await importOriginal<any>()),
 *     requestUrl: (await import("./helpers/live")).realRequestUrl,
 *   }));
 */
export const realRequestUrl = async (options: any) => {
	const response = await fetch(options.url, {
		method: options.method || "GET",
		headers: options.headers,
		body: options.body,
	});
	const text = await response.text();
	const headers: Record<string, string> = {};
	response.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
	let json: unknown;
	try { json = JSON.parse(text); } catch { /* not json */ }
	return { status: response.status, text, json, headers };
};

/** Write a throwaway stdio MCP server and return its path. */
export const writeStdioMcpServer = (body: string): string => {
	const file = path.join(os.tmpdir(), `live-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`);
	fs.writeFileSync(file, body);
	return file;
};

/**
 * Poll Langfuse for a trace this run produced. Traces arrive through a queue, so
 * a fresh one takes a few seconds to appear.
 */
export const findLangfuseTrace = async (
	marker: string,
	{ attempts = 6, waitMs = 2500 }: { attempts?: number; waitMs?: number } = {}
): Promise<any | undefined> => {
	const { host, publicKey, secretKey } = readVaultData().observability;
	const auth = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
	for (let attempt = 0; attempt < attempts; attempt++) {
		await new Promise(resolve => setTimeout(resolve, waitMs));
		const response = await fetch(`${host}/api/public/traces?limit=10`, { headers: { Authorization: `Basic ${auth}` } });
		if (!response.ok) continue;
		const body = await response.json();
		const found = body.data?.find((trace: any) => trace.metadata?.attributes?.["langfuse.version"] === marker);
		if (found) return found;
	}
	return undefined;
};
