# Open-Source Contribution Wave Issues

This document contains 14 drafted, scoped issues for open-source contributors participating in the monthly contribution wave.

Summary breakdown:
- **Trivial (5 issues)**: 1 hour tasks focusing on CLI polish, validation rules, formatting, and edge case assertions.
- **Medium (6 issues)**: Half-day tasks implementing new options, metrics histograms, filter extensions, dry-run CLI modes, and webhook dispatching.
- **High (3 issues)**: 1-2 day architecture hardening tasks including Redis storage adapter, multi-RPC failover balancing, and WebSocket/SSE streaming.

---

### Add CLI status elapsed time formatting and lag duration estimate
**Complexity:** Trivial
**Description:** The `soroban-indexer status` command currently outputs the ledger lag as a raw integer difference between the latest ledger and the cursor ledger. Operators need a human-readable estimated lag duration (e.g., `~15 seconds` or `~2.4 minutes`) based on Stellar's ~5-second ledger closing target. This improves UX during monitoring and incident response.
**Requirements and context:**
- Multiply the ledger difference by 5 seconds to estimate lag.
- Format duration into human-readable format: `<1m`, `Xm Ys`, `Xh Ym`.
- If lag is 0, display `Synced (0s lag)`.
- Maintain clean machine-parseable JSON output when `--json` flag is supplied.
**Suggested execution:**
- Files to touch: `src/cli/commands/status.ts`, `tests/cli.test.ts`
- Branch name suggestion: `feature/status-lag-duration`
**Acceptance criteria / test plan:**
- Unit test in `tests/cli.test.ts` verifying that lag of 12 ledgers renders `~1m 0s`.
- Verify `--json` output remains strictly typed with both `lagLedgers` and `estimatedLagSeconds`.

---

### Enforce minimum RPC poll interval and page limit bounds in config schema
**Complexity:** Trivial
**Description:** Aggressive polling intervals (e.g. < 100ms) or excessive page limits (e.g. > 10,000) can overload public Soroban RPC nodes and cause instant IP rate-limiting. We need explicit validation in the Zod config schema to warn or reject unviable parameters before runtime. This prevents operator misconfiguration on startup.
**Requirements and context:**
- Set minimum `pollIntervalMs` to `250` (or allow override with explicit `allowAggressivePolling: true`).
- Set `limit` bounds between `1` and `1000` (matching Horizon/Soroban RPC pagination ceilings).
- Provide informative Zod validation error messages referencing the RPC limits.
**Suggested execution:**
- Files to touch: `src/config/schema.ts`, `tests/config.test.ts`
- Branch name suggestion: `feature/config-polling-bounds`
**Acceptance criteria / test plan:**
- Add tests in `tests/config.test.ts` checking rejection of `pollIntervalMs: 50` and `limit: 5000`.
- Verify descriptive error message explaining valid bounds.

---

### Add JSON Schema generation script for indexer configuration files
**Complexity:** Trivial
**Description:** Users configuring `soroban-indexer.json` in VS Code or other IDEs benefit from autocomplete, hover descriptions, and real-time schema validation. Generating a standardized `soroban-indexer.schema.json` from the canonical Zod schema enables `$schema` references in user configs. This reduces configuration errors and improves developer onboarding.
**Requirements and context:**
- Use `zod-to-json-schema` or a lightweight generator to export `IndexerConfigSchema` to JSON Schema Draft-07.
- Add an npm script `"generate:schema"` in `package.json`.
- Output file path: `soroban-indexer.schema.json` at repository root.
**Suggested execution:**
- Files to touch: `scripts/generate-schema.ts`, `package.json`, `src/config/schema.ts`
- Branch name suggestion: `feature/json-schema-export`
**Acceptance criteria / test plan:**
- Run `pnpm run generate:schema` and assert valid JSON Schema file is produced.
- Add test verifying generated schema matches all fields in `src/config/schema.ts`.

---

