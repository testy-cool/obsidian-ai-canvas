import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Modal } from "../components/Modal";
import type { AiProtocol, BrowserAiSettings } from "./settings";

interface AiSettingsDialogProps {
	settings: BrowserAiSettings;
	onSave: (settings: BrowserAiSettings) => void;
	onClose: () => void;
}

export function AiSettingsDialog({ settings, onSave, onClose }: AiSettingsDialogProps) {
	const [draft, setDraft] = useState(settings);
	const [showKey, setShowKey] = useState(false);
	const update = <K extends keyof BrowserAiSettings>(key: K, value: BrowserAiSettings[K]) =>
		setDraft((current) => ({ ...current, [key]: value }));

	const changeProtocol = (protocol: AiProtocol) => {
		setDraft((current) => ({
			...current,
			protocol,
			baseUrl: protocol === "gemini" && current.baseUrl === "https://api.openai.com/v1"
				? "https://generativelanguage.googleapis.com/v1beta"
				: protocol === "openai-compatible" && current.baseUrl === "https://generativelanguage.googleapis.com/v1beta"
					? "https://api.openai.com/v1"
					: current.baseUrl,
		}));
	};

	return (
		<Modal
			title="AI provider"
			onClose={onClose}
			wide
			footer={(
				<>
					<button type="button" className="button-secondary" onClick={onClose}>Cancel</button>
					<button type="button" className="button-primary" onClick={() => onSave({ ...draft, baseUrl: draft.baseUrl.trim(), model: draft.model.trim() })}>Save settings</button>
				</>
			)}
		>
			<div className="settings-intro">
				<span><KeyRound size={21} /></span>
				<div><strong>Connect directly from this browser</strong><p>No AI SDK wrapper rewrites your model. The exact model ID below is sent to the provider.</p></div>
			</div>
			<div className="settings-grid">
				<label className="field-label">
					<span>API protocol</span>
					<select aria-label="API protocol" value={draft.protocol} onChange={(event) => changeProtocol(event.target.value as AiProtocol)}>
						<option value="openai-compatible">OpenAI-compatible</option>
						<option value="gemini">Gemini native</option>
					</select>
				</label>
				<label className="field-label settings-grid__wide">
					<span>Base URL</span>
					<input aria-label="Base URL" value={draft.baseUrl} onChange={(event) => update("baseUrl", event.target.value)} placeholder="https://provider.example/v1" />
				</label>
				<label className="field-label settings-grid__wide">
					<span>API key</span>
					<span className="secret-input">
						<input aria-label="API key" type={showKey ? "text" : "password"} value={draft.apiKey} onChange={(event) => update("apiKey", event.target.value)} autoComplete="off" placeholder="Stored only in this browser" />
						<button type="button" aria-label={showKey ? "Hide API key" : "Show API key"} onClick={() => setShowKey((current) => !current)}>{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button>
					</span>
				</label>
				<label className="field-label settings-grid__wide">
					<span>Model ID</span>
					<input aria-label="Model ID" value={draft.model} onChange={(event) => update("model", event.target.value)} placeholder="Enter the exact ID reported by your provider" />
				</label>
				<label className="field-label settings-grid__wide">
					<span>Image model ID</span>
					<input aria-label="Image model ID" value={draft.imageModel} onChange={(event) => update("imageModel", event.target.value)} placeholder="Enter an image-capable model ID from your provider" />
				</label>
				<label className="field-label">
					<span>Temperature: {draft.temperature.toFixed(1)}</span>
					<input aria-label="Temperature" type="range" min="0" max="2" step="0.1" value={draft.temperature} onChange={(event) => update("temperature", Number(event.target.value))} />
				</label>
				<label className="field-label settings-grid__wide">
					<span>System prompt</span>
					<textarea aria-label="System prompt" value={draft.systemPrompt} onChange={(event) => update("systemPrompt", event.target.value)} />
				</label>
			</div>
			<div className="local-key-note"><ShieldCheck size={17} /><span>The key is saved to this browser's local storage and sent directly to your configured provider. A provider must allow CORS for browser requests.</span></div>
		</Modal>
	);
}
