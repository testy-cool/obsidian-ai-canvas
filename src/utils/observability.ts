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

export function formatLangfuseBatch(
  payloads: TracePayload[]
): { batch: Array<{ id: string; type: string; timestamp: string; body: Record<string, unknown> }> } {
  return {
    batch: payloads.map((p) => ({
      id: p.traceId,
      type: "trace-create",
      timestamp: new Date().toISOString(),
      body: {
        id: p.traceId,
        name: p.name,
        input: { prompt: p.input },
        output: { response: p.output },
        metadata: {
          ...p.metadata,
          model: p.model,
          provider: p.provider,
          providerParams: p.providerParams,
          tokens: p.tokens,
          cost: p.cost,
        },
        statusMessage: p.error,
      },
    })),
  };
}

export class ObservabilityClient {
  private buffer: TracePayload[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private settings: ObservabilitySettings) {
    if (settings.enabled && settings.provider !== "none") {
      this.flushTimer = setInterval(() => this.flush(), 5000);
    }
  }

  track(payload: TracePayload): void {
    if (!this.settings.enabled || this.settings.provider === "none") return;
    this.buffer.push(payload);
  }

  async flush(): Promise<void> {
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
    } catch {
      // Observability should never break the plugin
    }
  }

  private async sendLangfuse(batch: TracePayload[]): Promise<void> {
    const auth = btoa(`${this.settings.publicKey}:${this.settings.secretKey}`);
    await requestUrl({
      url: `${this.settings.host}/api/public/ingestion`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(formatLangfuseBatch(batch)),
    });
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
