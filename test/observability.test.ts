import { afterEach, describe, it, expect, vi } from "vitest";
import * as obsidian from "obsidian";
import { createTracePayload, formatLangfuseBatch, ObservabilityClient } from "../src/utils/observability";

describe("observability", () => {
  describe("createTracePayload", () => {
    it("calculates cost from token counts and model pricing", () => {
      const payload = createTracePayload({
        name: "chat",
        model: "gemini-3-flash-preview",
        provider: "gemini",
        input: "hello",
        output: "world",
        startTime: "2026-05-08T00:00:00Z",
        endTime: "2026-05-08T00:00:01Z",
        inputTokens: 10,
        outputTokens: 20,
        inputCostPerMillion: 0.1,
        outputCostPerMillion: 0.4,
        pluginVersion: "0.2.0",
      });

      expect(payload.traceId).toBeDefined();
      expect(payload.tokens.input).toBe(10);
      expect(payload.tokens.output).toBe(20);
      expect(payload.tokens.total).toBe(30);
      expect(payload.cost!.input).toBeCloseTo(0.000001);
      expect(payload.cost!.output).toBeCloseTo(0.000008);
      expect(payload.cost!.total).toBeCloseTo(0.000009);
      expect(payload.status).toBe("success");
    });

    it("omits cost when pricing not provided", () => {
      const payload = createTracePayload({
        name: "chat",
        model: "unknown",
        provider: "custom",
        input: "hello",
        output: "world",
        startTime: "2026-05-08T00:00:00Z",
        endTime: "2026-05-08T00:00:01Z",
        inputTokens: 10,
        outputTokens: 20,
        pluginVersion: "0.2.0",
      });

      expect(payload.cost).toBeUndefined();
    });

    it("sets error status with message", () => {
      const payload = createTracePayload({
        name: "chat",
        model: "test",
        provider: "test",
        input: "hello",
        output: "",
        startTime: "2026-05-08T00:00:00Z",
        endTime: "2026-05-08T00:00:01Z",
        inputTokens: 0,
        outputTokens: 0,
        pluginVersion: "0.2.0",
        error: "API rate limit exceeded",
      });

      expect(payload.status).toBe("error");
      expect(payload.error).toBe("API rate limit exceeded");
    });
  });

  describe("formatLangfuseBatch", () => {
    it("wraps payloads in Langfuse batch format", () => {
      const payload = createTracePayload({
        name: "chat",
        model: "test",
        provider: "test",
        input: "hello",
        output: "world",
        startTime: "2026-05-08T00:00:00Z",
        endTime: "2026-05-08T00:00:01Z",
        inputTokens: 5,
        outputTokens: 10,
        pluginVersion: "0.2.0",
      });

      const batch = formatLangfuseBatch([payload]);
      const span = batch.resourceSpans[0].scopeSpans[0].spans[0];
      expect(span.name).toBe("chat");
      expect(span.traceId).toMatch(/^[a-f0-9]{32}$/);
      expect(span.spanId).toMatch(/^[a-f0-9]{16}$/);
      expect(BigInt(span.endTimeUnixNano)).toBeGreaterThan(BigInt(span.startTimeUnixNano));
      expect(new Date(Number(BigInt(span.startTimeUnixNano) / BigInt(1_000_000))).toISOString()).toBe("2026-05-08T00:00:00.000Z");
      const attributes = Object.fromEntries(span.attributes.map(a => [a.key, a.value]));
      expect(attributes["langfuse.observation.type"]).toEqual({ stringValue: "generation" });
      expect(attributes["gen_ai.request.model"]).toEqual({ stringValue: "test" });
      expect(attributes["gen_ai.usage.input_tokens"]).toEqual({ intValue: "5" });
      expect(attributes["gen_ai.usage.output_tokens"]).toEqual({ intValue: "10" });
    });
  });
});

const config = () => ({ enabled: false, provider: "langfuse" as const, host: "https://example.test/", publicKey: "public", secretKey: "secret" });
const payload = () => createTracePayload({name:"chat",model:"test",provider:"test",input:"hello",output:"ok",startTime:new Date().toISOString(),endTime:new Date().toISOString(),inputTokens:2,outputTokens:3,pluginVersion:"test"});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it("starts exporting when tracing is enabled after plugin load", async () => {
  vi.useFakeTimers();
  const settings=config();
  const client=new ObservabilityClient(settings);
  const request=vi.spyOn(obsidian,"requestUrl").mockResolvedValue({status:200,json:{}} as any);
  settings.enabled=true;
  client.track(payload());
  await vi.advanceTimersByTimeAsync(5000);
  expect(request).toHaveBeenCalledWith(expect.objectContaining({url:"https://example.test/api/public/otel/v1/traces",method:"POST"}));
  await client.shutdown();
});
it("records export failures without throwing into generation", async () => {
  const client=new ObservabilityClient({...config(),enabled:true});
  vi.spyOn(obsidian,"requestUrl").mockResolvedValue({status:200,json:{partialSuccess:{rejectedSpans:1}}} as any);
  vi.spyOn(console,"warn").mockImplementation(()=>{});
  client.track(payload());
  await expect(client.flush()).resolves.toBeUndefined();
  expect(client.lastError).toContain("rejected");
  await client.shutdown();
});
