import { requestUrl } from "obsidian";

export interface ObservabilitySettings {
	provider: "none" | "langfuse" | "laminar" | "custom";
	host: string;
	publicKey: string;
	secretKey: string;
	enabled: boolean;
}

export interface TracePayload {
  traceId: string;
  name: string;
  input: string;
  output: string;
  model: string;
  provider: string;
  providerParams?: Record<string, unknown>;
  startTime: string;
  endTime: string;
  tokens: { input: number; output: number; total: number };
  cost?: { input: number; output: number; total: number };
  metadata: { pluginVersion: string; vaultName?: string; canvasName?: string };
  status: "success" | "error";
  error?: string;
}

export interface TraceInput {
  name: string;
  model: string;
  provider: string;
  providerParams?: Record<string, unknown>;
  input: string;
  output: string;
  startTime: string;
  endTime: string;
  inputTokens: number;
  outputTokens: number;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  pluginVersion: string;
  vaultName?: string;
  canvasName?: string;
  error?: string;
}

export function createTracePayload(input: TraceInput): TracePayload {
  const totalTokens = input.inputTokens + input.outputTokens;
  let cost: TracePayload["cost"];

  if (input.inputCostPerMillion != null && input.outputCostPerMillion != null) {
    const inputCost = (input.inputTokens * input.inputCostPerMillion) / 1_000_000;
    const outputCost = (input.outputTokens * input.outputCostPerMillion) / 1_000_000;
    cost = { input: inputCost, output: outputCost, total: inputCost + outputCost };
  }

  return {
    traceId: crypto.randomUUID(),
    name: input.name,
    input: input.input,
    output: input.output,
    model: input.model,
    provider: input.provider,
    providerParams: input.providerParams,
    startTime: input.startTime,
    endTime: input.endTime,
    tokens: { input: input.inputTokens, output: input.outputTokens, total: totalTokens },
    cost,
    metadata: {
      pluginVersion: input.pluginVersion,
      vaultName: input.vaultName,
      canvasName: input.canvasName,
    },
    status: input.error ? "error" : "success",
    error: input.error,
  };
}

const OBS_TYPE_GENERATION = "generation";

function otlpAttributes(values: Record<string, string | number | undefined>) {
	return Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) => ({
		key,
		value: typeof value === "number"
			? (Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value })
			: { stringValue: String(value) },
	}));
}

export function formatLangfuseBatch(payloads: TracePayload[]) {
	return {
		resourceSpans: [{
			resource: { attributes: otlpAttributes({ "service.name": "obsidian-ai-canvas" }) },
			scopeSpans: [{
				scope: { name: "obsidian-ai-canvas" },
				spans: payloads.map(p => ({
					traceId: p.traceId.replace(/-/g, ""),
					spanId: p.traceId.replace(/-/g, "").slice(0, 16),
					name: p.name,
					kind: 3,
					startTimeUnixNano: `${Date.parse(p.startTime)}000000`,
					endTimeUnixNano: `${Date.parse(p.endTime)}000000`,
					status: { code: p.error ? 2 : 1, ...(p.error ? { message: p.error } : {}) },
					attributes: otlpAttributes({
						"langfuse.observation.type": OBS_TYPE_GENERATION,
						"langfuse.trace.name": p.name,
						"langfuse.observation.input": p.input,
						"langfuse.observation.output": JSON.stringify(p.output),
						"langfuse.observation.model.parameters": JSON.stringify(p.providerParams ?? {}),
						"gen_ai.system": p.provider,
						"gen_ai.request.model": p.model,
						"gen_ai.usage.input_tokens": p.tokens.input,
						"gen_ai.usage.output_tokens": p.tokens.output,
						"langfuse.observation.cost_details": p.cost ? JSON.stringify(p.cost) : undefined,
						"langfuse.version": p.metadata.pluginVersion,
						"langfuse.trace.metadata.vault": p.metadata.vaultName,
						"langfuse.trace.metadata.canvas": p.metadata.canvasName,
					}),
				})),
			}],
		}],
	};
}

export class ObservabilityClient {
  private buffer: TracePayload[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  lastError: string | null = null;

  get enabled(): boolean { return this.settings.enabled && this.settings.provider !== "none"; }

  constructor(private settings: ObservabilitySettings) {
    // Settings can be enabled after plugin load; the idle flush is a no-op.
    this.flushTimer = setInterval(() => void this.flush(), 5000);
  }

  track(payload: TracePayload): void {
    if (!this.settings.enabled || this.settings.provider === "none") return;
    this.buffer.push(payload);
  }

  async flush(): Promise<void> {
    if (!this.enabled) { this.buffer = []; return; }
    if (this.buffer.length === 0) return;
    const batch = [...this.buffer];
    this.buffer = [];

    try {
      switch (this.settings.provider) {
        case "langfuse":
          await this.sendLangfuse(batch);
          break;
        case "laminar":
          await this.sendLaminar(batch);
          break;
        case "custom":
          await this.sendCustom(batch);
          break;
      }
      this.lastError = null;
    } catch (error) {
      // Keep export failures visible without logging prompts, keys, or response bodies.
      this.lastError = error instanceof TraceExportError ? error.message : "Trace delivery failed. Check the host and credentials.";
      console.warn(`[AI Canvas] ${this.lastError}`);
    }
  }

  private async sendLangfuse(batch: TracePayload[]): Promise<void> {
    const auth = btoa(`${this.settings.publicKey}:${this.settings.secretKey}`);
    const response = await requestUrl({
      url: `${this.settings.host.replace(/\/+$/, "")}/api/public/otel/v1/traces`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(formatLangfuseBatch(batch)),
      throw: false,
    });
    if (response.status >= 300) throw new TraceExportError(`Trace delivery failed (HTTP ${response.status}).`);
    if (Number(response.json?.partialSuccess?.rejectedSpans) > 0) {
      throw new TraceExportError("Langfuse rejected one or more trace spans.");
    }
  }

  private async sendLaminar(batch: TracePayload[]): Promise<void> {
    for (const trace of batch) {
      await requestUrl({
        url: `${this.settings.host}/v1/traces`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.settings.secretKey}`,
        },
        body: JSON.stringify(trace),
      });
    }
  }

  private async sendCustom(batch: TracePayload[]): Promise<void> {
    await requestUrl({
      url: this.settings.host,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.secretKey}`,
      },
      body: JSON.stringify({ traces: batch }),
    });
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flush();
  }
}

class TraceExportError extends Error {}