### Sanitize and truncate oversized error messages in decode error events
**Complexity:** Trivial
**Description:** When an unexpected or malicious contract emits corrupt or deeply nested XDR payloads, the decode error reason string can grow unbounded. Storing gigantic error messages can exhaust database storage or log buffers. Truncating and sanitizing decode error messages protects storage and downstream consumers.
**Requirements and context:**
- Truncate decode error `reason` strings to a maximum of 512 characters with an ellipsis indicator (`... [truncated]`).
- Strip non-printable control characters from the error reason.
- Keep the original base64 raw XDR intact for debugging.
**Suggested execution:**
- Files to touch: `src/decode/index.ts`, `tests/decode.test.ts`
- Branch name suggestion: `feature/sanitize-decode-errors`
**Acceptance criteria / test plan:**
- Unit test in `tests/decode.test.ts` passing a malformed ScVal yielding a 2000-character parse error and verifying the resulting `reason` length is exactly bounded.

---

### Add custom CLI exit code constants and documentation
**Complexity:** Trivial
**Description:** Shell scripts and orchestration systems (systemd, Kubernetes, Docker) need clear process exit codes to distinguish configuration errors, RPC retention breaches, and unhandled database errors. Replacing generic `process.exit(1)` calls with semantic exit codes improves operational automation.
**Requirements and context:**
- Define exit codes enum: `0 = SUCCESS`, `1 = GENERAL_ERROR`, `2 = INVALID_CONFIG`, `3 = RETENTION_WINDOW_EXCEEDED`, `4 = STORE_CONNECTION_FAILED`, `5 = HANDLER_FAILED_MAX_RETRIES`.
- Map engine failure types to the respective code before process exit.
- Document the exit code table in `README.md` and CLI `--help`.
**Suggested execution:**
- Files to touch: `src/cli/exit-codes.ts`, `src/cli/index.ts`, `src/engine/index.ts`, `README.md`
- Branch name suggestion: `feature/cli-exit-codes`
**Acceptance criteria / test plan:**
- Add tests in `tests/cli.test.ts` verifying that passing an invalid config path exits with code `2`.
- Verify retention window breach terminates with exit code `3`.

---

### Add Prometheus histograms for RPC latency and handler execution time
**Complexity:** Medium
**Description:** Currently, Prometheus metrics record total counters and gauge values for ledger lag and event totals. Operators cannot observe RPC latency percentiles (p50, p95, p99) or slow handler functions. Adding Prometheus histogram metrics enables latency alert rules and bottleneck diagnosis.
**Requirements and context:**
- Add `soroban_indexer_rpc_request_duration_seconds` histogram labeled by method (`getEvents`, `getLatestLedger`).
- Add `soroban_indexer_handler_execution_duration_seconds` histogram labeled by `contract_id` and `event_name`.
- Use sensible latency buckets for RPC: `[0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]`.
- Expose via existing `/metrics` endpoint.
**Suggested execution:**
- Files to touch: `src/observability/metrics.ts`, `src/engine/index.ts`, `tests/metrics.test.ts`
- Branch name suggestion: `feature/prometheus-latency-histograms`
**Acceptance criteria / test plan:**
- Integration test in `tests/metrics.test.ts` asserting that after processing an event batch, histogram buckets are present in `/metrics` text output.

---

### Support filtering events by contract event type (contract, system, diagnostic)
**Complexity:** Medium
**Description:** Soroban contracts emit `contract` events, but the Soroban RPC also supports returning `system` and `diagnostic` events. Currently, our filters default to `contract` events only. Providing a configuration setting to filter and ingest `diagnostic` or `system` events enables debugging tools and protocol-level monitoring.
**Requirements and context:**
- Update `IndexerConfig` to accept `eventTypes: Array<"contract" | "system" | "diagnostic">` (defaulting to `["contract"]`).
- Pass the type filter down to RPC `getEvents` query parameter if supported, or filter client-side.
- Ensure event model stores the event type column in both `SqliteStore` and `PostgresStore`.
**Suggested execution:**
- Files to touch: `src/config/schema.ts`, `src/engine/index.ts`, `src/storage/schema.ts`, `src/storage/sqlite.ts`, `src/storage/postgres.ts`, `tests/engine.test.ts`
- Branch name suggestion: `feature/filter-event-types`
**Acceptance criteria / test plan:**
- Shared store tests verify `type` column persistence in SQLite and Postgres.
- Engine test verifying diagnostic events are ignored when config only specifies `["contract"]`.

