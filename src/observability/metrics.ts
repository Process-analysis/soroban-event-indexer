import http from "node:http";
import client from "prom-client";
import { type Logger } from "pino";

export interface IndexerMetricsRegistry {
  lastProcessedLedger: client.Gauge<string>;
  ledgerLag: client.Gauge<string>;
  eventsProcessed: client.Counter<string>;
  decodeErrors: client.Counter<string>;
  handlerFailures: client.Counter<string>;
  register: client.Registry;
}

export function createMetrics(): IndexerMetricsRegistry {
  const register = new client.Registry();

  client.collectDefaultMetrics({ register, prefix: "soroban_indexer_" });

  const lastProcessedLedger = new client.Gauge({
    name: "soroban_indexer_last_ledger",
    help: "The ledger sequence number of the most recently indexed event batch",
    registers: [register],
  });

  const ledgerLag = new client.Gauge({
    name: "soroban_indexer_lag_ledgers",
    help: "Number of ledgers between current processed position and latest ledger on network",
    registers: [register],
  });

  const eventsProcessed = new client.Counter({
    name: "soroban_indexer_events_processed_total",
    help: "Total count of Soroban contract events processed",
    labelNames: ["contract_id", "status"],
    registers: [register],
  });

  const decodeErrors = new client.Counter({
    name: "soroban_indexer_decode_errors_total",
    help: "Total count of events that failed ScVal decoding",
    labelNames: ["contract_id"],
    registers: [register],
  });

  const handlerFailures = new client.Counter({
    name: "soroban_indexer_handler_failures_total",
    help: "Total count of event handler execution failures",
    labelNames: ["contract_id"],
    registers: [register],
  });

  return {
    lastProcessedLedger,
    ledgerLag,
    eventsProcessed,
    decodeErrors,
    handlerFailures,
    register,
  };
}

export interface MetricsServerOptions {
  port: number;
  host: string;
  metrics: IndexerMetricsRegistry;
  getHealthStatus?: () => { healthy: boolean; lag: number; lastLedger: number };
  logger?: Logger;
}

export function startMetricsServer(options: MetricsServerOptions): http.Server {
  const { port, host, metrics, getHealthStatus, logger } = options;

  const server = http.createServer(async (req, res) => {
    if (req.url === "/metrics" && req.method === "GET") {
      try {
        res.setHeader("Content-Type", metrics.register.contentType);
        const data = await metrics.register.metrics();
        res.writeHead(200);
        res.end(data);
      } catch (err) {
        res.writeHead(500);
        res.end(`Internal Server Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (req.url === "/healthz" && req.method === "GET") {
      const status = getHealthStatus ? getHealthStatus() : { healthy: true, lag: 0, lastLedger: 0 };
      const statusCode = status.healthy ? 200 : 503;
      res.setHeader("Content-Type", "application/json");
      res.writeHead(statusCode);
      res.end(
        JSON.stringify({
          status: status.healthy ? "ok" : "degraded",
          lag: status.lag,
          lastLedger: status.lastLedger,
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  server.listen(port, host, () => {
    logger?.info({ host, port }, `Metrics and health server listening at http://${host}:${port}`);
  });

  return server;
}
