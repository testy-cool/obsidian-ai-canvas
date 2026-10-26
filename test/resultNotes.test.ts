import { describe, expect, it, vi } from "vitest";
import { createResultNote, resultNoteData, shouldSaveResultNote, replaceResultCard } from "../src/utils/resultNotes";

describe("result note storage", () => {
	it("keeps short results inline and applies a strict, configurable character threshold", () => {
		expect(shouldSaveResultNote("12345", 5)).toBe(false);
		expect(shouldSaveResultNote("123456", 5)).toBe(true);
		expect(shouldSaveResultNote("123456", 0)).toBe(false);
		expect(shouldSaveResultNote("123456", -1)).toBe(false);
		expect(shouldSaveResultNote("123456", Number.NaN)).toBe(false);
	});

	it("uses the canvas-relative attachment path and the collision-safe path chosen by Obsidian", async () => {
		const file = { path: "Boards/attachments/HTTP response 1.md" };
		const app: any = {
			fileManager: { getAvailablePathForAttachment: vi.fn(async () => file.path) },
			vault: { create: vi.fn(async () => file) },
		};
		const text = '# HTTP response\n\n```json\n{"value":true}\n```';
		expect(await createResultNote(app, text, "Boards/Requests.canvas", "HTTP response")).toBe(file);
		expect(app.fileManager.getAvailablePathForAttachment).toHaveBeenCalledWith(expect.stringMatching(/^HTTP response-.*\.md$/), "Boards/Requests.canvas");
		expect(app.vault.create).toHaveBeenCalledWith(file.path, text);
	});

	it("changes storage while preserving identity, metadata, title and geometry", () => {
		const data = { id: "output", type: "text", text: "Long response", x: 50, y: 60, width: 560, height: 480, ai_card_title: "Customers", http_response: { state: "complete", status: 200 }, chat_role: "assistant", ai_model: "test-model", pi_session: "existing-session" };
		const result = resultNoteData(data, "attachments/response.md");
		expect(result).toEqual({ ...data, type: "file", file: "attachments/response.md", result_note: true, text: undefined });
		expect(Object.hasOwn(result, "text")).toBe(false);
		expect(data.text).toBe("Long response");
	});

	it("replaces the native node type with the same ID and edges, retaining other selections", () => {
		const original = { id: "output", type: "text", text: "result", x: 0, y: 0, width: 560, height: 480 };
		const edge = { id: "edge", fromNode: "input", toNode: "output", label: "Response", isGenerated: false };
		const other: any = { id: "other", getData: () => ({ id: "other", type: "text", text: "Keep" }) };
		const node: any = { id: "output", getData: () => original };
		const nodes = new Map([[node.id, node], [other.id, other]]);
		const canvas: any = {
			nodes, selection: new Set([node, other]),
			getData: () => ({ nodes: [...nodes.values()].map(n => n.getData()), edges: [edge] }),
			removeNode: vi.fn((n: any) => { nodes.delete(n.id); canvas.selection.delete(n); }),
			importData: vi.fn((data: any) => { for (const d of data.nodes) if (!nodes.has(d.id)) nodes.set(d.id, { id: d.id, getData: () => d }); }),
			select: vi.fn((n: any) => canvas.selection.add(n)),
			requestSave: vi.fn(), requestFrame: vi.fn(),
		};
		node.canvas = canvas;
		const replacement = replaceResultCard(node, resultNoteData(original, "attachments/result.md"));
		expect(replacement?.getData()).toMatchObject({ id: "output", type: "file" });
		expect(canvas.importData).toHaveBeenCalledWith({ nodes: [replacement?.getData(), other.getData()], edges: [edge] });
		expect(canvas.selection.has(other)).toBe(true);
		expect(canvas.selection.has(replacement)).toBe(true);
		expect(nodes.size).toBe(2);
	});
});
