import type { JsonCanvasData } from "./types";

const previewSvg = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#171923"/><stop offset="1" stop-color="#51368a"/>
    </linearGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="28"/></filter>
  </defs>
  <rect width="800" height="520" fill="url(#g)"/>
  <circle cx="610" cy="100" r="120" fill="#b692ff" opacity=".24" filter="url(#blur)"/>
  <path d="M95 390 C200 185 350 455 505 178 S690 285 735 95" fill="none" stroke="#c7afff" stroke-width="10" stroke-linecap="round"/>
  <g fill="#f4efff"><circle cx="95" cy="390" r="14"/><circle cx="505" cy="178" r="14"/><circle cx="735" cy="95" r="14"/></g>
  <text x="74" y="90" fill="#f4efff" font-family="sans-serif" font-size="42" font-weight="700">A thought, made visible.</text>
  <text x="76" y="135" fill="#c9c1dc" font-family="sans-serif" font-size="22">Connect context. Choose what the model sees.</text>
</svg>`)} `;

export const WELCOME_CANVAS: JsonCanvasData = {
	nodes: [
		{
			id: "welcome-group",
			type: "group",
			label: "A browser-native JSON Canvas",
			x: -80,
			y: -90,
			width: 1220,
			height: 760,
			color: "5",
		},
		{
			id: "welcome-note",
			type: "text",
			text: "# Think in cards\n\nDouble-click any text card to edit it. Drag cards, resize from the corners, and connect them from any side.\n\n- Shift-click for multiple cards\n- Drag the background to pan\n- Scroll to zoom",
			x: 20,
			y: 20,
			width: 390,
			height: 280,
		},
		{
			id: "context-note",
			type: "text",
			text: "## Context is visible\n\nArrows describe what feeds the next card. For AI actions, you can choose the contributing cards without deleting any arrows.",
			x: 530,
			y: 5,
			width: 390,
			height: 230,
			color: "2",
		},
		{
			id: "spec-link",
			type: "link",
			url: "https://jsoncanvas.org/spec/1.0/",
			x: 35,
			y: 390,
			width: 360,
			height: 170,
			color: "4",
		},
		{
			id: "generated-preview",
			type: "file",
			file: "generated/canvas-map.svg",
			x: 515,
			y: 320,
			width: 500,
			height: 300,
			web_asset: previewSvg,
			web_asset_type: "image/svg+xml",
			ai_image_prompt: "An elegant dark editorial diagram showing ideas connected into a rising path, lavender ink on charcoal, crisp geometric composition",
			color: "5",
		},
	],
	edges: [
		{
			id: "welcome-context",
			fromNode: "welcome-note",
			fromSide: "right",
			toNode: "context-note",
			toSide: "left",
			toEnd: "arrow",
			label: "contributes",
		},
		{
			id: "spec-context",
			fromNode: "spec-link",
			fromSide: "right",
			toNode: "generated-preview",
			toSide: "left",
			toEnd: "arrow",
			label: "JSON Canvas",
			color: "4",
		},
		{
			id: "context-preview",
			fromNode: "context-note",
			fromSide: "bottom",
			toNode: "generated-preview",
			toSide: "top",
			toEnd: "arrow",
			color: "2",
		},
	],
};
