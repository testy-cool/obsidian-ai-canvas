import { expect, test } from "@playwright/test";

test("edits a canvas and exposes exact AI prompt controls", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 960 });
	await page.goto("/");
	await expect(page.getByRole("textbox", { name: "Canvas name" })).toHaveValue("Welcome");
	await expect(page.locator("[data-canvas-node-id]")).toHaveCount(5);
	const edgeLabels = page.locator(".canvas-edge-label");
	await expect(edgeLabels).toHaveCount(2);
	for (const label of await edgeLabels.all()) {
		expect((await label.boundingBox())?.width).toBeLessThan(260);
	}
	await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
	await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
	await page.screenshot({ path: "/tmp/obsidian-ai-canvas-canvas.png", fullPage: true });

	const imageCard = page.locator("[data-canvas-node-id='generated-preview']");
	await imageCard.click({ button: "right" });
	await page.getByRole("menuitem", { name: "View image prompt" }).click();
	await expect(page.getByRole("textbox", { name: "Image generation prompt" })).toContainText("lavender ink on charcoal");
	await page.getByRole("button", { name: "Close dialog" }).click();

	await page.getByRole("button", { name: "Add text card" }).click();
	await expect(page.locator("[data-canvas-node-id]")).toHaveCount(6);
	await expect(page.getByText("Unsaved")).toBeVisible();
	const download = page.waitForEvent("download");
	await page.getByRole("button", { name: "Export portable ZIP" }).click();
	expect((await download).suggestedFilename()).toBe("Welcome.zip");

	const contextCard = page.locator("[data-canvas-node-id='context-note']");
	await contextCard.click({ button: "right" });
	await page.getByRole("menuitem", { name: "Ask AI" }).click();
	await expect(page.getByRole("textbox", { name: "Exact prompt sent to the API" })).toContainText("Context is visible");
	await expect(page.getByRole("checkbox")).toHaveCount(2);
	await page.screenshot({ path: "/tmp/obsidian-ai-canvas-desktop.png", fullPage: true });
});

test("fits the browser canvas controls on a narrow screen", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");
	await expect(page.getByRole("button", { name: "Add text card" })).toBeVisible();
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	expect(overflow).toBeLessThanOrEqual(0);
	await page.screenshot({ path: "/tmp/obsidian-ai-canvas-mobile.png", fullPage: true });
	await page.getByRole("button", { name: "Configure AI" }).click();
	await expect(page.getByRole("button", { name: "Fetch models" })).toBeVisible();
	const body = page.locator(".modal-body");
	await body.hover();
	await page.mouse.wheel(0, 600);
	await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(80);
	const modalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	expect(modalOverflow).toBeLessThanOrEqual(0);
	await page.screenshot({ path: "/tmp/obsidian-ai-canvas-mobile-settings.png", fullPage: true });
});

test("drags the jsoncanvas.org link card from its main surface", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 960 });
	await page.goto("/");
	const card = page.locator("[data-canvas-node-id='spec-link']");
	const before = await card.boundingBox();
	expect(before).not.toBeNull();
	await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
	await page.mouse.down();
	await page.mouse.move(before!.x + before!.width / 2 + 120, before!.y + before!.height / 2 + 70, { steps: 8 });
	await page.mouse.up();
	const after = await card.boundingBox();
	expect(after).not.toBeNull();
	expect(Math.abs(after!.x - before!.x)).toBeGreaterThan(80);
	expect(Math.abs(after!.y - before!.y)).toBeGreaterThan(40);
});

test("offers connected node types when an arrow is dropped on empty canvas", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 960 });
	await page.goto("/");
	const card = page.locator("[data-canvas-node-id='context-note']");
	await card.hover();
	const handle = card.locator(".react-flow__handle-bottom");
	const start = await handle.boundingBox();
	expect(start).not.toBeNull();
	await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
	await page.mouse.down();
	await page.mouse.move(1180, 865, { steps: 12 });
	await page.mouse.up();

	const menu = page.getByRole("menu", { name: "Create connected card" });
	await expect(menu).toBeVisible();
	await expect(menu.getByRole("menuitem", { name: "Text card" })).toBeVisible();
	await expect(menu.getByRole("menuitem", { name: "Link card" })).toBeVisible();
	await expect(menu.getByRole("menuitem", { name: "File or image" })).toBeVisible();
	await page.screenshot({ path: "/tmp/obsidian-ai-canvas-connection-menu.png", fullPage: true });
	const edgeCount = await page.locator(".react-flow__edge").count();
	await menu.getByRole("menuitem", { name: "Text card" }).click();
	await expect(page.locator("[data-canvas-node-id]")).toHaveCount(6);
	await expect(page.locator(".react-flow__edge")).toHaveCount(edgeCount + 1);
});

