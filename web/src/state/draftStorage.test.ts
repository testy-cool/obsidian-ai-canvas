import { describe, expect, it } from "vitest";
import { loadCanvasDraft, saveCanvasDraft, type DraftStorage } from "./draftStorage";

const memory = (): DraftStorage & { value: string | null } => ({
	value: null,
	getItem() { return this.value; },
	setItem(_key, value) { this.value = value; },
});

describe("browser canvas draft recovery", () => {
	it("round-trips the current canvas and name", () => {
		const storage = memory();
		const draft = { name: "Recovered", canvas: { nodes: [], edges: [] } };
		saveCanvasDraft(storage, draft);
		expect(loadCanvasDraft(storage)).toEqual(draft);
	});

	it("ignores malformed or invalid drafts", () => {
		const storage = memory();
		storage.value = '{"name":"Broken","canvas":{"nodes":[{}],"edges":[]}}';
		expect(loadCanvasDraft(storage)).toBeNull();
	});
});
