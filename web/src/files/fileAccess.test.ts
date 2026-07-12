import { describe, expect, it, vi } from "vitest";
import { canvasBlob, canvasFilename, readCanvasFile, writeCanvasHandle } from "./fileAccess";

describe("browser canvas file access", () => {
	it("normalizes exported file names", () => {
		expect(canvasFilename("Research board")).toBe("Research board.canvas");
		expect(canvasFilename("Research.canvas")).toBe("Research.canvas");
		expect(canvasFilename("  ")).toBe("Untitled.canvas");
	});

	it("reads and validates a selected canvas file", async () => {
		const file = {
			name: "Ideas.canvas",
			text: vi.fn().mockResolvedValue('{"nodes":[],"edges":[]}'),
		};
		await expect(readCanvasFile(file)).resolves.toEqual({
			name: "Ideas.canvas",
			canvas: { nodes: [], edges: [] },
		});
	});

	it("writes serialized JSON and closes a browser file handle", async () => {
		const write = vi.fn();
		const close = vi.fn();
		const handle = {
			name: "Saved.canvas",
			createWritable: vi.fn().mockResolvedValue({ write, close }),
		};

		await writeCanvasHandle(handle, { nodes: [], edges: [] });

		expect(write).toHaveBeenCalledWith('{\n\t"nodes": [],\n\t"edges": []\n}\n');
		expect(close).toHaveBeenCalledOnce();
	});

	it("creates a JSON Canvas download blob", async () => {
		const blob = canvasBlob({ nodes: [], edges: [] });
		expect(blob.type).toBe("application/json");
		expect(await blob.text()).toContain('"nodes": []');
	});
});
