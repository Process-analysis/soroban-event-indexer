# soroban-event-indexer

[![CI](https://github.com/Process-analysis/soroban-event-indexer/actions/workflows/ci.yml/badge.svg)](https://github.com/Process-analysis/soroban-event-indexer/actions/workflows/ci.yml)
[![Status: Beta](https://img.shields.io/badge/status-beta-blue.svg)](https://github.com/Process-analysis/soroban-event-indexer)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node: >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

A small, reliable, reusable toolkit and CLI that reads smart contract events from a Soroban RPC node, decodes them into typed JavaScript values, and stores them idempotently in SQLite or PostgreSQL with transactional cursor checkpointing.

---

## Why This Exists

Nearly every team building on Soroban (Stellar's smart contract platform) needs to track contract events—for payout ledgers, decentralized exchanges, staking rewards, governance votes, or notification bots. Today, almost every developer rewrites this plumbing from scratch: an ad-hoc `setInterval` loop with `@stellar/stellar-sdk` that drops events during network restarts, lacks atomic checkpointing, crashes on unexpected XDR types, or silently skips historical blocks.

`soroban-event-indexer` packages this infrastructure once with correctness and testing as first principles:
- **Crash-proof Checkpointing**: Events and the cursor are committed in a single physical transaction. If the indexer crashes at any point, the cursor never advances without storing the events (and vice versa).
- **Zero-Setup SQLite Default**: Works out of the box with embedded SQLite; switch to PostgreSQL in production with a single config line.
- **Resilient XDR Decoding**: Automatically maps `i128`/`u64` to native `bigint`, symbols/addresses to strings, and isolates unparseable payloads without halting ingestion.
- **Observability Built-in**: Structured JSON logging (`pino`) and Prometheus `/metrics` + `/healthz` endpoints.

---

## Architecture & Data Flow

```mermaid
flowchart LR
    RPC["Soroban RPC Node<br/>(/getEvents)"] -->|Paged Events| Engine["Core Engine<br/>(Polling & Retry)"]
    Engine -->|Raw XDR| Decoder["ScVal Decoder<br/>(i128 -> bigint)"]
    Decoder -->|Decoded Events| Filter["Topic & Contract<br/>Pattern Filter"]
    Filter -->|Filtered Stream| Handlers["Typed Handlers<br/>(indexer.on)"]
    Handlers -->|Event + ctx.tx| Store[("Atomic Transaction<br/>(events + cursor + derived)")]
    Store --> SQLite[("SQLite (WAL)")]
    Store --> Postgres[("PostgreSQL")]
```

---

## Delivery Guarantees & Finality

### At-Least-Once Fetch + Idempotent Write = Effectively-Once Storage
- **RPC Ingestion**: The indexer queries `getEvents` using the stored cursor. Network retries or process restarts may re-deliver already observed events.
- **Idempotent DB Insertion**: The `events` table enforces a primary key constraint on the unique Soroban RPC event `id`. Re-inserting an existing event is a no-op (`INSERT OR IGNORE` in SQLite / `ON CONFLICT (id) DO NOTHING` in Postgres).
- **Atomic Batch Commits**: Ingestion writes the events, invokes your handlers to write derived records, and updates the checkpoint cursor **within the same database transaction** (`ctx.tx`).
- **Limits**:
  - Stellar uses the Stellar Consensus Protocol (SCP) with deterministic fast finality (3–5 seconds). Chain reorganizations (reorgs) do not occur on Stellar.
  - Soroban RPC nodes retain a limited window of recent ledgers. If your indexer's cursor falls behind the RPC's retention window, the engine stops immediately with an actionable error rather than skipping data.

---

## 5-Minute Quickstart (SQLite)

### 1. Install

```bash
npm install soroban-event-indexer
# or with pnpm:
pnpm add soroban-event-indexer
```

### 2. Initialize Configuration

Generate a starter configuration file (`soroban-indexer.json`):

```bash
npx soroban-indexer init
```

### 3. Embed in Your Code

```typescript
import { SorobanIndexer, type DecodedEvent, type HandlerContext } from "soroban-event-indexer";

const indexer = new SorobanIndexer({
  config: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    storage: {
      adapter: "sqlite",
      path: "./indexer.sqlite",
    },
    filters: [
      {
        contractIds: ["CA3D5KRYMCMQU7YOGCVCPKZASDF1234567890ASDF1234567890ASDF12"],
        topics: [["VeryPrince", "*"]],
      },
    ],
  },
});

// Register a typed handler for OrgFunded events
indexer.on("OrgFunded", async (event: DecodedEvent, ctx: HandlerContext) => {
  console.log(`[OrgFunded] Ledger: ${ctx.ledger}, Topics:`, event.topics);

  // Write derived state inside the same atomic transaction:
  ctx.tx.execute(
    "INSERT INTO org_balances (org_id, balance) VALUES (?, ?) ON CONFLICT(org_id) DO UPDATE SET balance = balance + excluded.balance",
    [String(event.topics[1]), 1000]
  );
});

// Start continuous indexing
await indexer.start();
```

---

## Running Against PostgreSQL

To use PostgreSQL instead of SQLite, update the `storage` block in your config:

```json
{
  "storage": {
    "adapter": "postgres",
    "connectionString": "postgres://postgres:password@localhost:5432/my_indexer_db"
  }
}
```

Or provide individual connection parameters:

```json
{
  "storage": {
    "adapter": "postgres",
    "host": "localhost",
    "port": 5432,
    "database": "my_indexer_db",
    "user": "postgres",
    "password": "password",
    "ssl": false
  }
}
```

Tables (`events`, `cursor_checkpoint`) are created automatically on startup.

---

## Configuration Reference

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `rpcUrl` | `string` | **Required** | URL of the Soroban JSON-RPC node. |
| `storage.adapter` | `"sqlite" \| "postgres"` | `"sqlite"` | Database storage adapter. |
| `storage.path` | `string` | `"./indexer.sqlite"` | SQLite file path (when using SQLite). |
| `storage.connectionString`| `string` | `undefined` | PostgreSQL connection URL. |
| `filters` | `Array<FilterConfig>` | `[]` | Contract IDs and topic patterns to monitor. |
| `startLedger` | `number` | Latest ledger | Ledger sequence number to start from if no cursor exists. |
| `limit` | `number` | `100` | Max events per RPC page (1–1000). |
| `pollIntervalMs` | `number` | `1000` | Delay between polls when no new events are found. |
| `maxRetries` | `number` | `5` | Maximum retry attempts before stopping on error. |
| `backoffInitialMs` | `number` | `500` | Initial exponential backoff delay in milliseconds. |
| `backoffMaxMs` | `number` | `30000` | Maximum backoff delay cap in milliseconds. |
| `metrics.enabled` | `boolean` | `false` | Enable HTTP metrics server (`/metrics`, `/healthz`). |
| `metrics.port` | `number` | `9090` | Port for metrics server. |
| `logLevel` | `string` | `"info"` | Log level: `trace`, `debug`, `info`, `warn`, `error`. |

---

## CLI Reference

The package ships with the `soroban-indexer` binary:

```bash
# Generate starter configuration
soroban-indexer init [--path <path>] [--force]

# Start indexing daemon
soroban-indexer run [--config <path>]

# Backfill a historical ledger range
soroban-indexer backfill --from 10000 --to 15000 [--config <path>]

# Check cursor position, network lag, and stored counts
soroban-indexer status [--config <path>] [--json]
```

### CLI Exit Codes

| Code | Name | Description |
| :--- | :--- | :--- |
| `0` | `SUCCESS` | Clean termination or completed task. |
| `1` | `GENERAL_ERROR` | Unhandled runtime exception. |
| `2` | `INVALID_CONFIG` | Config file missing or failed Zod validation. |
| `3` | `RETENTION_WINDOW_EXCEEDED` | Cursor is older than RPC retention window. |
| `4` | `STORE_ERROR` | Database connection or schema migration failure. |
| `5` | `HANDLER_FAILED` | Handler threw error and exhausted `maxRetries`. |

---

## Troubleshooting

### RPC Retention Window Exceeded
Soroban RPC nodes retain a sliding window of recent ledgers (typically ~24 to ~72 hours). If you see:
```
[Retention Window Error] Requested ledger 5000 is older than the Soroban RPC node's retained history window.
```
**Fix**: Soroban RPC nodes do not store the full genesis history. Ingest historical events prior to this window using a Stellar History Archive or archival Soroban provider, or set `startLedger` to the oldest retained ledger.

### 429 Too Many Requests / Rate Limits
Public Soroban RPC endpoints enforce strict IP rate limits.
**Fix**: Increase `pollIntervalMs` to `2000` or higher, lower `limit`, or use a dedicated private Soroban RPC provider (e.g. QuickNode, Blockdaemon).

---

## Testing

Run the automated test suite:

```bash
# Run unit and engine tests (SQLite)
pnpm test

# Run tests with Postgres adapter (requires running PostgreSQL container)
TEST_DATABASE_URL=postgres://postgres:testpassword@localhost:5432/test_indexer pnpm test

# Run property-based tests
pnpm test tests/property.test.ts

# Optional: Run live testnet smoke test
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org pnpm run smoke:testnet
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, commit conventions, and pull request guidelines.

## License

[MIT](LICENSE) © 2026 `Agbelomo`
