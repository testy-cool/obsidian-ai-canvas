import { describe, expect, it } from "vitest";
import { createHistory, pushHistory, redoHistory, undoHistory } from "./history";

const canvas = (text: string) => ({
	nodes: [{ id: "one", type: "text" as const, text, x: 0, y: 0, width: 240, height: 160 }],
	edges: [],
});

describe("canvas history", () => {
	it("undoes and redoes committed canvas changes", () => {
		const initial = createHistory(canvas("one"));
		const changed = pushHistory(initial, canvas("two"));

		const undone = undoHistory(changed);
		expect(undone.present.nodes[0]).toMatchObject({ text: "one" });

		const redone = redoHistory(undone);
		expect(redone.present.nodes[0]).toMatchObject({ text: "two" });
	});

	it("drops redo states when a new edit is committed", () => {
		const firstEdit = pushHistory(createHistory(canvas("one")), canvas("two"));
		const undone = undoHistory(firstEdit);
		const alternateEdit = pushHistory(undone, canvas("alternate"));

		expect(alternateEdit.future).toEqual([]);
		expect(redoHistory(alternateEdit)).toBe(alternateEdit);
	});

	it("does not add duplicate snapshots", () => {
		const initial = createHistory(canvas("same"));
		expect(pushHistory(initial, canvas("same"))).toBe(initial);
	});
});
