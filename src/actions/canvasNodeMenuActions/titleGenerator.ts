import { App, Notice, setIcon, setTooltip } from "obsidian";
import { CanvasNode } from "../../obsidian/canvas-internal";
import { visitNodeAndAncestors } from "../../obsidian/canvasUtil";
import { readNodeContent } from "../../obsidian/fileUtil";
import { AugmentedCanvasSettings } from "../../settings/AugmentedCanvasSettings";
import { getActiveCanvasNodes } from "../../utils";
import { getResponse } from "../../utils/llm";

const CARD_TITLE_SYSTEM_PROMPT = `
You are naming a canvas card.
Return a short, descriptive title in the same language as the content.
Keep it under 8 words.
Return only the title text with no quotes or markdown.
`.trim();

const GROUP_TITLE_SYSTEM_PROMPT = `
You are naming a canvas group.
Return a short, descriptive name in the same language as the content.
Keep it under 6 words.
Return only the name text with no quotes or markdown.
`.trim();

const MAX_CONTEXT_CARDS = 2;
const MAX_CONTEXT_CHARS = 1200;
const MAX_GROUP_CARD_COUNT = 12;
const MAX_GROUP_CARD_CHARS = 800;
const AUTO_TITLE_MIN_LENGTH = 201;

const truncateText = (text: string, maxLength: number) => {
	const trimmed = text.trim();
	if (trimmed.length <= maxLength) return trimmed;
	return `${trimmed.slice(0, maxLength).trimEnd()}...`;
};

const sanitizeTitle = (value: string) => {
	const firstLine = value.split(/\r?\n/).find(line => line.trim().length > 0) || "";
	let cleaned = firstLine.trim();
	cleaned = cleaned.replace(/^["'`]+|["'`]+$/g, "");
	cleaned = cleaned.replace(/\s+/g, " ");
	return cleaned;
};

const getNodeLabel = (node: CanvasNode) => {
	const data = node.getData() as { label?: string };
	return data?.label?.trim() || "";
};

const applyNodeLabel = async (node: CanvasNode, label: string) => {
	const data = node.getData() as { label?: string };
	node.setData({ ...data, label });
	if (node.labelEl) {
		node.labelEl.setText(label);
	}
	if ("label" in node) {
		// @ts-expect-error - group nodes expose label directly
		node.label = label;
	}
	if (node.canvas) {
		await node.canvas.requestSave();
	}
};

const resolveNamingModel = (
	settings: AugmentedCanvasSettings,
	target: "card" | "group"
) => {
	const providerId =
		target === "card"
			? settings.cardTitleProviderId
			: settings.groupTitleProviderId;
	const modelId =
		target === "card" ? settings.cardTitleModelId : settings.groupTitleModelId;

	const provider =
		settings.providers.find(p => p.id === providerId) ||
		settings.providers.find(p => p.id === settings.activeProvider);
	if (!provider) {
		new Notice("No provider configured for AI naming.");
		return null;
	}

	const enabledModels = settings.models.filter(
		model => model.providerId === provider.id && model.enabled
	);
	const model = enabledModels.find(m => m.id === modelId) || enabledModels[0];
	if (!model) {
		new Notice(`No enabled models found for ${provider.type}.`);
		return null;
	}

	return { provider, model };
};

const buildCardTitlePrompt = async (node: CanvasNode) => {
	const cardText = (await readNodeContent(node))?.trim() || "";
	if (!cardText) return null;

	const context: string[] = [];
	await visitNodeAndAncestors(node, async (current, depth) => {
		if (depth === 0) return true;
		const canvasNode = current as CanvasNode;
		if (canvasNode.getData().type !== "text") return true;
		const text = (await readNodeContent(canvasNode))?.trim() || "";
		if (!text) return true;
		context.push(truncateText(text, MAX_CONTEXT_CHARS));
		return context.length < MAX_CONTEXT_CARDS;
	});

	let prompt = `Card content:\n${truncateText(cardText, MAX_CONTEXT_CHARS)}`;
	if (context.length) {
		const contextLines = context
			.map((text, index) => `Previous card ${index + 1}:\n${text}`)
			.join("\n\n");
		prompt += `\n\n${contextLines}`;
	}
	return prompt;
};

const getGroupCardContents = async (groupNode: CanvasNode) => {
	if (!groupNode.canvas) return [];

	const bounds = {
		left: groupNode.x,
		top: groupNode.y,
		right: groupNode.x + groupNode.width,
		bottom: groupNode.y + groupNode.height,
	};
	const margin = 8;

	const nodesInGroup = groupNode.canvas.nodes
		.filter(node => node.id !== groupNode.id)
		.filter(node => node.getData().type === "text")
		.filter(node => {
			const left = node.x;
			const top = node.y;
			const right = node.x + node.width;
			const bottom = node.y + node.height;
			return (
				left >= bounds.left - margin &&
				top >= bounds.top - margin &&
				right <= bounds.right + margin &&
				bottom <= bounds.bottom + margin
			);
		})
		.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))
		.slice(0, MAX_GROUP_CARD_COUNT);

	const contents: string[] = [];
	for (const node of nodesInGroup) {
		const text = (await readNodeContent(node))?.trim() || "";
		if (text) {
			contents.push(truncateText(text, MAX_GROUP_CARD_CHARS));
		}
	}
	return contents;
};

