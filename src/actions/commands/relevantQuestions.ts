import { App, Notice } from "obsidian";
import { AugmentedCanvasSettings } from "../../settings/AugmentedCanvasSettings";
import { getFilesContent } from "../../obsidian/fileUtil";
import { getResponse } from "../../utils/llm";
import { createCanvasGroup } from "../../utils";

const RELEVANT_QUESTION_SYSTEM_PROMPT = `
There must be 6 questions.

You must respond in this JSON format: {
	"questions": The questions
}

You must respond in the language the user used.
`.trim();

export const handleAddRelevantQuestions = async (
	app: App,
	settings: AugmentedCanvasSettings
) => {
	new Notice("Generating relevant questions...");

	const files = await app.vault.getMarkdownFiles();

	const sortedFiles = files.sort((a, b) => b.stat.mtime - a.stat.mtime);

	const actualFiles = sortedFiles.slice(
		0,
		settings.insertRelevantQuestionsFilesCount
	);
	console.log({ actualFiles });

	const filesContent = await getFilesContent(app, actualFiles);

	const provider = settings.providers.find(p => p.id === settings.activeProvider);
	if (!provider) {
		new Notice("No active provider found. Please check your settings.");
		return;
	}

	const aiResponse = await getResponse(
		provider,
		[
			{
				role: "system",
				content: `
${settings.relevantQuestionsSystemPrompt}
${RELEVANT_QUESTION_SYSTEM_PROMPT}
`,
			},
			{
				role: "user",
				content: filesContent,
			},
		],
		{ isJSON: true }
	);
	// console.log({ aiResponse });

	await createCanvasGroup(app, "Questions", aiResponse.questions);

	new Notice("Generating relevant questions done successfully.");
};
