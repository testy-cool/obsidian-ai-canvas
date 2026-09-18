# Obsidian AI Canvas — Technical Architecture & Codebase Map

> **Current Version:** `0.3.11`  
> **Target Environment:** Obsidian (Electron / Node.js / Web APIs)  
> **Package Manager:** `pnpm` (pnpm@10.8.1)  
> **Build System:** `esbuild` + TypeScript `tsc -noEmit`  
> **Test Framework:** `vitest` (14 test files, 88+ passing tests)  
> **Local Deployment Vault:** `/home/testycool/Obsidian-New/.obsidian/plugins/obsidian-ai-canvas`

---

## 1. Executive Overview

**Obsidian AI Canvas** transforms Obsidian's native Canvas into an AI-augmented workspace. It enables users to treat canvas notes, images, and folders as context-aware nodes that can trigger LLM generation, execute MCP (Model Context Protocol) tools, run local non-interactive Codex CLI sessions, render live interactive HTML previews, and trace generations via Langfuse observability.

The plugin interacts with Obsidian's internal Canvas APIs using [`monkey-around`](https://github.com/pjeby/monkey-around), maintains conversational node trees, and connects to AI models via Vercel's `@ai-sdk` (`@ai-sdk/google`, `@ai-sdk/openai`, `@ai-sdk/mcp`, and `ai`).

---

## 2. Directory & Module Map (Fast Lookup)

```
obsidian-ai-canvas/
├── src/
│   ├── AugmentedCanvasPlugin.ts             # Plugin entrypoint: lifecycle, settings migration, patch registration
│   ├── logDebug.ts                         # Debug logging utility tied to settings.debug
│   ├── utils.ts                            # Core canvas node/group creators, image node placement, indicator helpers
│   ├── actions/
│   │   ├── canvasNodeMenuActions/
│   │   │   ├── noteGenerator.ts            # Central AI generation engine (streaming, resizing, MCP tools, reasoning)
│   │   │   ├── advancedCanvas.ts           # Canvas card toolbar buttons (Ask AI, Model Select, Regenerate)
│   │   │   └── titleGenerator.ts           # Auto card title and group name generation
│   │   ├── canvasNodeContextMenuActions/
│   │   │   ├── generateImage.ts            # Image generation via Imagen 3 / DALL-E
│   │   │   └── flashcards.ts               # Flashcard generation for Spaced Repetition plugin
│   │   ├── canvasContextMenuActions/
│   │   │   └── flashcards.ts               # Canvas background right-click actions
│   │   └── commands/
│   │       ├── insertSystemPrompt.ts       # Command palette: insert system prompt node
│   │       ├── relevantQuestions.ts        # Command palette: insert AI contextual questions
│   │       ├── runPromptFolder.ts          # Command palette: batch run prompt on vault folder
│   │       ├── websiteContent.ts           # Command palette: fetch webpage text into canvas card
│   │       └── youtubeCaptions.ts          # Command palette: fetch YouTube video transcript into canvas card
│   ├── Modals/
│   │   ├── UnifiedProviderModal.ts         # Modal: add/edit provider and configure API keys/endpoints
│   │   ├── ModelSelectionModal.ts          # Modal: pick provider & model for on-demand execution
│   │   ├── PromptContextModal.ts           # Modal: select which ancestor nodes to include in context
│   │   ├── CustomQuestionModal.ts          # Modal: user prompt input
│   │   ├── FolderSuggestModal.ts           # Modal: folder picker for batch actions
│   │   ├── InputModal.ts                   # Modal: generic text input
│   │   └── SystemPromptsModal.ts           # Modal: select pre-made system prompt from library
│   ├── obsidian/
│   │   ├── canvas-internal.d.ts            # TypeScript definitions for Obsidian's unexposed Canvas internals
│   │   ├── canvas-patches.ts               # monkey-around patches: menu render, multi-tab discovery, node positioning
│   │   ├── canvasUtil.ts                   # Ancestor tree traversal and prompt context collection
│   │   ├── fileUtil.ts                     # Vault file read/write, image conversion, binary base64
│   │   └── imageUtils.ts                   # Image dimension and media helpers
│   ├── settings/
│   │   ├── AugmentedCanvasSettings.ts      # Settings interface, default values, schema migrations
│   │   └── SettingsTab.ts                  # Multi-section tabbed settings UI with debounced search
│   ├── styles/
│   │   └── settings.css                    # Settings tab styles
│   └── utils/
│       ├── ai.ts                           # AI SDK provider setup, streamResponse, getResponse, token usage
│       ├── llm.ts                          # High-level LLM router (delegates to ai.ts or codexCli.ts)
│       ├── codexCli.ts                     # Local OpenAI Codex CLI runner (non-interactive sandbox execution)
│       ├── mcpClient.ts                    # Model Context Protocol SSE/stdio client & AI SDK tool conversion
│       ├── htmlPreview.ts                  # Interactive HTML code block previewer & mutation persistence
│       ├── observability.ts                # Langfuse generation tracing client
│       ├── modelFetch.ts                   # Dynamic model discovery from provider API endpoints
│       ├── pricingFetch.ts                 # Dynamic token pricing fetcher from OpenRouter / LiteLLM
│       ├── providerParams.ts               # Model parameters (temperature, maxTokens, thinking budget)
│       ├── websiteContentUtils.ts          # Web scraping & markdown conversion
│       ├── csvUtils.ts                     # Parsing built-in prompt collections
│       └── imageGenerationPrompt.ts        # Image prompt storage and retrieval on canvas nodes
├── test/                                   # Vitest automated test suite (14 test files)
├── assets/                                 # Icons and static resources
├── deploy.mjs                              # Script to copy build artifacts to active local vault
├── esbuild.config.mjs                      # esbuild build configuration for dev and production
├── manifest.json                           # Obsidian plugin manifest (id, name, version, minAppVersion)
├── versions.json                           # Obsidian plugin release version compatibility map
└── package.json                            # Scripts, dependencies, and metadata
```