const buildGroupNamePrompt = (cards: string[]) => {
	const cardLines = cards
		.map((text, index) => `Card ${index + 1}:\n${text}`)
		.join("\n\n");
	return `Group cards:\n${cardLines}`;
};

export const generateCardTitle = async (
	app: App,
	settings: AugmentedCanvasSettings,
	node: CanvasNode,
	{
		force = false,
		minLength = 0,
		showNotices = true,
	}: { force?: boolean; minLength?: number; showNotices?: boolean } = {}
) => {
	if (!settings.enableCardTitleGeneration) {
		if (showNotices) {
			new Notice("AI card title generation is disabled in settings.");
		}
		return;
	}

	if (node.getData().type !== "text") {
		if (showNotices) {
			new Notice("Please select a card node.");
		}
		return;
	}

	const existingLabel = getNodeLabel(node);
	if (existingLabel && !force) {
		return;
	}

	const cardText = (await readNodeContent(node))?.trim() || "";
	if (!cardText) {
		if (showNotices) {
			new Notice("Card is empty.");
		}
		return;
	}

	if (cardText.length < minLength) {
		return;
	}

	const prompt = await buildCardTitlePrompt(node);
	if (!prompt) return;

	const resolved = resolveNamingModel(settings, "card");
	if (!resolved) return;

	try {
		const response = await getResponse(
			resolved.provider,
			[
				{ role: "system", content: CARD_TITLE_SYSTEM_PROMPT },
				{ role: "user", content: prompt },
			],
			{
				model: resolved.model.model,
				max_tokens: 64,
				temperature: settings.temperature,
			}
		);

		const title = sanitizeTitle(String(response || ""));
		if (!title) return;

		await applyNodeLabel(node, title);
	} catch (error) {
		if (showNotices) {
			new Notice(`Error generating card title: ${error.message || error}`);
		}
	}
};

export const maybeAutoGenerateCardTitle = async (
	app: App,
	settings: AugmentedCanvasSettings,
	node: CanvasNode
) => {
	return generateCardTitle(app, settings, node, {
		force: false,
		minLength: AUTO_TITLE_MIN_LENGTH,
		showNotices: false,
	});
};

export const generateGroupName = async (
	app: App,
	settings: AugmentedCanvasSettings,
	node: CanvasNode
) => {
	if (!settings.enableGroupTitleGeneration) {
		new Notice("AI group naming is disabled in settings.");
		return;
	}

	if (node.getData().type !== "group") {
		new Notice("Please select a group.");
		return;
	}

	const groupCards = await getGroupCardContents(node);
	if (!groupCards.length) {
		new Notice("No cards found inside this group.");
		return;
	}

	const resolved = resolveNamingModel(settings, "group");
	if (!resolved) return;

	try {
		const response = await getResponse(
			resolved.provider,
			[
				{ role: "system", content: GROUP_TITLE_SYSTEM_PROMPT },
				{ role: "user", content: buildGroupNamePrompt(groupCards) },
			],
			{
				model: resolved.model.model,
				max_tokens: 64,
				temperature: settings.temperature,
			}
		);

		const title = sanitizeTitle(String(response || ""));
		if (!title) return;

		await applyNodeLabel(node, title);
	} catch (error) {
		new Notice(`Error generating group name: ${error.message || error}`);
	}
};

export const addGenerateCardTitleButton = (
	app: App,
	settings: AugmentedCanvasSettings,
	menuEl: HTMLElement
) => {
	if (!settings.enableCardTitleGeneration) return;

	const buttonEl = createEl("button", "clickable-icon ai-menu-item");
	setTooltip(buttonEl, "Generate card title", { placement: "top" });
	setIcon(buttonEl, "lucide-type");
	menuEl.appendChild(buttonEl);

	buttonEl.addEventListener("click", async () => {
		const nodes = getActiveCanvasNodes(app);
		if (!nodes || nodes.length !== 1) return;
		await generateCardTitle(app, settings, nodes[0], { force: true });
	});
};

export const addGenerateGroupNameButton = (
	app: App,
	settings: AugmentedCanvasSettings,
	menuEl: HTMLElement
) => {
	if (!settings.enableGroupTitleGeneration) return;

	const buttonEl = createEl("button", "clickable-icon ai-menu-item");
	setTooltip(buttonEl, "Generate group name", { placement: "top" });
	setIcon(buttonEl, "lucide-tag");
	menuEl.appendChild(buttonEl);

	buttonEl.addEventListener("click", async () => {
		const nodes = getActiveCanvasNodes(app);
		if (!nodes || nodes.length !== 1) return;
		await generateGroupName(app, settings, nodes[0]);
	});
};
