import { Eye, EyeOff, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "../components/Modal";
import { requestProviderModels, type ProviderModel } from "./client";
import type { AiProtocol, BrowserAiSettings } from "./settings";

interface AiSettingsDialogProps {
	settings: BrowserAiSettings;
	onSave: (settings: BrowserAiSettings) => void;
	onClose: () => void;
}

export function AiSettingsDialog({ settings, onSave, onClose }: AiSettingsDialogProps) {
	const [draft, setDraft] = useState(settings);
	const [showKey, setShowKey] = useState(false);
	const [models, setModels] = useState<ProviderModel[]>([]);
	const [modelStatus, setModelStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
	const [modelMessage, setModelMessage] = useState("");
	const modelRequestId = useRef(0);
	useEffect(() => () => { modelRequestId.current += 1; }, []);
	const update = <K extends keyof BrowserAiSettings>(key: K, value: BrowserAiSettings[K]) => {
		if (key === "baseUrl" || key === "apiKey") {
			modelRequestId.current += 1;
			setModels([]);
			setModelStatus("idle");
			setModelMessage("");
		}
		setDraft((current) => ({ ...current, [key]: value }));
	};

	const changeProtocol = (protocol: AiProtocol) => {
		modelRequestId.current += 1;
		setModels([]);
		setModelStatus("idle");
		setModelMessage("");
		setDraft((current) => {
			const knownProviderBase = ["", "https://api.openai.com/v1", "https://generativelanguage.googleapis.com/v1beta"].includes(current.baseUrl)
				|| /^https:\/\/[^/]+(?:\.openai\.azure\.com|\.services\.ai\.azure\.com|\.api\.cognitive\.microsoft\.com)\/openai\/v1\/?$/i.test(current.baseUrl);
			const baseUrl = knownProviderBase
				? protocol === "gemini"
					? "https://generativelanguage.googleapis.com/v1beta"
					: protocol === "openai-compatible"
						? "https://api.openai.com/v1"
						: ""
				: current.baseUrl;
			return { ...current, protocol, baseUrl };
		});
	};

	const fetchModels = async () => {
		const requestId = modelRequestId.current + 1;
		modelRequestId.current = requestId;
		setModels([]);
		setModelStatus("loading");
		setModelMessage("");
		try {
			const fetched = await requestProviderModels(draft);
			if (modelRequestId.current !== requestId) return;
			setModels(fetched);
			setModelStatus("success");
			setModelMessage(fetched.length === 1 ? "1 model found" : `${fetched.length} models found`);
		} catch (error) {
			if (modelRequestId.current !== requestId) return;
			setModelStatus("error");
			setModelMessage(error instanceof Error ? error.message : String(error));
		}
	};

	const baseUrlPlaceholder = draft.protocol === "gemini"
		? "https://generativelanguage.googleapis.com/v1beta"
		: draft.protocol === "azure"
			? "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1"
			: "https://provider.example/v1";

	return (
		<Modal
			title="AI provider"
			onClose={onClose}
			wide
			footer={(
				<>
					<button type="button" className="button-secondary" onClick={onClose}>Cancel</button>
					<button type="button" className="button-primary" onClick={() => onSave({ ...draft, baseUrl: draft.baseUrl.trim(), model: draft.model.trim(), imageModel: draft.imageModel.trim() })}>Save settings</button>
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
						<option value="azure">Azure OpenAI</option>
					</select>
				</label>
				<label className="field-label settings-grid__wide">
					<span>Base URL</span>
					<input aria-label="Base URL" value={draft.baseUrl} onChange={(event) => update("baseUrl", event.target.value)} placeholder={baseUrlPlaceholder} />
				</label>
				<label className="field-label settings-grid__wide">
					<span>API key</span>
					<span className="secret-input">
						<input aria-label="API key" type={showKey ? "text" : "password"} value={draft.apiKey} onChange={(event) => update("apiKey", event.target.value)} autoComplete="off" placeholder="Stored only in this browser" />
						<button type="button" aria-label={showKey ? "Hide API key" : "Show API key"} onClick={() => setShowKey((current) => !current)}>{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button>
					</span>
				</label>
				<div className="provider-model-fetch settings-grid__wide">
					<button type="button" className="button-secondary button-with-icon" disabled={modelStatus === "loading"} onClick={() => void fetchModels()}>
						<RefreshCw size={16} className={modelStatus === "loading" ? "is-spinning" : ""} />
						{modelStatus === "loading" ? "Fetching models…" : "Fetch models"}
					</button>
					{modelMessage ? <span className={modelStatus === "error" ? "provider-model-status is-error" : "provider-model-status"} role="status">{modelMessage}</span> : null}
				</div>
				{models.length ? (
					<datalist id="available-provider-models">
						{models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
					</datalist>
				) : null}
				<label className="field-label settings-grid__wide">
					<span>Model ID</span>
					<input aria-label="Model ID" list={models.length ? "available-provider-models" : undefined} value={draft.model} onChange={(event) => update("model", event.target.value)} placeholder="Enter the exact ID reported by your provider" />
				</label>
				<label className="field-label settings-grid__wide">
					<span>Image model ID</span>
					<input aria-label="Image model ID" list={models.length ? "available-provider-models" : undefined} value={draft.imageModel} onChange={(event) => update("imageModel", event.target.value)} placeholder="Enter an image-capable model ID from your provider" />
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
			{draft.protocol === "azure" ? <p className="azure-provider-note">Use your Azure resource endpoint ending in <code>/openai/v1</code>. The model fields accept the deployment/model IDs returned by that resource.</p> : null}
			<div className="local-key-note"><ShieldCheck size={17} /><span>The key is saved to this browser's local storage and sent directly to your configured provider. A provider must allow CORS for browser requests.</span></div>
		</Modal>
	);
}
