import { describe, expect, it } from "vitest";
import { createCanvasArchive, readCanvasArchive } from "./archive";
import type { JsonCanvasData } from "../canvas/types";

describe("portable canvas ZIP archives", () => {
	it("round-trips embedded assets as real files and preserves prompt metadata", () => {
		const canvas: JsonCanvasData = {
			nodes: [{
				id: "image",
				type: "file",
				file: "generated/image.png",
				x: 0,
				y: 0,
				width: 500,
				height: 340,
				web_asset: "data:image/png;base64,aW1hZ2U=",
				web_asset_type: "image/png",
				ai_image_prompt: "EXACT PROMPT",
			}],
			edges: [],
		};

		const archive = createCanvasArchive(canvas, "Research");
		const loaded = readCanvasArchive(archive);

		expect(loaded.name).toBe("Research.canvas");
		expect(loaded.canvas.nodes[0]).toMatchObject({
			file: "generated/image.png",
			web_asset: "data:image/png;base64,aW1hZ2U=",
			web_asset_type: "image/png",
			ai_image_prompt: "EXACT PROMPT",
		});
	});

	it("rewrites unsafe attachment paths inside the archive", () => {
		const archive = createCanvasArchive({
			nodes: [{
				id: "unsafe",
				type: "file",
				file: "../../outside.png",
				x: 0,
				y: 0,
				width: 300,
				height: 200,
				web_asset: "data:image/png;base64,aW1hZ2U=",
			}],
			edges: [],
		}, "Safe");
		const loaded = readCanvasArchive(archive);
		expect(loaded.canvas.nodes[0]).toMatchObject({ file: "assets/outside.png" });
	});

	it("rejects ZIP files without a canvas document", () => {
		expect(() => readCanvasArchive(new Uint8Array([80, 75, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toThrow(
			"does not contain a .canvas file"
		);
	});
});
