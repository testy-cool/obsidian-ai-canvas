import { describe, expect, it } from "vitest";
import {
	collectNodeAndAncestors,
	isPromptContextNodeIncluded,
} from "../src/obsidian/canvasUtil";
import { noteGenerator } from "../src/actions/canvasNodeMenuActions/noteGenerator";
import { DEFAULT_SETTINGS } from "../src/settings/AugmentedCanvasSettings";

type TestNode = { id: string };
type ContextEntry = {
	node: TestNode;
	depth: number;
	edgeLabel?: string;
};

describe("prompt context selection", () => {
	it("collects the current card and every unique ancestor in prompt order", async () => {
		const root = { id: "root" };
		const left = { id: "left" };
		const right = { id: "right" };
		const shared = { id: "shared" };
		const parents = new Map<string, { node: TestNode; edgeLabel: string }[]>([
			["root", [
				{ node: left, edgeLabel: "left edge" },
				{ node: right, edgeLabel: "right edge" },
			]],
			["left", [{ node: shared, edgeLabel: "shared from left" }]],
			["right", [{ node: shared, edgeLabel: "shared from right" }]],
			["shared", []],
		]);

		const entries = await collectNodeAndAncestors(
			root,
			(node) => parents.get(node.id) ?? []
		) as ContextEntry[];

		expect(entries.map(({ node, depth, edgeLabel }) => ({
			id: node.id,
			depth,
			edgeLabel,
		}))).toEqual([
			{ id: "root", depth: 0, edgeLabel: undefined },
			{ id: "left", depth: 1, edgeLabel: "left edge" },
			{ id: "right", depth: 1, edgeLabel: "right edge" },
			{ id: "shared", depth: 2, edgeLabel: "shared from left" },
		]);
	});

	it("includes every card by default and only checked cards when selected", () => {
		expect(isPromptContextNodeIncluded("any-card")).toBe(true);
		const selected = new Set(["current", "wanted-ancestor"]);
		expect(isPromptContextNodeIncluded("current", selected)).toBe(true);
		expect(isPromptContextNodeIncluded("wanted-ancestor", selected)).toBe(true);
		expect(isPromptContextNodeIncluded("unwanted-ancestor", selected)).toBe(false);
	});

	it("builds messages from checked cards while traversing through unchecked cards", async () => {
		const canvas: any = {
			edges: [] as any[],
			getEdgesForNode(node: TestNode) {
				return this.edges.filter(
					(edge: any) => edge.from.node.id === node.id || edge.to.node.id === node.id
				);
			},
		};
		const makeNode = (id: string, text: string) => ({
			id,
			x: 0,
			canvas,
			getData: () => ({ id, type: "text", text }),
		});
		const root = makeNode("root", "CURRENT");
		const unchecked = makeNode("unchecked", "DO NOT SEND");
		const checkedAncestor = makeNode("checked", "KEEP THIS");
		canvas.edges = [
			{
				from: { node: unchecked },
				to: { node: root },
				label: "excluded edge label",
			},
			{
				from: { node: checkedAncestor },
				to: { node: unchecked },
				label: "included edge label",
			},
		];

		const provider = {
			id: "test-provider",
			type: "Custom",
			baseUrl: "https://example.test/v1",
			apiKey: "test",
			enabled: true,
		};
		const model = {
			id: "test-model",
			providerId: provider.id,
			model: "test-model",
			enabled: true,
		};
		const settings: any = {
			...DEFAULT_SETTINGS,
			apiKey: "test",
			activeProvider: provider.id,
			apiModel: model.id,
			providers: [provider],
			models: [model],
			systemPrompt: "",
		};
		const { buildMessages } = noteGenerator(
			{} as any,
			settings,
			root as any,
			undefined,
			provider,
			model
		);

		const { messages } = await buildMessages(root as any, {
			selectedNodeIds: new Set(["root", "checked"]),
		});

		expect(messages.map((message: any) => message.content)).toEqual([
			"KEEP THIS",
			"included edge label",
			"CURRENT",
		]);
	});
});
