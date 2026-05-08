import { describe, it, expect } from "vitest";
import { createTracePayload, formatLangfuseBatch } from "../src/utils/observability";

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
      expect(batch.batch).toHaveLength(1);
      expect(batch.batch[0].type).toBe("trace-create");
      expect(batch.batch[0].body.name).toBe("chat");
    });
  });
});
