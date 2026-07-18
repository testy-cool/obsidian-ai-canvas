import { describe, expect, it } from "vitest";
import * as settingsModule from "../src/settings/AugmentedCanvasSettings";

const migrate = (settingsModule as any).migrateAutoPreviewHtmlSettings as (
	settings: { autoPreviewHtml: boolean; autoPreviewHtmlMigrated?: boolean }
) => boolean;

describe("HTML preview settings migration", () => {
	it("expands HTML previews by default", () => {
		expect(settingsModule.DEFAULT_SETTINGS.autoPreviewHtml).toBe(true);
	});

	it("turns the legacy collapsed default on once", () => {
		const settings = { autoPreviewHtml: false };

		expect(typeof migrate).toBe("function");
		expect(migrate(settings)).toBe(true);
		expect(settings).toEqual({
			autoPreviewHtml: true,
			autoPreviewHtmlMigrated: true,
		});
	});

	it("preserves a marked user choice to keep previews collapsed", () => {
		const settings = {
			autoPreviewHtml: false,
			autoPreviewHtmlMigrated: true,
		};

		expect(typeof migrate).toBe("function");
		expect(migrate(settings)).toBe(false);
		expect(settings.autoPreviewHtml).toBe(false);
	});
});
