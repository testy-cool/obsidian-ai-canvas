import fs from "fs";
import path from "path";

const pluginDir = "/mnt/d/Workspaces/Obsidian/Dump/.obsidian/plugins/augmented-canvs";

if (!fs.existsSync(pluginDir)) {
	fs.mkdirSync(pluginDir, { recursive: true });
}

fs.copyFileSync("main.js", path.join(pluginDir, "main.js"));
fs.copyFileSync("manifest.json", path.join(pluginDir, "manifest.json"));
fs.copyFileSync("styles.css", path.join(pluginDir, "styles.css"));

console.log("Plugin files copied successfully.");
