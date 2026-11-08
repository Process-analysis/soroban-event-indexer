import { type Logger } from "pino";
import { type Store } from "../storage/store.js";
import { createStore } from "../storage/index.js";
import { type SorobanRpcClient, type GetEventsParams } from "../rpc/types.js";
import { DefaultSorobanRpcClient } from "../rpc/client.js";
import { HandlerRegistry } from "../handlers/registry.js";
import {
  type DecodedEvent,
  type EventHandler,
  type HandlerContext,
  type IndexerStatus,
  type EventFilter,
} from "../types/index.js";
import { type IndexerConfig } from "../config/schema.js";
import { decodeEvent } from "../decode/index.js";
import { matchesFilters } from "./filter.js";
import { calculateBackoff, sleep } from "./backoff.js";
import {
  createLogger,
  createMetrics,
  startMetricsServer,
  type IndexerMetricsRegistry,
} from "../observability/index.js";
import type http from "node:http";

export class HandlerFailureError extends Error {
  constructor(
    public readonly eventId: string,
    public readonly causeError: unknown,
    public readonly attempts: number,
  ) {
    super(
      `Handler failed for event "${eventId}" after ${attempts} attempts: ${causeError instanceof Error ? causeError.message : String(causeError)}`,
    );
    this.name = "HandlerFailureError";
  }
}

export class SorobanIndexer {
  public readonly config: IndexerConfig;
  public readonly store: Store;
  public readonly rpc: SorobanRpcClient;
  public readonly handlers: HandlerRegistry;
  public readonly logger: Logger;
  public readonly metrics: IndexerMetricsRegistry;

  private metricsServer: http.Server | null = null;
  private isRunning = false;
  private currentCursor: string | null = null;
  private currentLedger = 0;
  private latestLedger = 0;
  private lastError: string | null = null;

  constructor(options: {
    config: IndexerConfig;
    store?: Store | undefined;
    rpcClient?: SorobanRpcClient | undefined;
    logger?: Logger | undefined;
  }) {
    this.config = options.config;
    this.logger = options.logger || createLogger(this.config.logLevel);
    this.store = options.store || createStore(this.config.storage);
    this.rpc = options.rpcClient || new DefaultSorobanRpcClient({ rpcUrl: this.config.rpcUrl });
    this.handlers = new HandlerRegistry();
    this.metrics = createMetrics();
  }

  /**
   * Register a typed event handler for a topic pattern.
   */
  on(pattern: string | string[], handler: EventHandler, contractId?: string): this {
    this.handlers.on(pattern, handler, contractId);
    return this;
  }

  /**
   * Initialize storage and cursor checkpoint.
   */
  async init(): Promise<void> {
    await this.store.init();

    const savedCheckpoint = await this.store.getCursor();
    if (savedCheckpoint) {
      this.currentCursor = savedCheckpoint.cursor;
      this.currentLedger = savedCheckpoint.ledger;
      this.logger.info(
        { cursor: this.currentCursor, ledger: this.currentLedger },
        "Resuming indexer from persisted cursor checkpoint",
      );
    } else if (this.config.startLedger !== undefined) {
      this.currentLedger = this.config.startLedger;
      this.logger.info(
        { startLedger: this.currentLedger },
        "Starting indexer from configured startLedger",
      );
    } else {
      // Query latest ledger from RPC as default start point
      try {
        const latest = await this.rpc.getLatestLedger();
        this.currentLedger = latest.sequence;
        this.latestLedger = latest.sequence;
        this.logger.info(
          { startLedger: this.currentLedger },
          "No start ledger or checkpoint configured; defaulting to current network head",
        );
      } catch {
        this.logger.warn("Could not query latest ledger during init; will retry in run loop");
      }
    }

    if (this.config.metrics.enabled) {
      this.metricsServer = startMetricsServer({
        port: this.config.metrics.port,
        host: this.config.metrics.host,
        metrics: this.metrics,
        getHealthStatus: () => ({
          healthy: !this.lastError,
          lag: Math.max(0, this.latestLedger - this.currentLedger),
          lastLedger: this.currentLedger,
        }),
        logger: this.logger,
      });
    }
  }

