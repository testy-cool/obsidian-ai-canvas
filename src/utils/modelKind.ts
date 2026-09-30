/** What a model produces. Left unset, the plugin guesses from the model name. */
export type ModelKind = "text" | "image";

/**
 * The guess used when a model is left on Auto. It only knows the image
 * families on Azure and Gemini; any other model has to be marked Image.
 */
export const guessImageModel = (providerType: string, modelId: string): boolean => {
	const normalizedType = providerType.toLowerCase();
	const normalizedModel = modelId.toLowerCase();
	if (normalizedType === "azure") {
		return normalizedModel.includes("gpt-image") || normalizedModel.includes("dall-e");
	}
	if (normalizedType !== "gemini" && normalizedType !== "google") return false;
	return (
		normalizedModel.includes("nano-banana") ||
		normalizedModel.includes("imagen") ||
		normalizedModel.includes("image")
	);
};

export const isImageModel = (providerType: string, model: { model: string; kind?: ModelKind }): boolean =>
	model.kind ? model.kind === "image" : guessImageModel(providerType, model.model);
