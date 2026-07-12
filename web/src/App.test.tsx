import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";
import { saveCanvasDraft } from "./state/draftStorage";

describe("browser canvas app", () => {
	beforeEach(() => localStorage.clear());

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
