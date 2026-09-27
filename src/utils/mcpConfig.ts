import { MCPServer, MCPTransportType } from "../settings/AugmentedCanvasSettings";

const BEARER = "Bearer ";

export type MCPConfigResult = { servers: MCPServer[] } | { error: string };

/** Only the transports the client really speaks; anything else is treated as HTTP. */
const normalizeTransport = (type: unknown): MCPTransportType => (type === "sse" ? "sse" : "http");

/**
 * Read a standard `mcpServers` block, the one people already keep for Claude
 * Desktop and friends. A server with a `command` is a local one launched over
 * stdio; a server with a `url` is remote.
 */
export const parseMCPServersConfig = (json: string): MCPConfigResult => {
	let parsed: any;
	try {
		parsed = JSON.parse(json);
	} catch (error) {
		return { error: `Invalid JSON: ${(error as Error).message}` };
	}

	const entries = parsed?.mcpServers ?? parsed?.servers ?? parsed;
	if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
		return { error: "Expected { mcpServers: { ... } } format" };
	}

	const servers: MCPServer[] = [];
	for (const [id, raw] of Object.entries(entries)) {
		const config = raw as any;
		if (!config || typeof config !== "object" || Array.isArray(config)) {
			return { error: `Server "${id}" is not a configuration object.` };
		}

		if (config.command) {
			servers.push({
				id,
				name: id,
				url: "",
				transport: "stdio",
				command: config.command,
				args: config.args,
				env: config.env,
				cwd: config.cwd,
				enabled: true,
			});
			continue;
		}

		if (!config.url) {
			return { error: `Server "${id}" needs either a url or a command.` };
		}

		// A pasted config usually carries the token in a header; the plugin keeps
		// it in its own field so it can be shown as a password.
		const headers = config.headers ? { ...config.headers } : undefined;
		let apiKey: string | undefined;
		if (typeof headers?.Authorization === "string" && headers.Authorization.startsWith(BEARER)) {
			apiKey = headers.Authorization.slice(BEARER.length);
			delete headers.Authorization;
		}

		servers.push({
			id,
			name: id,
			url: config.url,
			transport: normalizeTransport(config.type),
			apiKey,
			headers: Object.keys(headers || {}).length ? headers : undefined,
			enabled: true,
		});
	}

	if (!servers.length) return { error: "No servers found in that configuration." };
	return { servers };
};

export type ManualMCPFields = {
	id: string;
	name: string;
	transport: MCPTransportType;
	url: string;
	command: string;
	apiKey?: string;
	existing?: MCPServer | null;
};

/** Turn the Add/Edit form's fields into a server, or say what is missing. */
export const buildManualMCPServer = (fields: ManualMCPFields): { server: MCPServer } | { error: string } => {
	const { id, name, transport, url, command, apiKey, existing } = fields;
	const isLocal = transport === "stdio";
	if (!id || !name || (isLocal ? !command.trim() : !url)) {
		return { error: isLocal ? "ID, Name, and Command are required" : "ID, Name, and URL are required" };
	}

	const [binary, ...args] = command.trim().split(/\s+/);
	return {
		server: {
			id: existing?.id || id,
			name,
			url: isLocal ? "" : url,
			transport,
			// env and cwd have no field in the form, so an edit must not drop them.
			...(isLocal ? {
				command: binary,
				args: args.length ? args : undefined,
				env: existing?.env,
				cwd: existing?.cwd,
			} : {}),
			apiKey: apiKey || undefined,
			enabled: existing?.enabled ?? true,
			toolCount: existing?.toolCount,
		},
	};
};

/** Write servers back as a standard `mcpServers` block, ready to paste elsewhere. */
export const serializeMCPServers = (servers: MCPServer[]): { mcpServers: Record<string, any> } => {
	const mcpServers: Record<string, any> = {};
	for (const server of servers) {
		if (server.transport === "stdio") {
			mcpServers[server.id] = {
				command: server.command,
				...(server.args?.length ? { args: server.args } : {}),
				...(server.env ? { env: server.env } : {}),
				...(server.cwd ? { cwd: server.cwd } : {}),
			};
			continue;
		}
		const config: any = { type: server.transport, url: server.url };
		if (server.apiKey) config.headers = { Authorization: `${BEARER}${server.apiKey}` };
		if (server.headers) config.headers = { ...config.headers, ...server.headers };
		mcpServers[server.id] = config;
	}
	return { mcpServers };
};
