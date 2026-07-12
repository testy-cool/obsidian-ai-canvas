export type CanvasNodeData = Record<string, unknown>;

export interface CanvasNodeWithData {
	getData(): CanvasNodeData;
	setData(data: CanvasNodeData): void;
}

export const IMAGE_GENERATION_PROMPT_KEY = "ai_image_prompt";

export const withImageGenerationPrompt = (
	data: CanvasNodeData,
	prompt: string
): CanvasNodeData => ({
	...data,
	[IMAGE_GENERATION_PROMPT_KEY]: prompt,
});

export const getImageGenerationPrompt = (
	data: CanvasNodeData
): string | null => {
	const prompt = data[IMAGE_GENERATION_PROMPT_KEY];
	return typeof prompt === "string" && prompt.trim() ? prompt : null;
};

export const setImageGenerationPrompt = (
	node: CanvasNodeWithData,
	prompt: string
): void => {
	node.setData(withImageGenerationPrompt(node.getData(), prompt));
};
