# Obsidian AI Canvas Technical Documentation

This document provides a technical overview of the Obsidian AI Canvas plugin.

**Based on:** This plugin is a fork of [MetaCorp/obsidian-augmented-canvas](https://github.com/MetaCorp/obsidian-augmented-canvas) - thank you to MetaCorp for the original foundation and concept.

## 1. Project Overview

Obsidian AI Canvas is an Obsidian plugin that enhances the functionality of Obsidian Canvas by integrating with various AI language models. It allows users to perform AI-powered actions directly on their notes within the canvas, such as asking questions, generating new content, and creating flashcards. The plugin is designed to be flexible, supporting multiple LLM providers and offering a range of features to augment the user's workflow.

## 2. Key Features

- **AI-Powered Note Actions:**
  - **Ask AI:** Use the content of a note as a prompt for an AI model and receive the response in a new, linked note.
  - **Ask Question:** Pose a question about a note and have the AI-generated answer appear in a new note, with the question as the link.
  - **Generate Questions:** Automatically generate a list of relevant questions based on the content of a note.
- **Image Generation:** Create images from within the canvas context menu.
- **Folder-Based Prompts:** Run a system prompt on an entire folder of notes, consolidating the AI responses into the current canvas.
- **System Prompt Insertion:** Insert pre-defined or custom system prompts into the canvas.
- **Flashcard Creation:** Generate flashcards from notes for use with the Spaced Repetition plugin.
- **Relevant Questions:** Insert AI-generated questions based on your recent activity in Obsidian.
- **Edge Menu Actions:** Regenerate AI responses directly from the edge context menu.
- **Multi-LLM Support:** Configure and use various LLM providers, including OpenAI, Anthropic, Groq, and self-hosted models.

## 3. Architecture

The plugin follows a modular architecture, with a central plugin class (`AugmentedCanvasPlugin`) that manages the lifecycle of the plugin and coordinates the various features. The codebase is organized into the following directories:

- **`actions`:** Contains the logic for the various actions that can be performed on canvas nodes and menus.
- **`modals`:**  Contains the UI for the various modals used by the plugin.
- **`obsidian`:** Contains utility functions and type definitions for interacting with the Obsidian API.
- **`openai`:** Contains the logic for interacting with the OpenAI API.
- **`settings`:** Contains the settings for the plugin, including the settings tab UI.
- **`types`:** Contains custom type definitions for the plugin.
- **`utils`:** Contains utility functions used throughout the plugin.

### 3.1. Frontend

The frontend of the plugin consists of the various UI elements that are added to the Obsidian interface, including:

- **Canvas Menu Items:** The plugin adds several items to the canvas context menu, allowing users to perform AI-powered actions on their notes.
- **Modals:** The plugin uses modals to prompt the user for input, such as when asking a custom question or selecting a system prompt.
- **Settings Tab:** The plugin provides a settings tab that allows users to configure their API keys, select their preferred AI models, and manage other plugin settings.

### 3.2. Backend

The backend of the plugin is responsible for the following:

- **Interacting with the Obsidian API:** The plugin uses the Obsidian API to access and modify the user's notes, as well as to add new UI elements to the Obsidian interface.
- **Interacting with LLM Providers:** The plugin uses the `openai` library to interact with various LLM providers, allowing users to perform AI-powered actions on their notes.
- **Managing Plugin Settings:** The plugin is responsible for loading and saving its settings, which are stored in the user's Obsidian vault.

## 4. Dependencies

### 4.1. Production Dependencies

- **fuse.js (^7.0.0):** A lightweight fuzzy-search library.
- **googleapis (^148.0.0):** Google APIs Node.js client.
- **js-tiktoken (^1.0.8):** A JavaScript library for tokenizing text with tiktoken.
- **monkey-around (^2.3.0):** A library for wrapping and modifying methods.
- **openai (^4.91.1):** The official OpenAI Node.js library.

### 4.2. Development Dependencies

- **@types/node (^16.11.6):** TypeScript type definitions for Node.js.
- **@typescript-eslint/eslint-plugin (5.29.0):** ESLint plugin for TypeScript.
- **@typescript-eslint/parser (5.29.0):** ESLint parser for TypeScript.
- **builtin-modules (3.3.0):** A list of the Node.js builtin modules.
- **esbuild (0.14.47):** An extremely fast JavaScript bundler.
- **obsidian (latest):** The Obsidian API for plugin development.
- **tslib (^2.8.1):** Runtime library for TypeScript helpers.
- **typescript (4.7.4):** The TypeScript compiler.

## 5. Setup and Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/your-username/obsidian-augmented-canvas.git
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Install the plugin in Obsidian:**
   - Use the [Brat](https://github.com/TfTHacker/obsidian42-brat) plugin to install the plugin from the git repository.
   - Alternatively, you can manually build the plugin and copy the `main.js`, `manifest.json`, and `styles.css` files to your Obsidian vault's `.obsidian/plugins/obsidian-augmented-canvas` directory.

## 6. Building the Plugin

- **Development:**

  ```bash
  npm run dev
  ```

  This command uses `esbuild` to watch for changes and automatically rebuild the plugin.

- **Production:**

  ```bash
  npm run build
  ```

  This command uses `tsc` to type-check the code and then `esbuild` to create a production build of the plugin.

## 7. Future Improvements

- **Support for more LLM providers:** The plugin can use multiple models and providers as long as the LiteLLM LLM Proxy Gateway suppoerts them. So we don't need to worry about adding extra providers/models. The user has currently set the base api url as their gateway so we don't need to worry about additional providers yet. But it would be great if we could use AI SDK by Vercel, I hear it's good
  - but we od want to be able to quickly choos other provider/model to be used per box/note, because sometimes you want other LLMs. This is top priority!
- **Notes that run specific api endpoint requests, because we need it for some projects, which will return json - this won't be via the gateway we are currently using
- **Improved UI/UX:** The plugin's UI/UX could be improved to make it more user-friendly and intuitive.
- **More robust error handling:** The plugin's error handling could be improved to make it more resilient to errors.
- **More comprehensive test suite:** The plugin could be extended with a more comprehensive test suite to ensure that it is working as expected.
- **Lightweight canvas alignment tools:** Add a button/command that gently aligns selected nodes without disrupting intentional layout.
- **Auto-resize nodes with guardrails:** Resize note rectangles to fit text up to a reasonable limit (e.g., cap at ~100 lines, then allow manual resizing).