---

### Add sliding-window in-memory event deduplication cache
**Complexity:** Medium
**Description:** When indexer restarts or RPC returns overlapping page boundaries, duplicate events are sent to the storage engine. While SQLite and Postgres ignore duplicates via primary key conflicts, evaluating DB primary key constraints on large batches adds disk I/O overhead. An in-memory LRU or ring buffer cache of the last N event IDs eliminates redundant database writes.
**Requirements and context:**
- Maintain an in-memory cache of the most recent N (configurable, default 5,000) event IDs.
- Skip DB insertion for events present in the cache before opening transaction.
- Flush cache entries oldest-first when reaching capacity.
- Cache must not bypass handlers if a handler hasn't processed that event in the current run.
**Suggested execution:**
- Files to touch: `src/engine/dedup-cache.ts`, `src/engine/index.ts`, `tests/engine.test.ts`
- Branch name suggestion: `feature/dedup-memory-cache`
**Acceptance criteria / test plan:**
- Benchmark / test showing zero store `insertEvents` calls for duplicate events in the cache window.
- Test verifying correct behavior when cache rolls over.

---

### Add dry-run simulation mode to CLI backfill command
**Complexity:** Medium
**Description:** Operators running historical backfills across millions of ledgers need to verify which contracts and topics match before committing derived records to their production database. A `--dry-run` flag allows running the backfill pipeline, printing matched event counts and sample decoded payloads without modifying database state.
**Requirements and context:**
- Add `--dry-run` boolean flag to `soroban-indexer backfill`.
- In dry-run mode, execute RPC paging and decoding normally.
- Invoke handlers with a read-only or no-op mock transaction context.
- Print summary statistics (matched events, decoded topics, ledger range, elapsed time) to stdout.
**Suggested execution:**
- Files to touch: `src/cli/commands/backfill.ts`, `src/engine/index.ts`, `tests/cli.test.ts`
- Branch name suggestion: `feature/backfill-dry-run`
**Acceptance criteria / test plan:**
- CLI test running backfill with `--dry-run` against fake RPC, asserting that 0 rows are written to the database file and summary stats are output to console.

---

### Implement webhook HTTP notification dispatcher for indexed events
**Complexity:** Medium
**Description:** Many web applications need external HTTP webhook notifications when specific contract events are indexed (e.g. notifying a Discord bot or backend service of `PayoutClaimed`). Adding a built-in webhook dispatcher plugin allows streaming events to external HTTP endpoints with signature verification.
**Requirements and context:**
- Configurable `webhooks` array in config: `url`, `events: string[]`, `secret`, `maxRetries`.
- Sign outgoing POST payloads with HMAC-SHA256 in `X-Signature-256` header.
- Execute dispatch asynchronously so slow webhook endpoints never block ledger indexing.
- Log failures and record a `soroban_indexer_webhook_failures_total` metric.
**Suggested execution:**
- Files to touch: `src/webhooks/dispatcher.ts`, `src/config/schema.ts`, `src/engine/index.ts`, `tests/webhook.test.ts`
- Branch name suggestion: `feature/webhook-notifications`
**Acceptance criteria / test plan:**
- Unit tests with a mock HTTP server asserting correct HMAC signature and JSON payload.
- Test verifying indexer loop continues unimpeded when webhook endpoint returns HTTP 500.

---

### Add automated schema migration runner for custom store tables
**Complexity:** Medium
**Description:** Applications building projections (e.g. payout balances, DAO votes) write to custom tables via `ctx.tx`. Currently, developers must manually run external migration tools before starting the indexer. Adding an embedded migration runner within `Store` allows defining user migration scripts that run automatically inside the store initialization lifecycle.
**Requirements and context:**
- Provide `store.registerMigration({ id: string, up: (tx) => Promise<void> })`.
- Maintain a `_schema_migrations` table tracking executed migration IDs and timestamps.
- Support both `SqliteStore` and `PostgresStore`.
- Run migrations sequentially inside a transaction on startup.
**Suggested execution:**
- Files to touch: `src/storage/store.ts`, `src/storage/sqlite.ts`, `src/storage/postgres.ts`, `tests/storage.test.ts`
- Branch name suggestion: `feature/schema-migrations`
**Acceptance criteria / test plan:**
- Test registering migrations 001 and 002, verifying both apply once, and subsequent restarts skip already executed migrations.

