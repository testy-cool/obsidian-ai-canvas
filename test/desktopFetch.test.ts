import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server, type RequestListener, type ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";
import { desktopFetch } from "../src/utils/desktopFetch";
import { getResponse } from "../src/utils/ai";

let server: Server | undefined;
const listen = async (handler: RequestListener) => {
	server = createServer(handler);
	await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
	return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
};

afterEach(async () => {
	(server as any)?.closeAllConnections?.();
	if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
	server = undefined;
	vi.unstubAllGlobals();
});

describe("desktop provider transport", () => {
	it.each([false, true])("generates through a desktop Bifrost gateway with browser fetch blocked (native API: %s)", async (geminiNative) => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
		const url = await listen((_request, response) => {
			response.writeHead(200, { "Content-Type": "application/json" });
			response.end(JSON.stringify(geminiNative
				? { candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }] }
				: { id: "test", object: "chat.completion", created: 0, model: "test-model", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }));
		});
		const result = await getResponse(
			{ id: "bifrost", type: "Bifrost", baseUrl: `${url}/v1`, apiKey: "test-key", enabled: true, geminiNative },
			[{ role: "user", content: "hello" }], { model: "test-model" },
		);
		expect(result).toBe("ok");
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it("receives streamed bytes before the response ends when browser fetch is blocked", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
		let outgoing: ServerResponse;
		let receivedBody = "";
		let authorization: string | undefined;
		const url = await listen((request, response) => {
			authorization = request.headers.authorization;
			request.on("data", chunk => { receivedBody += chunk; });
			request.on("end", () => {
				outgoing = response;
				response.writeHead(200, { "Content-Type": "text/event-stream" });
				response.write("data: first\n\n");
			});
		});
		const response = await desktopFetch(new Request(url, {
			method: "POST", headers: { Authorization: "Bearer test-key" }, body: '{"stream":true}',
		}));
		const reader = response.body!.getReader();
		expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: first\n\n");
		expect(outgoing!.writableEnded).toBe(false);
		outgoing!.end("data: last\n\n");
		expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: last\n\n");
		expect((await reader.read()).done).toBe(true);
		expect(receivedBody).toBe('{"stream":true}');
		expect(authorization).toBe("Bearer test-key");
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it("cancels an in-progress response when its signal aborts", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
		const url = await listen((_request, response) => {
			response.writeHead(200, { "Content-Type": "text/event-stream" });
			response.write("first");
		});
		const controller = new AbortController();
		const response = await desktopFetch(url, { signal: controller.signal });
		const reader = response.body!.getReader();
		await reader.read();
		controller.abort();
		await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" });
	});

	it("preserves HTTP errors and decodes compressed response bodies", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
		const url = await listen((_request, response) => {
			response.writeHead(403, { "Content-Type": "application/json", "Content-Encoding": "gzip" });
			response.end(gzipSync('{"error":{"message":"Key is not allowed"}}'));
		});
		const response = await desktopFetch(url);
		expect(response.status).toBe(403);
		expect(response.ok).toBe(false);
		expect(await response.json()).toEqual({ error: { message: "Key is not allowed" } });
	});
});
