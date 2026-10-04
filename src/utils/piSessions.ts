import { collectNodeAndAncestors, HasId, NodeAndAncestor } from "../obsidian/canvasUtil";

/** Provider type of the Pi command line agent. */
export const PI_PROVIDER_TYPE = "Pi CLI";

/** Where a Pi answer card keeps the id of the Pi session that produced it. */
export const PI_SESSION_KEY = "pi_session";

export type PiContinuation = {
	/** Pi session to fork. */
	sessionId: string;
	/** The card that session belongs to. */
	sessionNodeId: string;
	/** The selected cards the session does not already know: those added since. */
	newNodeIds: Set<string>;
	/** How many selected cards, the session card among them, the session already covers. */
	coveredCount: number;
};

/**
 * Find the card with a Pi session nearest to the card being asked from, which
 * counts as itself. Every Pi answer keeps its own frozen session, so asking
 * from the newest card continues it and asking from an older one branches from
 * there; both are the same step. `entries` is what `collectNodeAndAncestors`
 * returned for the asked card, nearest first. A card the user switched off is
 * not a place to continue from.
 */
export async function planPiContinuation(
	entries: NodeAndAncestor[],
	selectedNodeIds: ReadonlySet<string>,
	getData: (node: HasId) => Record<string, unknown> | undefined,
	getNodeParents?: Parameters<typeof collectNodeAndAncestors>[1]
): Promise<PiContinuation | undefined> {
	for (const { node } of entries) {
		if (!selectedNodeIds.has(node.id)) continue;
		const sessionId = getData(node)?.[PI_SESSION_KEY];
		if (typeof sessionId !== "string" || !sessionId) continue;

		const covered = new Set(
			(await collectNodeAndAncestors(node, getNodeParents)).map(entry => entry.node.id)
		);
		return {
			sessionId,
			sessionNodeId: node.id,
			newNodeIds: new Set([...selectedNodeIds].filter(id => !covered.has(id))),
			coveredCount: [...selectedNodeIds].filter(id => covered.has(id)).length,
		};
	}
	return undefined;
}
