import { describe, it, expect } from "vitest";
import { collectNodeAndAncestors } from "../src/obsidian/canvasUtil";
import { planPiContinuation } from "../src/utils/piSessions";

/** Cards named by id; `parents` maps a card to the cards with an edge into it. */
const chain = (parents: Record<string, string[]>, sessions: Record<string, unknown>) => {
	const getNodeParents = (node: { id: string }) =>
		(parents[node.id] ?? []).map(id => ({ node: { id }, edgeLabel: "" }));
	const plan = async (start: string, selected?: string[]) => {
		const entries = await collectNodeAndAncestors({ id: start }, getNodeParents);
		const ids = new Set(selected ?? entries.map(entry => entry.node.id));
		return planPiContinuation(entries, ids, node => ({ pi_session: sessions[node.id] }), getNodeParents);
	};
	return { plan };
};

describe("finding the Pi session to continue", () => {
	// a (Pi) -> b -> c (Pi) -> d
	const linear = { d: ["c"], c: ["b"], b: ["a"] };

	it("takes the nearest session above the card being asked from", async () => {
		const result = await chain(linear, { a: "S-a", c: "S-c" }).plan("d");
		expect(result?.sessionId).toBe("S-c");
		expect(result?.sessionNodeId).toBe("c");
		expect([...result!.newNodeIds]).toEqual(["d"]);
		expect(result?.coveredCount).toBe(3);
	});

	it("uses the asked card's own session, with nothing new to send", async () => {
		const result = await chain(linear, { a: "S-a", c: "S-c" }).plan("c");
		expect(result?.sessionId).toBe("S-c");
		expect([...result!.newNodeIds]).toEqual([]);
	});

	it("branches from an older card by asking from it", async () => {
		const result = await chain(linear, { a: "S-a", c: "S-c" }).plan("a");
		expect(result?.sessionId).toBe("S-a");
		expect([...result!.newNodeIds]).toEqual([]);
	});

	it("sends every card after the session, not only the asked one", async () => {
		const result = await chain(linear, { a: "S-a" }).plan("d");
		expect(result?.sessionId).toBe("S-a");
		expect([...result!.newNodeIds].sort()).toEqual(["b", "c", "d"]);
	});

	it("finds nothing when no card has a session", async () => {
		expect(await chain(linear, {}).plan("d")).toBeUndefined();
	});

	it("ignores an empty or odd session value", async () => {
		expect(await chain(linear, { a: "", b: 7, c: null }).plan("d")).toBeUndefined();
	});

	it("skips a card the user switched off", async () => {
		const result = await chain(linear, { a: "S-a", c: "S-c" }).plan("d", ["a", "b", "d"]);
		expect(result?.sessionId).toBe("S-a");
		expect([...result!.newNodeIds].sort()).toEqual(["b", "d"]);
	});

	it("prefers the nearer of two branches", async () => {
		// d has parents p (Pi, one edge away) and q <- r (Pi, two edges away).
		const result = await chain({ d: ["q", "p"], q: ["r"] }, { p: "S-p", r: "S-r" }).plan("d");
		expect(result?.sessionId).toBe("S-p");
		expect([...result!.newNodeIds].sort()).toEqual(["d", "q", "r"]);
	});
});
