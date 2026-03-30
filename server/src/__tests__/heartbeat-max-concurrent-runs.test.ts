import { describe, expect, it } from "vitest";
import { normalizeMaxConcurrentRuns } from "../services/heartbeat.js";

describe("normalizeMaxConcurrentRuns", () => {
  it("defaults to 1 when value is undefined", () => {
    expect(normalizeMaxConcurrentRuns(undefined)).toBe(1);
  });

  it("defaults to 1 when value is null", () => {
    expect(normalizeMaxConcurrentRuns(null)).toBe(1);
  });

  it("defaults to 1 when value is a non-numeric string", () => {
    expect(normalizeMaxConcurrentRuns("unlimited")).toBe(1);
  });

  it("floors float values", () => {
    expect(normalizeMaxConcurrentRuns(2.9)).toBe(2);
    expect(normalizeMaxConcurrentRuns(1.1)).toBe(1);
  });

  it("clamps below minimum to 1", () => {
    expect(normalizeMaxConcurrentRuns(0)).toBe(1);
    expect(normalizeMaxConcurrentRuns(-5)).toBe(1);
  });

  it("clamps above maximum to 10", () => {
    expect(normalizeMaxConcurrentRuns(11)).toBe(10);
    expect(normalizeMaxConcurrentRuns(999)).toBe(10);
  });

  it("accepts valid values within range", () => {
    expect(normalizeMaxConcurrentRuns(1)).toBe(1);
    expect(normalizeMaxConcurrentRuns(3)).toBe(3);
    expect(normalizeMaxConcurrentRuns(10)).toBe(10);
  });

  it("defaults to 1 for numeric strings (asNumber only accepts typeof number)", () => {
    expect(normalizeMaxConcurrentRuns("5")).toBe(1);
    expect(normalizeMaxConcurrentRuns("3")).toBe(1);
  });
});