---

## 3. Core Architectural Workflows

### 3.1. Plugin Initialization & Canvas Patching
File: `src/AugmentedCanvasPlugin.ts`

1. **`onload()`**:
   - Loads settings via `loadSettings()` with automated schema migrations.
   - Initializes `ObservabilityClient` (Langfuse integration).
   - Registers `SettingsTab`.
   - Waits for `app.workspace.onLayoutReady()` before installing UI patches.
2. **`patchCanvasMenu()`**:
   - Uses `findCanvasMenuHost(leaves)` in `src/obsidian/canvas-patches.ts` to locate the active, rendered canvas view. *(Critical: Obsidian defers background canvas tabs; `findCanvasMenuHost` ensures the patch is bound to an active canvas with an initialized menu).*
   - Patches `menu.render` via `monkey-around`:
     - Clears previous `.ai-menu-item` elements.
     - If a single node is selected: adds **Ask AI** (`lucide-sparkles`), **Ask AI (Select Model)** (`lucide-brain-circuit`), and **Ask Question** (`lucide-help-circle`).
     - If an edge is selected: checks `edge.unknownData.isGenerated` and adds **Regenerate Response** (`lucide-rotate-cw`).
3. **Persistence Hooks**:
   - `setupCanvasIndicatorPersistence(app)`: Watches `active-leaf-change` and `layout-change` to re-attach model badges (`provider • model`) on AI-generated cards.
   - `setupHtmlPreviewPersistence(app)`: Watches for cards containing ````html code blocks and ensures interactive preview frames are mounted and updated.

---

### 3.2. Note Generation & Context Traversal Pipeline
File: `src/actions/canvasNodeMenuActions/noteGenerator.ts`

When the user clicks "Ask AI":
1. **Target Node & Ancestor Traversal**:
   - Resolves the active node. Calls `collectNodeAndAncestors(node)` in `src/obsidian/canvasUtil.ts`.
   - If there are multiple ancestor nodes, displays `PromptContextModal` allowing the user to select/deselect specific ancestor notes from conversational context.
   - Walks edges backward to construct `messages: Array<{ role: 'user' | 'assistant' | 'system', content: string }>` conforming to the chat hierarchy.
2. **Directional Placement & Node Creation**:
   - Evaluates incoming edge direction using `getIncomingEdgeDirection(node)` (inspects `toSide` properties).
   - Positions the new response card opposite to incoming arrows (e.g. if an arrow comes from the left, generate to the right) using `createNode()`.
   - Creates a placeholder node and an edge labeled with the prompt or action.
3. **Streaming & Dynamic Layout**:
   - Calls `streamResponse()` in `src/utils/llm.ts`.
   - Streams chunks into `created.setText()`.
   - Periodically recalculates optimal dimensions maintaining a **3:5 aspect ratio** (`calculateNoteDimensions`) and calls `created.moveAndResize()` + `created.canvas.requestFrame()`.
   - Renders expandable `<details>` blocks for model reasoning deltas.
   - If MCP tools are triggered, renders real-time tool execution status pills (`🔧 toolName`, `⏳ Running...`, `✓ Result`).
   - On completion: writes `nodeData.ai_model` and `nodeData.ai_provider`, renders subtle model indicator, triggers auto-title generation if enabled, and mounts HTML preview if HTML code fences are detected.

---

### 3.3. LLM Provider Routing & AI SDK Integration
Files: `src/utils/ai.ts`, `src/utils/llm.ts`

The plugin supports:
* **Direct Cloud Providers**: OpenAI, Google Gemini (`@ai-sdk/google`), Anthropic.
* **Gateways & Proxies**: Bifrost, OpenRouter, LiteLLM, Groq.
* **Local Models**: Ollama (`http://localhost:11434`), LM Studio, custom OpenAI-compatible endpoints.
* **Local Codex CLI**: Spawns locally installed OpenAI Codex CLI (`codex exec`) in read-only sandbox mode via `src/utils/codexCli.ts`.

