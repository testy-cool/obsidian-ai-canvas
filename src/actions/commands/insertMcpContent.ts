import { App, Notice, SuggestModal } from "obsidian";
import { calcHeight, createNode } from "src/obsidian/canvas-patches";
import { AugmentedCanvasSettings } from "src/settings/AugmentedCanvasSettings";
import { getActiveCanvas } from "src/utils";
import { getMCPPrompt, readMCPResource } from "src/utils/mcpClient";
import { gatherMcpContent } from "src/utils/mcpContent";

type McpChoice = {
	kind: "resource" | "prompt";
	title: string;
	subtitle: string;
	serverId: string;
	uri?: string;
	name?: string;
};

const NODE_WIDTH = 800;

class McpContentModal extends SuggestModal<McpChoice> {
	constructor(app: App, private choices: McpChoice[], private onPick: (choice: McpChoice) => void) {
		super(app);
		this.setPlaceholder("Search MCP resources and prompts");
	}

	getSuggestions(query: string): McpChoice[] {
		const needle = query.toLowerCase();
		return this.choices.filter(choice =>
			`${choice.title} ${choice.subtitle}`.toLowerCase().includes(needle));
	}

	renderSuggestion(choice: McpChoice, el: HTMLElement) {
		el.createEl("div", { text: choice.title });
		el.createEl("small", { text: choice.subtitle });
	}

	onChooseSuggestion(choice: McpChoice) {
		this.onPick(choice);
	}
}

/**
 * Put an MCP resource or a server-side prompt on the canvas as a card. Tools are
 * called during generation; these two are things a server hands over on request.
 */
export const insertMcpContent = async (app: App, settings: AugmentedCanvasSettings) => {
	const canvas = getActiveCanvas(app);
	if (!canvas) return;

	const servers = settings.mcpServers ?? [];
	if (!servers.some(server => server.enabled)) {
		new Notice("No MCP server is enabled.");
		return;
	}

	const notice = new Notice("Asking MCP servers what they offer…", 0);
	const { resources, prompts, errors } = await gatherMcpContent(servers);
	notice.hide();

	const choices: McpChoice[] = [
		...resources.map(resource => ({
			kind: "resource" as const,
			title: resource.name,
			subtitle: `Resource · ${resource.serverName}${resource.mimeType ? ` · ${resource.mimeType}` : ""}`,
			serverId: resource.serverId,
			uri: resource.uri,
		})),
		...prompts.map(prompt => ({
			kind: "prompt" as const,
			title: prompt.name,
			subtitle: `Prompt · ${prompt.serverName}${prompt.description ? ` · ${prompt.description}` : ""}`,
			serverId: prompt.serverId,
			name: prompt.name,
		})),
	];

	for (const error of errors) new Notice(error);
	if (!choices.length) {
		new Notice("No MCP resources or prompts are available.");
		return;
	}

	new McpContentModal(app, choices, async choice => {
		const server = servers.find(candidate => candidate.id === choice.serverId);
		if (!server) return;
		try {
			const text = choice.kind === "resource"
				? await readMCPResource(server, choice.uri!)
				: await getMCPPrompt(server, choice.name!);
			if (!text.trim()) {
				new Notice(`${choice.title} returned no text.`);
				return;
			}
			createNode(canvas, {
				pos: {
					// @ts-expect-error canvas coordinates are internal
					x: canvas.x - NODE_WIDTH / 2,
					// @ts-expect-error canvas coordinates are internal
					y: canvas.y,
				},
				size: { height: calcHeight({ text }), width: NODE_WIDTH },
				text,
				focus: false,
			});
		} catch (error) {
			new Notice(`Could not read ${choice.title}: ${error instanceof Error ? error.message : error}`);
		}
	}).open();
};
