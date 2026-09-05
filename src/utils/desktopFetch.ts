/** Use Node networking for gateways that do not accept browser CORS requests. */
export const desktopFetch: typeof fetch = async (input, init) => {
	// Explicitly select the Node entry; the package's browser entry delegates to window.fetch.
	// Keep it lazy so mobile never loads the Node transport.
	const nodeFetch: typeof import("node-fetch") = require("node-fetch/lib/index.js");
	const request = new Request(input, init);
	const headers: Record<string, string> = {};
	request.headers.forEach((value, name) => { headers[name] = value; });
	const response = await nodeFetch(request.url, {
		method: request.method,
		headers,
		body: request.body ? Buffer.from(await request.arrayBuffer()) : undefined,
		signal: request.signal,
		redirect: request.redirect,
	});

	// Use the renderer's ReadableStream, not Node's separate WHATWG implementation.
	// Pulling one chunk at a time keeps SSE incremental and preserves backpressure.
	const iterator = (response.body as import("stream").Readable)[Symbol.asyncIterator]();
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const chunk = await iterator.next();
				if (chunk.done) controller.close();
				else controller.enqueue(new Uint8Array(chunk.value));
			} catch (error) {
				controller.error(error);
			}
		},
		async cancel() { await iterator.return?.(); },
	});
	return new Response(request.method === "HEAD" || [204, 205, 304].includes(response.status) ? null : body, {
		status: response.status,
		statusText: response.statusText,
		headers: Object.fromEntries(response.headers.entries()),
	});
};
