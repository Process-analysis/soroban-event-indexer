# Very-Prince Payout Registry Example

This directory contains a complete, runnable example demonstrating how to use `soroban-event-indexer` to index smart contract events from a reference payout registry contract into SQLite and compute derived running aggregate totals.

> **Note**: This reference use case models the event names and data shapes of the Very-Prince payout registry contract (`Initialized`, `OrgFunded`, `PayoutAllocated`, `PayoutClaimed` with topics `("VeryPrince", "<EventName>")`). It serves as an illustrative, self-contained example.

## What It Demonstrates

1. **Transactional Event Handling**: Deriving custom relational state (`org_payout_aggregates` table) using the same transactional context (`ctx.tx`) that stores the events and checkpoints the cursor.
2. **Offline Testing with Recorded Fixtures**: Includes pre-recorded RPC response fixtures in `fixtures/rpc-events.json`, allowing the example to run and test immediately without an active Soroban RPC node or internet connection.
3. **Running Aggregates**: Automatically increments `total_funded`, `total_allocated`, and `total_claimed` per organization whenever corresponding events occur.

## How to Run

From the repository root:

```bash
# Run with offline recorded fixtures (default, no network required):
npx tsx examples/payout-registry/index.ts

# Or run against live Soroban testnet RPC:
USE_FIXTURES=0 npx tsx examples/payout-registry/index.ts
```

## Schema

See [schema.sql](./schema.sql):
- `org_id`: Organization identifier
- `total_funded`: Total funds deposited to the organization
- `total_allocated`: Total payouts allocated to contributors
- `total_claimed`: Total payouts claimed by recipients
- `events_count`: Number of processed events for this organization
- `last_updated_ledger`: Ledger sequence of the most recent event
- `last_updated_at`: Timestamp of the update