---

### Implement high-performance Redis storage and checkpoint adapter (`RedisStore`)
**Complexity:** High
**Description:** In distributed cloud architectures, serverless workers and read-heavy frontends often require event streams and cursor positions in Redis (Streams and Hashes) rather than relational databases. Implementing a `RedisStore` adapter compliant with the `Store` interface enables ultra-low latency event caching and Redis Stream fanout.
**Requirements and context:**
- Implement `Store` interface using `ioredis` or native redis client.
- Map cursor to Redis Hash key (`HSET cursor:checkpoint ledger <num>`).
- Implement transactions using Redis `MULTI` / `EXEC` pipelines for atomic commits.
- Store events in a sorted set by ledger sequence and Redis Stream for pub/sub.
- Pass the shared store test contract suite without exceptions.
**Suggested execution:**
- Files to touch: `src/storage/redis.ts`, `src/storage/index.ts`, `tests/storage.contract.ts`, `package.json`
- Branch name suggestion: `feature/redis-store-adapter`
**Acceptance criteria / test plan:**
- Run the shared store contract suite against an in-memory Redis mock (`ioredis-mock`).
- Verify atomic rollback when `EXEC` fails.

---

### Add multi-RPC endpoint failover and health quorum balancer
**Complexity:** High
**Description:** Public and private Soroban RPC nodes experience rate limits, transient network partitions, or delayed ledger synchronization. A single RPC URL is a single point of failure. Introducing an RPC client pool with automatic health probing, round-robin load distribution, and automatic failover ensures 99.99% indexer uptime.
**Requirements and context:**
- Support `rpcUrls: string[]` in config.
- Health monitor periodically queries `getLatestLedger` on all nodes every 10 seconds.
- Detect unhealthy nodes (HTTP errors, timeouts, or nodes lagging behind network consensus).
- Route `getEvents` requests to the highest synced healthy node.
- Failover seamlessly if the active node drops or throttles with 429 during pagination.
**Suggested execution:**
- Files to touch: `src/rpc/client-pool.ts`, `src/rpc/index.ts`, `src/engine/index.ts`, `tests/rpc-pool.test.ts`
- Branch name suggestion: `feature/rpc-pool-failover`
**Acceptance criteria / test plan:**
- Unit test with 3 mock RPC nodes where the primary node simulates 503 errors; verify query succeeds without error by automatically falling back to secondary node.
- Verify lag detection excludes nodes reporting stale ledgers.

---

### Implement real-time streaming ingestion via WebSocket / Server-Sent Events
**Complexity:** High
**Description:** Polling `getEvents` introduces a delay bounded by `pollIntervalMs`. Next-generation Soroban RPC endpoints provide streaming subscriptions (WebSocket or SSE) pushing events as soon as a ledger closes. Adding a reactive subscription transport with seamless fallback to polling enables sub-second indexing latency.
**Requirements and context:**
- Support `transport: "poll" | "stream" | "auto"` in configuration.
- Implement WebSocket/SSE listener reconnecting automatically with exponential backoff on disconnect.
- Fall back gracefully to cursor polling if the streaming connection drops or endpoint does not support streaming.
- Guarantee at-least-once processing across transport switches without skipping or duplicating events.
**Suggested execution:**
- Files to touch: `src/engine/stream-transport.ts`, `src/engine/index.ts`, `src/rpc/types.ts`, `tests/streaming.test.ts`
- Branch name suggestion: `feature/streaming-transport`
**Acceptance criteria / test plan:**
- Test with simulated WebSocket server delivering events, verifying atomic batch commits.
- Test simulating socket disconnect, asserting automated fallback to RPC polling from last saved cursor.
