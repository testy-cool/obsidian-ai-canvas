const activeGenerations = new Set<() => void>();

/** Runtime UI only: loading placeholders never become prompt/card text. */
export function createGenerationStatus(
	node: any,
	controller: AbortController
) {
	const host: HTMLElement = node.nodeEl ?? node.contentEl;
	host.addClass("ai-card-ui-host", "ai-generating");
	const root = host.createEl("div", { cls: "ai-generation-status" });
	root.setAttribute("data-state", "waiting");
	const phase = root.createEl("div", { cls: "ai-generation-phase", text: "Generating…" });
	phase.setAttribute("role", "status");
	const controls = root.createEl("div", { cls: "ai-generation-controls" });
	const elapsed = controls.createEl("span", { cls: "ai-generation-timer", text: "0s" });
	const stop = controls.createEl("button", { cls: "ai-generation-stop", text: "Stop" });
	stop.setAttribute("aria-label", "Stop generation");
	stop.addEventListener("pointerdown", event => event.stopPropagation());
	stop.addEventListener("mousedown", event => event.stopPropagation());
	stop.addEventListener("keydown", event => event.stopPropagation());
	stop.addEventListener("click", event => { event?.stopPropagation(); controller.abort(); });
	const onAbort = () => { phase.setText("Stopping…"); stop.disabled = true; };
	controller.signal.addEventListener("abort", onAbort, { once: true });
	const started = Date.now();
	let destroyed = false;
	const cancel = () => { controller.abort(); destroy(); };
	activeGenerations.add(cancel);
	const timer = setInterval(() => {
		if (node.canvas?.nodes && !node.canvas.nodes.has(node.id)) { cancel(); return; }
		const seconds = Math.floor((Date.now() - started) / 1000);
		elapsed.setText(seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`);
	}, 1000);
	function destroy() {
		if (destroyed) return;
		destroyed = true;
		clearInterval(timer);
		controller.signal.removeEventListener("abort", onAbort);
		activeGenerations.delete(cancel);
		root.remove();
		host.removeClass("ai-generating", "ai-generation-streaming");
	}
	return {
		destroy,
		setPhase(text: string) { if (!destroyed && !controller.signal.aborted) phase.setText(text); },
		showStreaming() {
			if (destroyed) return;
			root.setAttribute("data-state", "streaming");
			host.addClass("ai-generation-streaming");
			phase.setText("Writing…");
		},
	};
}

export function cancelActiveGenerations() {
	for (const cancel of activeGenerations) cancel();
}