  /**
   * Perform one ingestion step (fetch page -> decode -> handlers + store commit in single tx).
   * Returns count of events processed.
   */
  async step(): Promise<number> {
    // 1. Fetch latest ledger to calculate network lag
    try {
      const latestResp = await this.rpc.getLatestLedger();
      this.latestLedger = latestResp.sequence;
      const lag = Math.max(0, this.latestLedger - this.currentLedger);
      this.metrics.ledgerLag.set(lag);
      this.metrics.lastProcessedLedger.set(this.currentLedger);
    } catch (err) {
      this.logger.debug({ err }, "Failed to query latest ledger during step check");
    }

    // 2. Query RPC for next batch of events
    const queryParams: GetEventsParams = {
      limit: this.config.limit,
    };

    if (this.config.filters.length > 0) {
      queryParams.filters = this.config.filters.map((f) => {
        const item: {
          type?: "contract" | "system" | "diagnostic" | undefined;
          contractIds?: string[] | undefined;
        } = {
          type: "contract",
        };
        if (f.contractIds) item.contractIds = f.contractIds;
        return item;
      });
    }

    if (this.currentCursor) {
      queryParams.cursor = this.currentCursor;
    } else if (this.currentLedger > 0) {
      queryParams.startLedger = this.currentLedger;
    }

    const response = await this.rpc.getEvents(queryParams);
    const rawEvents = response.events || [];

    if (response.latestLedger) {
      this.latestLedger = response.latestLedger;
      const lag = Math.max(0, this.latestLedger - this.currentLedger);
      this.metrics.ledgerLag.set(lag);
    }

    if (rawEvents.length === 0) {
      return 0;
    }

    // 3. Decode events
    const decodedEvents: DecodedEvent[] = [];
    for (const raw of rawEvents) {
      const decoded = decodeEvent(raw);
      decodedEvents.push(decoded);

      if (decoded.decodeError) {
        this.metrics.decodeErrors.inc({ contract_id: decoded.contractId });
        this.logger.warn(
          {
            eventId: decoded.id,
            reason: decoded.decodeErrorReason,
            contractId: decoded.contractId,
          },
          "ScVal decoding failed for event payload; storing raw base64 XDR",
        );
      }
    }

    // 4. Filter events matching user filters
    const matchedEvents = decodedEvents.filter((e) =>
      matchesFilters(e, this.config.filters as EventFilter[]),
    );

    // 5. Execute atomic transaction (insert events, run handlers, update cursor checkpoint)
    const lastRawEvent = rawEvents[rawEvents.length - 1]!;
    const nextCursor = response.cursor || lastRawEvent.pagingToken;
    const nextLedger = lastRawEvent.ledger;

    await this.store.withTransaction(async (tx) => {
      // 5a. Persist events idempotently
      if (matchedEvents.length > 0) {
        await this.store.insertEvents(matchedEvents, tx);
      }

      // 5b. Pass each event to registered handlers
      for (const event of matchedEvents) {
        const ctx: HandlerContext = {
          tx,
          ledger: event.ledger,
          cursor: event.pagingToken,
        };
        try {
          await this.handlers.dispatch(event, ctx);
          this.metrics.eventsProcessed.inc({
            contract_id: event.contractId,
            status: "success",
          });
        } catch (handlerErr) {
          this.metrics.handlerFailures.inc({
            contract_id: event.contractId,
          });
          throw handlerErr;
        }
      }

      // 5c. Persist updated cursor checkpoint in the same transaction
      await this.store.setCursor(nextCursor, nextLedger, tx);
    });

    // 6. Update in-memory state on commit success
    this.currentCursor = nextCursor;
    this.currentLedger = nextLedger;
    this.metrics.lastProcessedLedger.set(this.currentLedger);
    this.lastError = null;

    this.logger.debug(
      {
        count: matchedEvents.length,
        ledger: this.currentLedger,
        cursor: this.currentCursor,
      },
      "Successfully processed and committed event batch",
    );

    return matchedEvents.length;
  }