**Error Normalization**:
Network and API errors (such as `AI_APICallError`, 401, 403 virtual key restrictions, 429 quota exhaustion) are unwrapped from nested SDK responses (`error.cause`, `error.responseBody`, `error.data.error.message`) and printed directly onto the canvas card so the user immediately understands why a request failed without opening DevTools.

---

### 3.4. Model Context Protocol (MCP) Integration
File: `src/utils/mcpClient.ts`

* Connects to MCP servers configured in Settings → MCP (SSE transport or local stdio).
* `getAllMCPTools(servers)` queries remote server capabilities and maps tool definitions to Vercel AI SDK compatible tool schemas (`zod`).
* Allows LLM models (e.g. Claude 3.7 / GPT-4o / Gemini 2.5) to invoke multi-step tools autonomously during canvas note generation.
* Tool calls and results stream live onto the canvas card before the final markdown response.

---

### 3.5. Live Interactive HTML Previews
File: `src/utils/htmlPreview.ts`

* Scans node content for ````html ... ```` fences using `extractHtmlCodeBlocks`.
* Mounts a responsive, sandboxed `<iframe>` container directly within the canvas node DOM (`contentEl`).
* Features:
  * Preview toggle button on the card.
  * Auto-preview on completion (configurable via `settings.autoPreviewHtml`).
  * Automatic cleanup if fences are deleted or edited.
  * Native toolbar alignment and resize observer handling.

---

### 3.6. Settings Tab Architecture
File: `src/settings/SettingsTab.ts`

* Split into 8 distinct sections accessible via an icon navigation bar:
  1. **Providers** (`lucide-server`)
  2. **Models** (`lucide-cpu`)
  3. **MCP Servers** (`lucide-wrench`)
  4. **Generation** (`lucide-sparkles`)
  5. **Images** (`lucide-image`)
  6. **Card Naming** (`lucide-tag`)
  7. **Prompts** (`lucide-file-text`)
  8. **Observability** (`lucide-activity`)
* **Instant Filter**: Cross-section debounced search input that searches across all setting titles and descriptions simultaneously, showing matching rows and hiding empty sections.

---

## 4. Canvas Data & Node Schema

Obsidian Canvas stores data in JSON format (`*.canvas`). The plugin attaches metadata to `node.unknownData`:

```typescript
// Canvas Node unknownData properties used by obsidian-ai-canvas:
interface AIUnknownData {
    ai_provider?: string;         // e.g. "openai", "gemini", "bifrost", "Codex"
    ai_model?: string;            // e.g. "gpt-4o", "gemini-2.5-pro", "default"
    isGenerated?: boolean;        // true if node or edge was produced by AI Canvas
    imagePrompt?: string;         // prompt used to generate image if image node
    questions?: string[];         // AI-generated follow-up questions
}
```

Edges connecting prompt nodes to generated response nodes carry `unknownData.isGenerated = true`, which enables the **Regenerate Response** button on the edge context menu.

---

## 5. Development, Testing, and Deployment Commands

Always use `pnpm`:

```bash
# 1. Install dependencies
pnpm install

# 2. Run automated test suite (Vitest - 14 test files, <2s)
pnpm test

# 3. Watch tests during development
pnpm run test:watch

# 4. Build for development (esbuild watch mode)
pnpm run dev

# 5. Type-check with tsc and create production bundle (main.js)
pnpm run build

# 6. Deploy build directly to local active test vault
pnpm run deploy

# 7. Bump version in manifest.json, package.json, and versions.json
pnpm run version
```

### Emergency Release One-Liner
From `CLAUDE.md`:
```bash
pnpm run build && git add -A && git commit -m "X.Y.Z: description" && git push && git tag X.Y.Z && git push origin X.Y.Z && gh release create X.Y.Z main.js manifest.json --title "X.Y.Z" --notes "description"
```

---

## 6. Critical Rules & Engineering Constraints

1. **Monkey-Patch Safety**:
   * Never patch `Canvas.prototype` directly without using `monkey-around`.
   * Never assume the first leaf from `app.workspace.getLeavesOfType("canvas")` has an active menu. Always use `findCanvasMenuHost(leaves)` to avoid breaking when multiple canvas tabs are open.
2. **DOM & UI Typography Standards**:
   * **Never use font sizes smaller than 12px** (`text-xs` / `12px` minimum). Captions, badges, and metadata must adhere to accessibility readability standards.
   * Use Obsidian theme CSS variables (`var(--text-normal)`, `var(--text-muted)`, `var(--background-primary)`, etc.) rather than hardcoded hex codes.
3. **Canvas Geometry**:
   * All programmatic node resizing should respect the **3:5 aspect ratio** (`calculateNoteDimensions` in `noteGenerator.ts`) to maintain visual consistency across cards.
   * Always call `canvas.requestSave()` and `canvas.requestFrame()` after mutating nodes or edges.
4. **Secret Hygiene**:
   * API keys and tokens reside in Obsidian's `data.json` inside the vault. Never commit vault data, `.env` files, or test tokens to git.
