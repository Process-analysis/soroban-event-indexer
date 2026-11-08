import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SorobanIndexer,
  FakeSorobanRpcClient,
  type HandlerContext,
  type DecodedEvent,
} from "../../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Illustrative Example: Very-Prince Payout Registry Indexer
 *
 * This example indexes events from a payout registry smart contract:
 * - Topics: ("VeryPrince", "<EventName>")
 * - Events: Initialized, OrgFunded, PayoutAllocated, PayoutClaimed
 * - Calculates running aggregate balances per organization in SQLite.
 */
async function main() {
  const useFixtures = process.env["USE_FIXTURES"] !== "0";

  let rpcClient;
  if (useFixtures) {
    const fixturePath = resolve(__dirname, "fixtures/rpc-events.json");
    const rawEvents = JSON.parse(readFileSync(fixturePath, "utf-8"));
    rpcClient = new FakeSorobanRpcClient({
      events: rawEvents,
      latestLedger: 1010,
      oldestRetainedLedger: 500,
    });
    // eslint-disable-next-line no-console
    console.log("Using recorded offline RPC fixtures (no network required).");
  }

  const dbPath = resolve(__dirname, "payout-example.sqlite");

  const indexer = new SorobanIndexer({
    config: {
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
      startLedger: 1000,
      pollIntervalMs: 500,
      limit: 10,
      maxRetries: 3,
      backoffInitialMs: 100,
      backoffMaxMs: 1000,
      logLevel: "info",
      storage: {
        adapter: "sqlite",
        path: dbPath,
      },
      filters: [
        {
          topics: [["VeryPrince", "*"]],
        },
      ],
      metrics: {
        enabled: false,
        port: 9090,
        host: "0.0.0.0",
      },
    },
    rpcClient,
  });

  // Initialize store and execute custom derived state schema
  await indexer.init();

  const schemaPath = resolve(__dirname, "schema.sql");
  const schemaSql = readFileSync(schemaPath, "utf-8");
  await indexer.store.withTransaction(async (tx) => {
    tx.execute(schemaSql);
  });

  // Helper to upsert organization aggregate balances within handler transaction ctx.tx
  const updateOrgAggregate = (
    ctx: HandlerContext,
    orgId: string,
    fundedDelta: bigint,
    allocatedDelta: bigint,
    claimedDelta: bigint,
  ) => {
    const now = new Date().toISOString();
    ctx.tx.execute(
      `
      INSERT INTO org_payout_aggregates (
        org_id, total_funded, total_allocated, total_claimed, events_count, last_updated_ledger, last_updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(org_id) DO UPDATE SET
        total_funded = total_funded + excluded.total_funded,
        total_allocated = total_allocated + excluded.total_allocated,
        total_claimed = total_claimed + excluded.total_claimed,
        events_count = events_count + 1,
        last_updated_ledger = excluded.last_updated_ledger,
        last_updated_at = excluded.last_updated_at
      `,
      [
        orgId,
        fundedDelta.toString(),
        allocatedDelta.toString(),
        claimedDelta.toString(),
        ctx.ledger,
        now,
      ],
    );
  };

  // Register Event Handlers
  indexer.on("Initialized", (event: DecodedEvent, _ctx: HandlerContext) => {
    // eslint-disable-next-line no-console
    console.log(`[Event: Initialized] Contract initialized at ledger ${event.ledger}`);
  });

  indexer.on("OrgFunded", (event: DecodedEvent, ctx: HandlerContext) => {
    // Extract org_id and amount from event data
    const data: any = event.data;
    const orgId = Array.isArray(data) ? String(data[0]) : "org1";
    const amount = Array.isArray(data) && data[2] ? BigInt(data[2]) : 10000n;

    // eslint-disable-next-line no-console
    console.log(`[Event: OrgFunded] Org: ${orgId}, Funded: ${amount} stroops (ledger ${ctx.ledger})`);
    updateOrgAggregate(ctx, orgId, amount, 0n, 0n);
  });

  indexer.on("PayoutAllocated", (event: DecodedEvent, ctx: HandlerContext) => {
    const data: any = event.data;
    const orgId = Array.isArray(data) ? String(data[0]) : "org1";
    const amount = Array.isArray(data) && data[2] ? BigInt(data[2]) : 1000n;

    // eslint-disable-next-line no-console
    console.log(`[Event: PayoutAllocated] Org: ${orgId}, Allocated: ${amount} stroops (ledger ${ctx.ledger})`);
    updateOrgAggregate(ctx, orgId, 0n, amount, 0n);
  });

  indexer.on("PayoutClaimed", (event: DecodedEvent, ctx: HandlerContext) => {
    const data: any = event.data;
    const orgId = Array.isArray(data) ? String(data[0]) : "org1";
    const amount = Array.isArray(data) && data[2] ? BigInt(data[2]) : 1000n;

    // eslint-disable-next-line no-console
    console.log(`[Event: PayoutClaimed] Org: ${orgId}, Claimed: ${amount} stroops (ledger ${ctx.ledger})`);
    updateOrgAggregate(ctx, orgId, 0n, 0n, amount);
  });

  // Step through all available events
  let processed = 0;
  while ((await indexer.step()) > 0) {
    processed++;
  }

  // Print results from SQLite derived table
  const results = await indexer.store.withTransaction(async (tx) => {
    return tx.query("SELECT * FROM org_payout_aggregates ORDER BY org_id ASC");
  });

  // eslint-disable-next-line no-console
  console.log("\n==========================================");
  // eslint-disable-next-line no-console
  console.log("       ORGANIZATION PAYOUT TOTALS        ");
  // eslint-disable-next-line no-console
  console.log("==========================================");
  // eslint-disable-next-line no-console
  console.table(results);

  await indexer.stop();
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Example run failed:", err);
    process.exit(1);
  });
}

export { main };
