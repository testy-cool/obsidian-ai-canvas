import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const pluginDir = "/home/testycool/Obsidian-New/.obsidian/plugins/obsidian-ai-canvas";
const pluginId = "obsidian-ai-canvas";

if (!fs.existsSync(pluginDir)) {
	fs.mkdirSync(pluginDir, { recursive: true });
}

fs.copyFileSync("main.js", path.join(pluginDir, "main.js"));
fs.copyFileSync("manifest.json", path.join(pluginDir, "manifest.json"));
fs.copyFileSync("styles.css", path.join(pluginDir, "styles.css"));

console.log("Plugin files copied successfully.");

// Reload the running plugin through the Obsidian CLI (Obsidian 1.12+, enabled in
// Settings > General > Command line interface). Silently skipped when Obsidian is
// not running or the CLI is not enabled.
const reload = spawnSync("obsidian", ["plugin:reload", `id=${pluginId}`], {
	encoding: "utf8",
	timeout: 15000,
});
// The CLI exits 0 even when it is disabled, so inspect the output too.
const output = `${reload.stdout || ""}${reload.stderr || ""}`;
const failed = reload.status !== 0 || reload.error || /not enabled|not running|error/i.test(output);
if (!failed) {
	console.log("Plugin reloaded in Obsidian.");
} else {
	const detail = (output || reload.error?.message || "")
		.split("\n")
		.filter((line) => line && !line.includes("Gtk-WARNING"))
		.join(" ")
		.trim();
	console.log(`Plugin not reloaded (Obsidian CLI unavailable)${detail ? ": " + detail : "."}`);
}
