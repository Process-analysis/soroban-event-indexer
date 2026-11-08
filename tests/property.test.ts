import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { SqliteStore } from "../src/storage/sqlite.js";
import { type DecodedEvent } from "../src/types/index.js";
import { unlinkSync, existsSync } from "node:fs";

function makeEvent(id: string, ledger: number): DecodedEvent {
  return {
    id,
    ledger,
    ledgerClosedAt: "2026-11-08T12:00:00Z",
    contractId: "C111",
    type: "contract",
    topics: ["VeryPrince", "OrgFunded"],
    data: { amount: 100n },
    decodeError: false,
    rawTopicsXdr: [],
    rawDataXdr: "",
    pagingToken: `token-${id}`,
  };
}

describe("Property-based State Consistency Tests (fast-check)", () => {
  it("proves that for any sequence of event batches with duplicates and random crashes, storage is strictly de-duplicated and cursor equals max processed position", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate batches of events where IDs can repeat (duplicates) and ledgers increase
        fc.array(
          fc.record({
            id: fc.integer({ min: 1, max: 20 }).map((n) => `evt-${n}`),
            ledgerOffset: fc.integer({ min: 1, max: 10 }),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        // Random boolean vector for simulating crash points
        fc.array(fc.boolean(), { minLength: 1, maxLength: 40 }),
        async (rawBatchDefs, crashPoints) => {
          const dbPath = `./test-prop-${Math.random().toString(36).substring(7)}.sqlite`;
          const store = new SqliteStore({ path: dbPath });
          await store.init();

          try {
            let currentLedger = 1000;
            const events: DecodedEvent[] = [];
            for (const def of rawBatchDefs) {
              currentLedger += def.ledgerOffset;
              events.push(makeEvent(def.id, currentLedger));
            }

            // Split into chunks/batches
            const chunkSize = 3;
            const successfullyCommitted = new Map<string, DecodedEvent>();
            let highestCommittedCursor: string | null = null;
            let highestCommittedLedger = 0;

            let crashIdx = 0;

            for (let i = 0; i < events.length; i += chunkSize) {
              const chunk = events.slice(i, i + chunkSize);
              const shouldCrash = crashPoints[crashIdx % crashPoints.length] ?? false;
              crashIdx++;

              if (shouldCrash) {
                // Simulate crash: transaction throws mid-flight
                try {
                  await store.withTransaction(async (tx) => {
                    await store.insertEvents(chunk, tx);
                    const last = chunk[chunk.length - 1]!;
                    await store.setCursor(last.pagingToken, last.ledger, tx);
                    throw new Error("Simulated mid-flight crash");
                  });
                } catch {
                  // Rolled back; now retry batch (as engine does)
                  await store.withTransaction(async (tx) => {
                    await store.insertEvents(chunk, tx);
                    const last = chunk[chunk.length - 1]!;
                    await store.setCursor(last.pagingToken, last.ledger, tx);
                  });
                  for (const e of chunk) {
                    successfullyCommitted.set(e.id, e);
                  }
                  const last = chunk[chunk.length - 1]!;
                  highestCommittedCursor = last.pagingToken;
                  highestCommittedLedger = last.ledger;
                }
              } else {
                // Successful batch commit
                await store.withTransaction(async (tx) => {
                  await store.insertEvents(chunk, tx);
                  const last = chunk[chunk.length - 1]!;
                  await store.setCursor(last.pagingToken, last.ledger, tx);
                });
                for (const e of chunk) {
                  successfullyCommitted.set(e.id, e);
                }
                const last = chunk[chunk.length - 1]!;
                highestCommittedCursor = last.pagingToken;
                highestCommittedLedger = last.ledger;
              }
            }

            // Invariance Checks
            // 1. Total rows in database must equal unique committed event IDs
            const storedEvents = await store.getEvents();
            expect(storedEvents.length).toBe(successfullyCommitted.size);

            // 2. Stored event IDs set must equal the expected de-duplicated set
            const storedIds = new Set(storedEvents.map((e) => e.id));
            expect(storedIds).toEqual(new Set(successfullyCommitted.keys()));

            // 3. Persisted cursor must match the max committed position
            const checkpoint = await store.getCursor();
            expect(checkpoint?.cursor).toBe(highestCommittedCursor);
            expect(checkpoint?.ledger).toBe(highestCommittedLedger);
          } finally {
            await store.close();
            if (existsSync(dbPath)) unlinkSync(dbPath);
          }
        },
      ),
      { numRuns: 25 },
    );
  });
});
