import { describe, expect, it } from "vitest";
import { detectGeminiQuotaExhausted } from "./parse.js";

describe("detectGeminiQuotaExhausted", () => {
  it("returns exhausted=true for RESOURCE_EXHAUSTED / 429 in stderr", () => {
    const result = detectGeminiQuotaExhausted({
      parsed: null,
      stdout: "",
      stderr: "Error: 429 RESOURCE_EXHAUSTED: Quota exceeded for quota metric",
    });
    expect(result.exhausted).toBe(true);
  });

  it("returns exhausted=true when stdout contains rateLimitExceeded", () => {
    const result = detectGeminiQuotaExhausted({
      parsed: null,
      stdout: "rateLimitExceeded: You have exceeded your rate limit.",
      stderr: "",
    });
    expect(result.exhausted).toBe(true);
  });

  it("returns exhausted=true when parsed result contains quota signal", () => {
    const result = detectGeminiQuotaExhausted({
      parsed: { error: "quota_exceeded: daily quota reached", status: "failed" },
      stdout: "",
      stderr: "",
    });
    expect(result.exhausted).toBe(true);
  });

  it("returns exhausted=false for unrelated errors", () => {
    const result = detectGeminiQuotaExhausted({
      parsed: null,
      stdout: "Something went wrong",
      stderr: "invalid credentials",
    });
    expect(result.exhausted).toBe(false);
  });

  it("returns exhausted=false when all inputs are empty", () => {
    const result = detectGeminiQuotaExhausted({
      parsed: null,
      stdout: "",
      stderr: "",
    });
    expect(result.exhausted).toBe(false);
  });
});
