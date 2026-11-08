# Prior Art & Ecosystem Landscape

Before creating `soroban-event-indexer`, we conducted a comprehensive review of existing tools, libraries, and frameworks within the Stellar/Soroban and broader blockchain ecosystems to determine whether an existing solution already solves this problem.

## Summary of Findings

| Name | Link | Scope & What It Does | Why `soroban-event-indexer` Differs |
| :--- | :--- | :--- | :--- |
| **Mercury SDK** | [npmjs.com/package/mercury-sdk](https://www.npmjs.com/package/mercury-sdk) | Cloud-managed and self-hostable full-network event indexing platform providing GraphQL subscriptions and full account indexing. | Mercury is designed as a heavy, multi-service backend infrastructure / hosted SaaS. It is not an embeddable, zero-dependency Node.js library or single-binary micro-daemon that developers can drop into a microservice with SQLite or Postgres. |
| **SoroScan** | [github.com/SoroScan/soroscan](https://github.com/SoroScan/soroscan) | Full-stack network explorer and indexer providing GraphQL APIs, REST webhooks, and UI for the entire network. | SoroScan is an explorer application rather than a reusable TypeScript toolkit/library. It does not provide an application-level event subscriber with transactional checkpointing in the consumer's local database. |
| **Sentinel** | [github.com/A4-Stellar/Sentinel](https://github.com/A4-Stellar/Sentinel) | High-throughput streaming and indexing daemon built in Rust and Go to overcome Soroban RPC node retention limits. | Sentinel is an enterprise service written in Go/Rust targeting data-tier streaming. It does not provide native TypeScript/JavaScript typed event handlers or lightweight embedded SQLite/Postgres persistence for dApp backends. |
| **Raw `@stellar/stellar-sdk` scripts** | [npmjs.com/package/@stellar/stellar-sdk](https://www.npmjs.com/package/@stellar/stellar-sdk) | The official JavaScript SDK providing low-level JSON-RPC clients (`rpc.Server.getEvents`) and XDR deserializers. | The official SDK provides raw primitives but no indexing lifecycle: no cursor persistence, no atomic commit loop, no automatic backoff/reconnection, no topic wildcard filtering, no decode error isolation, and no Prometheus metrics. Developers typically reinvent fragile `setInterval` loops with race conditions and missing cursor recovery. |
| **`soroban-event-dlq`** | [libraries.io/npm/soroban-event-dlq](https://libraries.io/npm/soroban-event-dlq) | Specialized Dead-Letter Queue helper for indexing pipelines. | Focuses purely on queuing failed events rather than ingestion, filtering, decoding, and transactional database storage. |

## Conclusion

No lightweight, open-source TypeScript library and CLI currently exists that offers:
1. Pluggable database adapters (zero-configuration SQLite and production-grade PostgreSQL).
2. Exactly-once storage semantics via single-transaction cursor and event persistence.
3. Resilient ScVal XDR decoding that isolates unparseable payloads without halting ingestion.
4. Typed event handler registries with rollback upon failure.
5. Actionable ledger retention window detection and Prometheus observability.

`soroban-event-indexer` fills this gap as a small, reliable, and rigorously tested toolkit.
