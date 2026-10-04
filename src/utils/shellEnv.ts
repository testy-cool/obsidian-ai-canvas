import { logDebug } from "../logDebug";

const MARKER = "__AI_CANVAS_PATH__";

/** Pull the PATH out of the shell's output, ignoring anything its startup files print. */
export const readMarkedPath = (stdout: string): string | null => {
	const match = stdout.match(new RegExp(`${MARKER}(.*)${MARKER}`));
	return match && match[1].trim() ? match[1].trim() : null;
};

let cached: Promise<NodeJS.ProcessEnv> | null = null;

/**
 * The environment to start a local command with.
 *
 * Obsidian started from the desktop menu gets the desktop PATH, not the one
 * the user's shell sets up. Version managers such as fnm and nvm only add
 * their Node in the shell, so a command like `pi` then runs on the system
 * Node and fails. Ask the login shell for its PATH once and use that. Falls
 * back to Obsidian's own environment when the shell does not answer.
 */
export const getCliEnv = (): Promise<NodeJS.ProcessEnv> => {
	if (cached) return cached;
	cached = new Promise(resolve => {
		const shell = process.platform !== "win32" ? process.env.SHELL : undefined;
		if (!shell) {
			resolve(process.env);
			return;
		}
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { execFile } = require("child_process");
		const child = execFile(
			shell,
			["-ilc", `printf '\\n${MARKER}%s${MARKER}\\n' "$PATH"`],
			{ timeout: 5_000, maxBuffer: 1024 * 1024 },
			(error: Error | null, stdout: string) => {
				const shellPath = readMarkedPath(stdout ?? "");
				if (!shellPath) {
					logDebug("[CLI] could not read the shell PATH, using Obsidian's", error?.message);
					resolve(process.env);
					return;
				}
				resolve({ ...process.env, PATH: shellPath });
			}
		);
		child.stdin?.end();
	});
	return cached;
};
