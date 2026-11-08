import { describe, it, expect } from "vitest";
import { calculateBackoff, sleep } from "../src/engine/backoff.js";

describe("Exponential Backoff and Jitter Tests", () => {
  it("calculates exponential delays with increasing attempts", () => {
    // With 0 jitter factor for deterministic verification
    const delay0 = calculateBackoff(0, 100, 10000, 0);
    const delay1 = calculateBackoff(1, 100, 10000, 0);
    const delay2 = calculateBackoff(2, 100, 10000, 0);
    const delay3 = calculateBackoff(3, 100, 10000, 0);

    expect(delay0).toBe(100);
    expect(delay1).toBe(200);
    expect(delay2).toBe(400);
    expect(delay3).toBe(800);
  });

  it("caps backoff delay at maxMs ceiling", () => {
    const delay = calculateBackoff(20, 500, 5000, 0);
    expect(delay).toBe(5000);
  });

  it("applies jitter within configured bounds", () => {
    const jitterFactor = 0.2; // +/- 20% -> [800, 1200]

    for (let i = 0; i < 50; i++) {
      const val = calculateBackoff(1, 500, 10000, jitterFactor);
      expect(val).toBeGreaterThanOrEqual(800);
      expect(val).toBeLessThanOrEqual(1200);
    }
  });

  it("handles negative and zero attempt gracefully", () => {
    const neg = calculateBackoff(-5, 500, 5000, 0);
    expect(neg).toBe(500);

    const zero = calculateBackoff(0, 500, 5000, 0);
    expect(zero).toBe(500);
  });

  it("sleep resolves after expected time", async () => {
    const start = Date.now();
    await sleep(25);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(20);
  });
});
