/**
 * Absolute path of a vault folder. `folder` is the vault-relative path Obsidian
 * gives, where the vault root is "/" or an empty string.
 */
export const canvasFolderPath = (basePath: string, folder: string): string => {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const path = require("path");
	return path.resolve(path.join(basePath, folder.replace(/^\/+/, "")));
};
