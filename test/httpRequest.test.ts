import { describe, expect, it, vi } from "vitest";
import {
	buildHttpRequest,
	DEFAULT_HTTP_REQUEST,
	executeHttpRequest,
	formatHttpRequest,
	formatHttpResponse,
	getHttpRequest,
} from "../src/utils/httpRequest";

const config = (overrides = {}) => ({ ...DEFAULT_HTTP_REQUEST, url: "https://example.com/items", ...overrides });

describe("HTTP request cards", () => {
	it("sends a GET with repeated query parameters and custom headers, without a body", () => {
		const request = buildHttpRequest(config({
			url: "https://example.com/items?existing=1",
			query: "tag=one\ntag=two\nq=hello+world",
			headers: "Accept: application/json\nX-Example: value:with:colons",
			body: "saved POST body",
		}));
		expect(request).toEqual({
			url: "https://example.com/items?existing=1&tag=one&tag=two&q=hello+world",
			method: "GET",
			headers: { Accept: "application/json", "X-Example": "value:with:colons" },
			throw: false,
		});
	});

	it("sends a POST body verbatim and replaces an existing authorization header with the bearer token", () => {
		expect(buildHttpRequest(config({ method: "POST", headers: "authorization: old\nContent-Type: application/json", bearerToken: "secret", body: '{"name":"Vlad"}' }))).toMatchObject({
			method: "POST", body: '{"name":"Vlad"}', headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
		});
	});

	it.each(["file:///etc/passwd", "javascript:alert(1)", "not a URL"])("rejects invalid HTTP URL %s", url => {
		expect(() => buildHttpRequest(config({ url }))).toThrow(/HTTP|URL/);
	});

	it("rejects malformed headers before sending anything", () => {
		expect(() => buildHttpRequest(config({ headers: "this is not a header" }))).toThrow(/Header.*1/i);
		expect(() => buildHttpRequest(config({ headers: "Bad name: value" }))).toThrow(/Header.*1/i);
	});

	it("only recognizes complete, supported request metadata on text cards", () => {
		expect(getHttpRequest({ type: "text", http_request: config() })).toEqual(config());
		expect(getHttpRequest({ type: "file", http_request: config() })).toBeNull();
		expect(getHttpRequest({ type: "text", http_request: { method: "GET" } })).toBeNull();
		expect(getHttpRequest({ type: "text", http_request: config({ method: "TRACE" }) })).toBeNull();
	});

	it("returns HTTP errors as inspectable responses instead of throwing", async () => {
		const send = vi.fn(async () => ({ status: 422, headers: { "content-type": "application/json" }, text: '{"error":"invalid"}' }));
		const result = await executeHttpRequest(config({ method: "POST", body: "raw" }), send);
		expect(send).toHaveBeenCalledOnce();
		expect(send.mock.calls[0][0]).toMatchObject({ throw: false, body: "raw" });
		expect(result).toMatchObject({ status: 422, text: '{"error":"invalid"}' });
		expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
		expect(formatHttpResponse(result)).toContain('"error": "invalid"');
	});

	it("keeps request inputs readable without copying authentication secrets into card text", () => {
		const text = formatHttpRequest(config({ method: "POST", bearerToken: "secret-token", headers: "X-Api-Key: secret-key\nContent-Type: application/json", body: "hello\n```\nworld" }));
		expect(text).toContain("POST https://example.com/items");
		expect(text).toContain("hello\n```\nworld");
		expect(text).not.toContain("secret-token");
		expect(text).not.toContain("secret-key");
		expect(text).toContain("[redacted]");
	});

	it("renders non-JSON responses as inert text, including HTML and fence characters", () => {
		const text = formatHttpResponse({ status: 200, elapsedMs: 12, headers: { "content-type": "text/html", "set-cookie": "session=secret" }, text: '<script>bad()</script>\n```\n' });
		expect(text).toContain("HTTP 200");
		expect(text).toContain("12 ms");
		expect(text).toContain("````text\n<script>bad()</script>\n```\n");
		expect(text).not.toContain("session=secret");
	});

	it("propagates network failures without retrying POST requests", async () => {
		const send = vi.fn(async () => { throw new Error("Connection refused"); });
		await expect(executeHttpRequest(config({ method: "POST" }), send)).rejects.toThrow("Connection refused");
		expect(send).toHaveBeenCalledOnce();
	});
});
