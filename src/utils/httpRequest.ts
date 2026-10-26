import { requestUrl, RequestUrlParam } from "obsidian";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type HttpMethod = typeof HTTP_METHODS[number];

export interface HttpRequestConfig {
	method: HttpMethod;
	url: string;
	query: string;
	headers: string;
	bearerToken: string;
	body: string;
}

export interface HttpResponse {
	status: number;
	headers: Record<string, string>;
	text: string;
	elapsedMs: number;
}

export const DEFAULT_HTTP_REQUEST: HttpRequestConfig = {
	method: "GET", url: "", query: "", headers: "", bearerToken: "", body: "",
};

export function getHttpRequest(data: Record<string, unknown>): HttpRequestConfig | null {
	if (data.type !== "text") return null;
	const value = data.http_request as HttpRequestConfig | undefined;
	if (!value || !HTTP_METHODS.includes(value.method)) return null;
	return [value.url, value.query, value.headers, value.bearerToken, value.body]
		.every(field => typeof field === "string") ? value : null;
}

export function buildHttpRequest(config: HttpRequestConfig): RequestUrlParam {
	let url: URL;
	try { url = new URL(config.url.trim()); }
	catch { throw new Error("Enter a valid HTTP or HTTPS URL."); }
	if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS URLs are supported.");
	if (!HTTP_METHODS.includes(config.method)) throw new Error("Unsupported HTTP method.");
	const query = new URLSearchParams(config.query.trim().split(/\r?\n/).filter(line => line.trim()).join("&"));
	query.forEach((value, key) => url.searchParams.append(key, value));
	const headers: Record<string, string> = {};
	config.headers.split(/\r?\n/).forEach((line, index) => {
		if (!line.trim()) return;
		const colon = line.indexOf(":");
		const name = line.slice(0, colon).trim();
		const value = line.slice(colon + 1).trim();
		if (colon < 1 || !/^[!#$%&'*+.^_`|~\w-]+$/.test(name) || /[\r\n\0]/.test(value)) {
			throw new Error(`Header on line ${index + 1} must use Name: value.`);
		}
		// HTTP names are case-insensitive; the last supplied value wins.
		for (const key of Object.keys(headers)) if (key.toLowerCase() === name.toLowerCase()) delete headers[key];
		headers[name] = value;
	});
	if (config.bearerToken.trim()) {
		if (/[\r\n\0]/.test(config.bearerToken)) throw new Error("Bearer token must be a single line.");
		for (const key of Object.keys(headers)) if (key.toLowerCase() === "authorization") delete headers[key];
		headers.Authorization = `Bearer ${config.bearerToken.trim()}`;
	}
	return {
		url: url.toString(), method: config.method, headers, throw: false,
		...(!["GET", "HEAD"].includes(config.method) ? { body: config.body } : {}),
	};
}

export async function executeHttpRequest(
	config: HttpRequestConfig,
	send: (request: RequestUrlParam) => Promise<Pick<HttpResponse, "status" | "headers" | "text">> = requestUrl
): Promise<HttpResponse> {
	const request = buildHttpRequest(config);
	const started = Date.now();
	const response = await send(request);
	return { status: response.status, headers: response.headers, text: response.text, elapsedMs: Date.now() - started };
}

const sensitiveHeader = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i;

function formatHeaders(headers: Record<string, string>): string {
	return Object.entries(headers).map(([name, value]) => `${name}: ${sensitiveHeader.test(name) ? "[redacted]" : value}`).join("\n");
}

/** Keep remote HTML and embedded fences inert, even when HTML previews are on. */
export function httpCodeBlock(text: string, language = "text"): string {
	const runs: string[] = text.match(/`+/g) ?? [];
	const longest = runs.reduce((max, match) => Math.max(max, match.length), 2);
	const fence = "`".repeat(longest + 1);
	return `${fence}${language}\n${text}\n${fence}`;
}

export function formatHttpRequest(config: HttpRequestConfig): string {
	let request: RequestUrlParam;
	try { request = buildHttpRequest(config); }
	catch {
		// Drafts must survive incomplete URLs and header lines while being edited.
		const headers = config.headers.split(/\r?\n/).map(line => {
			const colon = line.indexOf(":");
			return colon > 0 && sensitiveHeader.test(line.slice(0, colon).trim()) ? `${line.slice(0, colon)}: [redacted]` : line;
		}).join("\n");
		const lines = ["## HTTP request", httpCodeBlock(`${config.method} ${config.url || "(URL not set)"}`)];
		if (config.query) lines.push("### Query parameters", httpCodeBlock(config.query));
		if (headers) lines.push("### Headers", httpCodeBlock(headers));
		if (config.bearerToken) lines.push("Bearer authentication configured (token hidden).");
		if (config.body && !["GET", "HEAD"].includes(config.method)) lines.push("### Body", httpCodeBlock(config.body));
		return lines.join("\n\n");
	}
	const lines = [`## HTTP request`, httpCodeBlock(`${config.method} ${request.url}`)];
	if (Object.keys(request.headers ?? {}).length) lines.push("### Headers", httpCodeBlock(formatHeaders(request.headers!)));
	if (request.body) lines.push("### Body", httpCodeBlock(String(request.body)));
	return lines.join("\n\n");
}

export function formatHttpResponse(response: HttpResponse): string {
	let body = response.text;
	let language = "text";
	try {
		// Validate JSON, then indent its original tokens. Parsing and reserializing
		// would round 64-bit IDs and turn valid large exponents into null.
		JSON.parse(body);
		const tokens = body.match(/"(?:\\.|[^"\\])*"|[{}[\],:]|[^\s{}[\],:]+/g) ?? [];
		let depth = 0;
		body = "";
		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			if (token === "{" || token === "[") {
				body += token;
				depth++;
				if (tokens[i + 1] !== (token === "{" ? "}" : "]")) body += `\n${"  ".repeat(depth)}`;
			} else if (token === "}" || token === "]") {
				depth--;
				if (tokens[i - 1] !== (token === "}" ? "{" : "[")) body += `\n${"  ".repeat(depth)}`;
				body += token;
			} else if (token === ",") body += `,\n${"  ".repeat(depth)}`;
			else if (token === ":") body += ": ";
			else body += token;
		}
		language = "json";
	} catch { /* Non-JSON payloads remain plain text. */ }
	return [
		`## HTTP ${response.status}`,
		`${response.elapsedMs} ms`,
		"### Headers", httpCodeBlock(formatHeaders(response.headers) || "(No headers)"),
		"### Body", httpCodeBlock(body || "(Empty response)", language),
	].join("\n\n");
}
