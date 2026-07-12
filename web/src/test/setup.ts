import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

class ResizeObserverMock {
	observe() {}
	unobserve() {}
	disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
	value: ResizeObserverMock,
	writable: true,
});

Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
	configurable: true,
	value(this: HTMLElement) {
		const styledWidth = Number.parseFloat(this.style.width);
		const styledHeight = Number.parseFloat(this.style.height);
		const isViewport = this.classList.contains("react-flow") || this.classList.contains("canvas-workspace");
		const width = Number.isFinite(styledWidth) ? styledWidth : isViewport ? 1200 : 0;
		const height = Number.isFinite(styledHeight) ? styledHeight : isViewport ? 800 : 0;
		return {
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: width,
			bottom: height,
			width,
			height,
			toJSON: () => ({}),
		};
	},
});
