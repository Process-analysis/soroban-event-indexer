import { describe, it, expect } from "vitest";
import { createMetrics, startMetricsServer } from "../src/observability/index.js";

describe("Observability & Metrics Tests", () => {
  it("initializes Prometheus metrics and updates counters and gauges", async () => {
    const metrics = createMetrics();

    metrics.lastProcessedLedger.set(123456);
    metrics.ledgerLag.set(12);
    metrics.eventsProcessed.inc({ contract_id: "C_TEST", status: "success" }, 5);
    metrics.decodeErrors.inc({ contract_id: "C_TEST" }, 1);
    metrics.handlerFailures.inc({ contract_id: "C_TEST" }, 2);

    const metricsText = await metrics.register.metrics();
    expect(metricsText).toContain("soroban_indexer_last_ledger 123456");
    expect(metricsText).toContain("soroban_indexer_lag_ledgers 12");
    expect(metricsText).toContain(
      'soroban_indexer_events_processed_total{contract_id="C_TEST",status="success"} 5',
    );
    expect(metricsText).toContain('soroban_indexer_decode_errors_total{contract_id="C_TEST"} 1');
    expect(metricsText).toContain('soroban_indexer_handler_failures_total{contract_id="C_TEST"} 2');
  });

  it("serves /healthz and /metrics HTTP endpoints", async () => {
    const metrics = createMetrics();
    const server = startMetricsServer({
      port: 9876,
      host: "127.0.0.1",
      metrics,
      getHealthStatus: () => ({
        healthy: true,
        lag: 4,
        lastLedger: 5000,
      }),
    });

    try {
      // 1. Test /healthz
      const healthRes = await fetch("http://127.0.0.1:9876/healthz");
      expect(healthRes.status).toBe(200);
      const healthBody = (await healthRes.json()) as any;
      expect(healthBody.status).toBe("ok");
      expect(healthBody.lag).toBe(4);
      expect(healthBody.lastLedger).toBe(5000);

      // 2. Test /metrics
      const metricsRes = await fetch("http://127.0.0.1:9876/metrics");
      expect(metricsRes.status).toBe(200);
      const text = await metricsRes.text();
      expect(text).toContain("# HELP soroban_indexer_last_ledger");

      // 3. Test unknown path
      const notFoundRes = await fetch("http://127.0.0.1:9876/unknown");
      expect(notFoundRes.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
