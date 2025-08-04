# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

- **`pnpm run dev`**: Compiles the plugin and watches for changes. Uses esbuild in watch mode for active development.
- **`pnpm run build`**: Creates a production build of the plugin. Runs TypeScript type checking then esbuild production build.
- **`pnpm run deploy`**: Builds the plugin and prepares it for a new release using deploy.mjs.
- **`pnpm run version`**: Bumps version and updates manifest.json and versions.json files.

Note: Always use `pnpm` for package management (project uses pnpm@10.8.1).

## Code Architecture

This is an Obsidian plugin that adds AI-powered features to the Canvas view.

- **`AugmentedCanvasPlugin.ts`**: The main entry point for the plugin. It initializes all features, patches, and commands.
- **`src/settings`**: Manages the plugin's settings.
  - `AugmentedCanvasSettings.ts`: Defines the settings data structure.
  - `SettingsTab.ts`: Creates the UI for the settings in Obsidian's settings window.
- **`src/actions`**: Contains the logic for various actions that can be triggered by the user. The subdirectories correspond to where the actions are exposed in the UI:
  - `canvasContextMenuActions`: Actions available when right-clicking the canvas background.
  - `canvasNodeContextMenuActions`: Actions available when right-clicking a node on the canvas.
  - `commands`: Actions available as Obsidian commands.
- **`src/Modals`**: Contains various modal dialogs for user interaction, such as selecting a model or inputting text.
- **`src/utils`**: Contains utility functions.
  - `ai.ts` and `llm.ts`: Core logic for interacting with Large Language Models (LLMs) from different providers.
  - Other files provide helpers for specific functionalities like parsing CSV or handling website content.
- **`src/obsidian`**: Contains code that directly interacts with or patches Obsidian's internal APIs, especially related to the Canvas.
- **`src/openai`**: Contains definitions and configurations for the supported AI models.

## Key Technical Details

- **Build System**: Uses esbuild with TypeScript for fast compilation. Entry point is `src/AugmentedCanvasPlugin.ts`.
- **External Dependencies**: Excludes Obsidian APIs and CodeMirror from bundle. AI SDK packages are bundled.
- **AI Integration**: Uses `@ai-sdk` with multiple providers (OpenAI, Google, etc.) and the `ai` package for streaming.
- **Canvas Patching**: Uses `monkey-around` library to patch Obsidian's internal Canvas APIs for enhanced functionality.
- **Plugin Architecture**: Modular design with actions, modals, settings, and utilities separated into distinct directories.

## Development Priorities

Based on internal project documentation, the key priorities for future development are:
- **Per-Note Model Selection**: Allow users to quickly choose a specific provider/model for an individual note or action. This is a top priority.
- **Custom API Nodes**: Implement a feature where canvas notes can make requests to specific, external API endpoints and handle JSON responses.
- **UI/UX Improvements**: Enhance the user interface and experience.
- **AI SDK Integration**: The project is already using `@ai-sdk`, and further integration is a consideration.

## important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
