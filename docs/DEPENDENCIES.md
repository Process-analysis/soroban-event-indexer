# Dependency Justification & Inventory

This document details the purpose and rationale for all runtime and development dependencies chosen for `soroban-event-indexer`. We intentionally keep the dependency footprint lean to minimize attack surface, supply chain risk, and installation bloat.

## Runtime Dependencies

| Package | Version | Purpose & Justification |
| :--- | :--- | :--- |
| `@stellar/stellar-sdk` | `^13.3.0` | **Official Stellar JavaScript SDK.** Provides Soroban JSON-RPC client bindings (`rpc.Server`), XDR type definitions, and native value conversion helpers (`scValToNative`). Required for reliable communication with Stellar/Soroban RPC endpoints. |
| `better-sqlite3` | `^11.8.1` | **High-performance SQLite engine.** Powers the default, zero-configuration local database adapter (`SqliteStore`). Enables synchronous, ACID-compliant transactions with immediate WAL mode for atomic batch commits and checkpointing without external daemons. |
| `pg` | `^8.13.3` | **PostgreSQL client for Node.js.** Powers the enterprise/production storage adapter (`PostgresStore`). Provides connection pooling, parameterized queries, and ACID transaction boundaries (`BEGIN` / `COMMIT` / `ROLLBACK`). |
| `zod` | `^3.24.2` | **Type-safe schema validation.** Used for validating indexer configuration files, environment variables, CLI options, and runtime event schemas with explicit error reporting and type inference. |
| `pino` | `^9.6.0` | **High-throughput structured logger.** Generates machine-readable JSON logs with minimal CPU overhead, supporting log levels, context binding, and operational tracing. |
| `prom-client` | `^15.1.3` | **Standard Prometheus metrics client.** Exposes standard metrics (`soroban_indexer_last_ledger`, `soroban_indexer_events_processed_total`, `soroban_indexer_lag_ledgers`, `soroban_indexer_decode_errors_total`, `soroban_indexer_handler_failures_total`) over `/metrics`. |
| `commander` | `^13.1.0` | **CLI application framework.** Powers the `soroban-indexer` binary with subcommands (`init`, `run`, `backfill`, `status`), typed options, help output, and standardized exit codes. |

## Development Dependencies

| Package | Version | Purpose |
| :--- | :--- | :--- |
| `typescript` | `^5.8.2` | Strict TypeScript compiler for static type checking across the library and tests. |
| `tsup` | `^8.4.0` | Fast esbuild-powered bundler outputting dual ESM (`.js`) and CJS (`.cjs`) builds with `.d.ts` declaration generation. |
| `vitest` | `^3.0.7` | Next-generation testing framework with fast multi-threaded execution and native ESM support. |
| `fast-check` | `^3.23.2` | Property-based testing framework used to verify de-duplication, state consistency, and crash recovery invariance across randomized inputs. |
| `eslint` / `typescript-eslint` | `^9.21.0` / `^8.26.0` | Code quality and static analysis for TypeScript best practices. |
| `prettier` | `^3.5.3` | Opinionated code formatter ensuring consistent formatting. |
| `pino-pretty` | `^13.0.0` | Human-readable log formatting for development environments and CLI runs. |
| `@types/*` | Various | Type declarations for Node.js, `better-sqlite3`, and `pg`. |

## Security Policy & Audit Findings

- All dependencies are monitored with package audit tooling.
- Version constraints are committed to `pnpm-lock.yaml` to ensure deterministic builds.
- **Audit Findings Analysis**:
  - `toml` (transitive via `@stellar/stellar-sdk`): The official Stellar SDK depends on `toml` to parse optional `stellar.toml` files for horizon anchor discovery. `soroban-event-indexer` only uses the RPC module (`getEvents`, `getLatestLedger`) and never invokes `stellar.toml` resolution or untrusted TOML parsing.
  - `zod`: Upstream advisory GHSA-mrhx-c7xc-m3w5 pertains to memory exhaustion when validating deeply nested collections with unbounded size. All configuration schemas in `soroban-event-indexer` define strict bounds.
  - `tinypool` / `esbuild`: Dev dependencies only; never bundled into runtime or production distributions.