  /**
   * Run the continuous ingestion loop with retry backoff and graceful shutdown.
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    await this.init();
    this.logger.info("Soroban event indexer engine started");

    let failureCount = 0;

    while (this.isRunning) {
      try {
        const processedCount = await this.step();

        failureCount = 0; // reset retry counter on success

        if (processedCount === 0) {
          await sleep(this.config.pollIntervalMs);
        }
      } catch (err: any) {
        failureCount++;
        this.lastError = err?.message || String(err);

        this.logger.error(
          {
            err,
            attempt: failureCount,
            maxRetries: this.config.maxRetries,
          },
          `Indexer error during step execution: ${this.lastError}`,
        );

        if (failureCount >= this.config.maxRetries) {
          this.isRunning = false;
          throw new HandlerFailureError(
            this.currentCursor || `ledger:${this.currentLedger}`,
            err,
            failureCount,
          );
        }

        const backoffMs = calculateBackoff(
          failureCount,
          this.config.backoffInitialMs,
          this.config.backoffMaxMs,
        );

        this.logger.info({ backoffMs, failureCount }, `Backing off before retrying step...`);
        await sleep(backoffMs);
      }
    }
  }

  /**
   * Run historical backfill between two ledgers.
   */
  async backfill(fromLedger: number, toLedger: number): Promise<number> {
    if (fromLedger > toLedger) {
      throw new Error(
        `Invalid ledger range for backfill: fromLedger (${fromLedger}) cannot exceed toLedger (${toLedger})`,
      );
    }

    await this.store.init();
    this.logger.info({ fromLedger, toLedger }, "Starting historical ledger backfill");

    let totalIndexed = 0;
    let cursor: string | undefined = undefined;
    let currentL = fromLedger;

    while (currentL <= toLedger) {
      const queryParams: GetEventsParams = {
        limit: this.config.limit,
      };

      if (this.config.filters.length > 0) {
        queryParams.filters = this.config.filters.map((f) => {
          const item: {
            type?: "contract" | "system" | "diagnostic" | undefined;
            contractIds?: string[] | undefined;
          } = {
            type: "contract",
          };
          if (f.contractIds) item.contractIds = f.contractIds;
          return item;
        });
      }

      if (cursor) {
        queryParams.cursor = cursor;
      } else {
        queryParams.startLedger = currentL;
      }

      const response = await this.rpc.getEvents(queryParams);
      const rawEvents = response.events || [];

      if (rawEvents.length === 0) {
        this.logger.info(
          { currentL, toLedger },
          "No further events returned by RPC in backfill range",
        );
        break;
      }

      const decoded = rawEvents.map(decodeEvent);
      const matched = decoded.filter(
        (e) => e.ledger <= toLedger && matchesFilters(e, this.config.filters as EventFilter[]),
      );

      const lastRaw = rawEvents[rawEvents.length - 1]!;

      await this.store.withTransaction(async (tx) => {
        if (matched.length > 0) {
          await this.store.insertEvents(matched, tx);
        }

        for (const evt of matched) {
          const ctx: HandlerContext = {
            tx,
            ledger: evt.ledger,
            cursor: evt.pagingToken,
          };
          await this.handlers.dispatch(evt, ctx);
        }

        await this.store.setCursor(lastRaw.pagingToken, lastRaw.ledger, tx);
      });

      totalIndexed += matched.length;
      cursor = response.cursor || lastRaw.pagingToken;
      currentL = lastRaw.ledger;

      this.logger.info(
        {
          progressLedger: currentL,
          toLedger,
          batchIndexed: matched.length,
          totalIndexed,
        },
        "Backfill progress",
      );

      if (lastRaw.ledger >= toLedger) {
        break;
      }
    }

    this.logger.info({ totalIndexed, fromLedger, toLedger }, "Historical backfill complete");
    return totalIndexed;
  }

  /**
   * Query runtime status summary.
   */
  async getStatus(): Promise<IndexerStatus> {
    const stats = await this.store.getStats();
    const checkpoint = await this.store.getCursor();

    let latest = this.latestLedger;
    try {
      const resp = await this.rpc.getLatestLedger();
      latest = resp.sequence;
      this.latestLedger = latest;
    } catch {
      // ignore network errors on status probe
    }

    const curLedger = checkpoint?.ledger || this.currentLedger;
    const lag = Math.max(0, latest - curLedger);

    return {
      cursor: checkpoint?.cursor || null,
      currentLedger: curLedger,
      latestLedger: latest,
      lag,
      eventsCount: stats.totalEvents,
      decodeErrorsCount: stats.decodeErrors,
      lastError: this.lastError,
      updatedAt: checkpoint?.updatedAt || null,
    };
  }

  /**
   * Stop the indexer gracefully.
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.metricsServer) {
      await new Promise<void>((resolve) => {
        this.metricsServer!.close(() => resolve());
      });
      this.metricsServer = null;
    }
    await this.store.close();
    this.logger.info("Soroban event indexer stopped cleanly");
  }
}

export * from "./filter.js";
export * from "./backoff.js";
