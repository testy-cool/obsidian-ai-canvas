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
});
