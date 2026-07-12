import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { saveCanvasDraft } from "./state/draftStorage";

describe("browser canvas app", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		localStorage.clear();
	});

	it("opens as a complete canvas workspace", async () => {
		const { container } = render(<App />);
		expect(screen.getByRole("textbox", { name: "Canvas name" })).toHaveValue("Welcome");
		expect(screen.getByRole("button", { name: "Open canvas" })).toBeVisible();
		expect(screen.getByRole("button", { name: "Save canvas" })).toBeVisible();
		expect(screen.getByRole("button", { name: "Add text card" })).toBeVisible();
		await waitFor(() => expect(container.querySelectorAll("[data-canvas-node-id]").length).toBeGreaterThan(0));
	});

	it("recovers the last browser draft after a refresh", () => {
		saveCanvasDraft(localStorage, {
			name: "Recovered work",
			canvas: { nodes: [{ id: "draft", type: "text", text: "Still here", x: 0, y: 0, width: 300, height: 180 }], edges: [] },
		});
		const { container } = render(<App />);
		expect(screen.getByRole("textbox", { name: "Canvas name" })).toHaveValue("Recovered work");
		expect(container.querySelector("[data-canvas-node-id='draft']")).not.toBeNull();
	});

	it("adds a text card and enables undo", async () => {
		const user = userEvent.setup();
		const { container } = render(<App />);
		await waitFor(() => expect(container.querySelectorAll("[data-canvas-node-id]").length).toBeGreaterThan(0));
		const before = container.querySelectorAll("[data-canvas-node-id]").length;

		await user.click(screen.getByRole("button", { name: "Add text card" }));

		await waitFor(() => expect(container.querySelectorAll("[data-canvas-node-id]")).toHaveLength(before + 1));
		expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
		expect(screen.getByText("Unsaved")).toBeVisible();
	});

	it("switches between dark and light canvas themes", async () => {
		const user = userEvent.setup();
		const { container } = render(<App />);
		expect(container.firstElementChild).toHaveAttribute("data-theme", "dark");
		await user.click(screen.getByRole("button", { name: "Use light theme" }));
		expect(container.firstElementChild).toHaveAttribute("data-theme", "light");
	});

	it("opens the exact stored image prompt from the card context menu", async () => {
		const user = userEvent.setup();
		const { container } = render(<App />);
		const imageCard = await waitFor(() => {
			const card = container.querySelector("[data-canvas-node-id='generated-preview']");
			expect(card).not.toBeNull();
			return card!;
		});
		fireEvent.contextMenu(imageCard, { clientX: 440, clientY: 260 });
		await user.click(screen.getByRole("menuitem", { name: /view image prompt/i }));
		expect(screen.getByRole("dialog", { name: "Image generation prompt" })).toBeVisible();
		expect((screen.getByRole("textbox", { name: "Image generation prompt" }) as HTMLTextAreaElement).value).toContain("lavender ink on charcoal");
	});

	it("opens local AI provider settings without a guessed model", async () => {
		const user = userEvent.setup();
		render(<App />);
		await user.click(screen.getByRole("button", { name: "Configure AI" }));
		expect(screen.getByRole("dialog", { name: "AI provider" })).toBeVisible();
		expect(screen.getByRole("textbox", { name: "Model ID" })).toHaveValue("");
	});

	it("offers Azure OpenAI as a provider", async () => {
		const user = userEvent.setup();
		render(<App />);
		await user.click(screen.getByRole("button", { name: "Configure AI" }));
		expect(screen.getByRole("option", { name: "Azure OpenAI" })).toBeVisible();
	});

	it("replaces a known Azure endpoint when switching to Gemini", async () => {
		const user = userEvent.setup();
		render(<App />);
		await user.click(screen.getByRole("button", { name: "Configure AI" }));
		const protocol = screen.getByRole("combobox", { name: "API protocol" });
		const baseUrl = screen.getByRole("textbox", { name: "Base URL" });
		await user.selectOptions(protocol, "azure");
		await user.type(baseUrl, "https://resource.openai.azure.com/openai/v1");
		await user.selectOptions(protocol, "gemini");
		expect(baseUrl).toHaveValue("https://generativelanguage.googleapis.com/v1beta");
	});

	it("fetches models from the selected provider", async () => {
		const user = userEvent.setup();
		const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
			data: [{ id: "provider-text-model" }, { id: "provider-image-model" }],
		}), { status: 200, headers: { "Content-Type": "application/json" } }));
		render(<App />);
		await user.click(screen.getByRole("button", { name: "Configure AI" }));
		await user.clear(screen.getByRole("textbox", { name: "Base URL" }));
		await user.type(screen.getByRole("textbox", { name: "Base URL" }), "https://provider.example/v1");
		await user.type(screen.getByLabelText("API key"), "secret");
		await user.click(screen.getByRole("button", { name: "Fetch models" }));

		await waitFor(() => expect(screen.getByText("2 models found")).toBeVisible());
		expect(document.querySelector("datalist option[value='provider-text-model']")).toHaveTextContent("provider-text-model");
		expect(fetcher).toHaveBeenCalledWith("https://provider.example/v1/models", expect.objectContaining({
			headers: expect.objectContaining({ Authorization: "Bearer secret" }),
		}));
	});

	it("fetches Gemini models from the native models endpoint", async () => {
		const user = userEvent.setup();
		const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
			models: [{
				name: "models/gemini-provider-model",
				displayName: "Gemini provider model",
				supportedGenerationMethods: ["generateContent"],
			}],
		}), { status: 200, headers: { "Content-Type": "application/json" } }));
		render(<App />);
		await user.click(screen.getByRole("button", { name: "Configure AI" }));
		await user.selectOptions(screen.getByRole("combobox", { name: "API protocol" }), "gemini");
		await user.type(screen.getByLabelText("API key"), "gemini-secret");
		await user.click(screen.getByRole("button", { name: "Fetch models" }));

		await waitFor(() => expect(screen.getByText("1 model found")).toBeVisible());
		expect(document.querySelector("datalist option[value='models/gemini-provider-model']")).toHaveTextContent("Gemini provider model");
		expect(fetcher).toHaveBeenCalledWith(
			"https://generativelanguage.googleapis.com/v1beta/models?key=gemini-secret",
			expect.objectContaining({ method: "GET" })
		);
	});

	it("fetches Azure models with the api-key header", async () => {
		const user = userEvent.setup();
		const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
			data: [{ id: "azure-deployment" }],
		}), { status: 200, headers: { "Content-Type": "application/json" } }));
		render(<App />);
		await user.click(screen.getByRole("button", { name: "Configure AI" }));
		await user.selectOptions(screen.getByRole("combobox", { name: "API protocol" }), "azure");
		await user.clear(screen.getByRole("textbox", { name: "Base URL" }));
		await user.type(screen.getByRole("textbox", { name: "Base URL" }), "https://resource.openai.azure.com/openai/v1");
		await user.type(screen.getByLabelText("API key"), "azure-secret");
		await user.click(screen.getByRole("button", { name: "Fetch models" }));

		await waitFor(() => expect(screen.getByText("1 model found")).toBeVisible());
		expect(fetcher).toHaveBeenCalledWith(
			"https://resource.openai.azure.com/openai/v1/models",
			expect.objectContaining({ headers: expect.objectContaining({ "api-key": "azure-secret" }) })
		);
	});

	it("ignores model results from a provider that is no longer selected", async () => {
		const user = userEvent.setup();
		let resolveFetch: (response: Response) => void = () => undefined;
		const pendingResponse = new Promise<Response>((resolve) => { resolveFetch = resolve; });
		vi.spyOn(globalThis, "fetch").mockReturnValue(pendingResponse);
		render(<App />);
		await user.click(screen.getByRole("button", { name: "Configure AI" }));
		await user.type(screen.getByLabelText("API key"), "openai-secret");
		await user.click(screen.getByRole("button", { name: "Fetch models" }));
		await user.selectOptions(screen.getByRole("combobox", { name: "API protocol" }), "gemini");

		await act(async () => {
			resolveFetch(new Response(JSON.stringify({ data: [{ id: "stale-openai-model" }] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}));
			await pendingResponse;
			await Promise.resolve();
		});

		expect(screen.queryByText("1 model found")).not.toBeInTheDocument();
		expect(document.querySelector("datalist option[value='stale-openai-model']")).not.toBeInTheDocument();
	});

	it("renders a whole fenced HTML document in a sandboxed card preview", async () => {
		saveCanvasDraft(localStorage, {
			name: "HTML canvas",
			canvas: {
				nodes: [{
					id: "html-card",
					type: "text",
					text: "```<html>\n<head><style>body{background:#123}</style></head><body><h1>Rendered document</h1></body></html>```",
					x: 0,
					y: 0,
					width: 420,
					height: 280,
				}],
				edges: [],
			},
		});
		render(<App />);

		const preview = await screen.findByTitle("HTML preview");
		expect(preview).toHaveAttribute("sandbox", "");
		expect(preview).toHaveAttribute("srcdoc", expect.stringContaining("<h1>Rendered document</h1>"));
	});

	it("shows selectable ancestor context and the exact prompt before an AI request", async () => {
		const user = userEvent.setup();
		const { container } = render(<App />);
		const currentCard = await waitFor(() => {
			const card = container.querySelector("[data-canvas-node-id='context-note']");
			expect(card).not.toBeNull();
			return card!;
		});
		fireEvent.contextMenu(currentCard, { clientX: 460, clientY: 240 });
		await user.click(screen.getByRole("menuitem", { name: "Ask AI" }));
		expect(screen.getByRole("dialog", { name: "Ask AI" })).toBeVisible();
		expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(1);
		expect((screen.getByRole("textbox", { name: "Exact prompt sent to the API" }) as HTMLTextAreaElement).value).toContain("Context is visible");
		expect(screen.getByRole("button", { name: "Generate response" })).toBeDisabled();
	});

	it("offers image generation from a card with the same selectable context flow", async () => {
		const user = userEvent.setup();
		const { container } = render(<App />);
		const currentCard = await waitFor(() => container.querySelector("[data-canvas-node-id='context-note']")!);
		fireEvent.contextMenu(currentCard, { clientX: 460, clientY: 240 });
		await user.click(screen.getByRole("menuitem", { name: "Generate image" }));
		expect(screen.getByRole("dialog", { name: "Generate image" })).toBeVisible();
		expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(1);
		expect(screen.getByRole("button", { name: "Generate image" })).toBeDisabled();
	});
});