test("starts an edge drag from the expanded area around a connection dot", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 960 });
	await page.goto("/");
	const card = page.locator("[data-canvas-node-id='spec-link']");
	await card.hover();
	const handle = card.locator(".react-flow__handle-top");
	const box = await handle.boundingBox();
	expect(box).not.toBeNull();
	const grabPoint = { x: box!.x + box!.width / 2, y: box!.y - 6 };
	const hitsHandle = await page.evaluate(({ x, y }) => {
		const target = document.elementFromPoint(x, y);
		return target instanceof Element && Boolean(target.closest(".canvas-handle"));
	}, grabPoint);
	expect(hitsHandle).toBe(true);

	await page.mouse.move(grabPoint.x, grabPoint.y);
	await page.mouse.down();
	await page.mouse.move(1180, 865, { steps: 12 });
	await page.mouse.up();
	await expect(page.getByRole("menu", { name: "Create connected card" })).toBeVisible();
});

test("changes a selected edge color, pattern, and thickness", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 960 });
	await page.goto("/");
	const edge = page.locator("[data-testid='rf__edge-welcome-context']");
	await edge.locator(".react-flow__edge-interaction").click({ force: true });
	await expect(page.getByRole("textbox", { name: "Edge label" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Use dashed edge" })).toBeVisible();
	await page.getByRole("button", { name: "Use edge color 4" }).click();
	await page.getByRole("button", { name: "Use dashed edge" }).click();
	await page.getByRole("button", { name: "Use thick edge" }).click();

	await expect(edge.locator(".react-flow__edge-path")).toHaveAttribute("style", /stroke-dasharray: 10,? 7;.*stroke-width: 4/);
	await expect.poll(() => page.evaluate(() => {
		const draft = JSON.parse(localStorage.getItem("obsidian-ai-canvas:web-draft") ?? "null");
		return draft?.canvas?.edges?.find((candidate: { id?: string }) => candidate.id === "welcome-context") ?? null;
	})).toMatchObject({ color: "4", web_line_style: "dashed", web_line_width: 4 });
	await page.screenshot({ path: "/tmp/obsidian-ai-canvas-edge-style.png", fullPage: true });
});

test("keeps the selected edge appearance editor inside a narrow viewport", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");
	const edge = page.locator("[data-testid='rf__edge-welcome-context']");
	await edge.locator(".react-flow__edge-interaction").click({ force: true });
	const editor = page.locator(".canvas-edge-label.is-selected");
	await expect(editor).toBeVisible();
	const bounds = await editor.boundingBox();
	expect(bounds).not.toBeNull();
	expect(bounds!.x).toBeGreaterThanOrEqual(0);
	expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	expect(overflow).toBeLessThanOrEqual(0);
	await page.screenshot({ path: "/tmp/obsidian-ai-canvas-edge-style-mobile.png", fullPage: true });
});

test("scrolls the AI provider settings body on a short viewport", async ({ page }) => {
	await page.setViewportSize({ width: 800, height: 600 });
	await page.goto("/");
	await page.getByRole("button", { name: "Configure AI" }).click();
	const body = page.locator(".modal-body");
	await expect(body).toBeVisible();
	await body.hover();
	await page.mouse.wheel(0, 700);
	await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
	await expect(page.getByRole("button", { name: "Save settings" })).toBeVisible();
	await page.screenshot({ path: "/tmp/obsidian-ai-canvas-provider-settings.png", fullPage: true });
});

test("fetches provider models in the real settings UI", async ({ page }) => {
	await page.setViewportSize({ width: 1000, height: 800 });
	await page.route("https://provider.example/v1/models", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ data: [{ id: "provider-text-model" }, { id: "provider-image-model" }] }),
		});
	});
	await page.goto("/");
	await page.getByRole("button", { name: "Configure AI" }).click();
	await page.getByRole("textbox", { name: "Base URL" }).fill("https://provider.example/v1");
	await page.locator("input[aria-label='API key']").fill("browser-secret");
	await page.getByRole("button", { name: "Fetch models" }).click();
	await expect(page.getByText("2 models found")).toBeVisible();
	await expect(page.locator("datalist option")).toHaveCount(2);
	await page.getByRole("combobox", { name: "Model ID", exact: true }).fill("custom-deployment-id");
	await expect(page.getByRole("combobox", { name: "Model ID", exact: true })).toHaveValue("custom-deployment-id");
	await page.screenshot({ path: "/tmp/obsidian-ai-canvas-fetched-models.png", fullPage: true });
});

test("renders a whole fenced HTML document in an isolated browser frame", async ({ page }) => {
	await page.setViewportSize({ width: 1100, height: 760 });
	await page.goto("/");
	await page.evaluate(() => {
		localStorage.setItem("obsidian-ai-canvas:web-draft", JSON.stringify({
			name: "HTML canvas",
			canvas: {
				nodes: [{
					id: "html-card",
					type: "text",
					text: "```<html>\n<head><style>body{margin:0;padding:32px;background:#172031;color:#eef}h1{font:700 32px sans-serif}</style></head><body><h1>Rendered document</h1></body></html>\n```",
					x: 0,
					y: 0,
					width: 520,
					height: 320,
				}],
				edges: [],
			},
		}));
	});
	await page.reload();
	const preview = page.locator("iframe[title='HTML preview']");
	await expect(preview).toHaveAttribute("sandbox", "");
	await expect(page.frameLocator("iframe[title='HTML preview']").getByRole("heading", { name: "Rendered document" })).toBeVisible();
	await page.screenshot({ path: "/tmp/obsidian-ai-canvas-html-preview.png", fullPage: true });
});
