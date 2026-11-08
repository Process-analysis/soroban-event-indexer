import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { type Store } from "../src/storage/store.js";
import { SqliteStore } from "../src/storage/sqlite.js";
import { PostgresStore } from "../src/storage/postgres.js";
import { type DecodedEvent } from "../src/types/index.js";
import { unlinkSync, existsSync } from "node:fs";

function createSampleEvent(id: string, ledger: number, contractId = "C111"): DecodedEvent {
  return {
    id,
    ledger,
    ledgerClosedAt: "2026-11-08T12:00:00Z",
    contractId,
    type: "contract",
    topics: ["VeryPrince", "OrgFunded", 12345n],
    data: { amount: 50000000n, recipient: "GABC123" },
    decodeError: false,
    rawTopicsXdr: ["AAA=="],
    rawDataXdr: "BBB==",
    pagingToken: `token-${id}`,
  };
}

/**
 * Shared Store Contract Test Suite.
 * Both SqliteStore and PostgresStore must pass this exact same specification.
 */
function runStoreContractSuite(
  name: string,
  storeFactory: () => Promise<{ store: Store; cleanup: () => Promise<void> }>,
) {
  describe(`Store Contract: ${name}`, () => {
    let store: Store;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      const res = await storeFactory();
      store = res.store;
      cleanup = res.cleanup;
      await store.init();
    });

    afterEach(async () => {
      await store.close();
      await cleanup();
    });

    it("initializes tables idempotently without throwing on repeated calls", async () => {
      await expect(store.init()).resolves.not.toThrow();
      await expect(store.init()).resolves.not.toThrow();
    });

    it("manages cursor checkpoint lifecycle", async () => {
      const initial = await store.getCursor();
      expect(initial).toBeNull();

      await store.setCursor("cursor-100", 100);
      const checkpoint1 = await store.getCursor();
      expect(checkpoint1).not.toBeNull();
      expect(checkpoint1?.cursor).toBe("cursor-100");
      expect(checkpoint1?.ledger).toBe(100);
      expect(checkpoint1?.updatedAt).toBeDefined();

      await store.setCursor("cursor-200", 200);
      const checkpoint2 = await store.getCursor();
      expect(checkpoint2?.cursor).toBe("cursor-200");
      expect(checkpoint2?.ledger).toBe(200);
    });

    it("inserts events idempotently (re-inserting does not duplicate or throw)", async () => {
      const evt1 = createSampleEvent("evt-1", 101);
      const evt2 = createSampleEvent("evt-2", 102);

      const insertedFirst = await store.insertEvents([evt1, evt2]);
      expect(insertedFirst).toBe(2);

      // Re-inserting the exact same events must be a no-op
      const insertedSecond = await store.insertEvents([evt1, evt2]);
      expect(insertedSecond).toBe(0);

      // Inserting mix of existing and new
      const evt3 = createSampleEvent("evt-3", 103);
      const insertedThird = await store.insertEvents([evt1, evt3]);
      expect(insertedThird).toBe(1);

      const allEvents = await store.getEvents();
      expect(allEvents).toHaveLength(3);
    });

    it("preserves BigInt values in topics and data across round-trip persistence", async () => {
      const evt = createSampleEvent("evt-bigint", 105);
      await store.insertEvents([evt]);

      const retrieved = await store.getEvents({ contractId: "C111" });
      expect(retrieved).toHaveLength(1);
      const first = retrieved[0]!;
      expect(first.topics[2]).toBe(12345n);
      expect((first.data as any).amount).toBe(50000000n);
    });

    it("supports atomic transactions and rolls back on failure", async () => {
      const evt1 = createSampleEvent("evt-tx-1", 110);
      const evt2 = createSampleEvent("evt-tx-2", 111);

      await expect(
        store.withTransaction(async (tx) => {
          await store.insertEvents([evt1], tx);
          await store.setCursor("cursor-tx-1", 110, tx);
          throw new Error("Simulated crash inside transaction");
        }),
      ).rejects.toThrow("Simulated crash inside transaction");

      // Verify rollback: events not present, cursor not advanced
      const cursor = await store.getCursor();
      expect(cursor).toBeNull();

      const events = await store.getEvents();
      expect(events.find((e) => e.id === "evt-tx-1")).toBeUndefined();

      // Successful commit in transaction
      await store.withTransaction(async (tx) => {
        await store.insertEvents([evt2], tx);
        await store.setCursor("cursor-tx-2", 111, tx);
      });

      const committedCursor = await store.getCursor();
      expect(committedCursor?.cursor).toBe("cursor-tx-2");
      expect(committedCursor?.ledger).toBe(111);
    });

    it("filters events by contractId, ledger range, and decodeError", async () => {
      const e1 = createSampleEvent("e1", 100, "C_AAA");
      const e2 = createSampleEvent("e2", 200, "C_AAA");
      const e3 = createSampleEvent("e3", 300, "C_BBB");
      e3.decodeError = true;
      e3.decodeErrorReason = "Corrupt payload";

      await store.insertEvents([e1, e2, e3]);

      const contractA = await store.getEvents({ contractId: "C_AAA" });
      expect(contractA).toHaveLength(2);

      const ledgerRange = await store.getEvents({ ledgerFrom: 150, ledgerTo: 250 });
      expect(ledgerRange).toHaveLength(1);
      expect(ledgerRange[0]?.id).toBe("e2");

      const decodeErrors = await store.getEvents({ decodeError: true });
      expect(decodeErrors).toHaveLength(1);
      expect(decodeErrors[0]?.id).toBe("e3");
    });

    it("calculates accurate stats summary", async () => {
      const e1 = createSampleEvent("s1", 50);
      const e2 = createSampleEvent("s2", 150);
      e2.decodeError = true;

      await store.insertEvents([e1, e2]);

      const stats = await store.getStats();
      expect(stats.totalEvents).toBe(2);
      expect(stats.decodeErrors).toBe(1);
      expect(stats.lastLedger).toBe(150);
    });
  });
}

// 1. Run store contract tests against SqliteStore
const testDbPath = "./test-contract.sqlite";
runStoreContractSuite("SqliteStore", async () => {
  if (existsSync(testDbPath)) unlinkSync(testDbPath);
  const store = new SqliteStore({ path: testDbPath });
  return {
    store,
    cleanup: async () => {
      if (existsSync(testDbPath)) unlinkSync(testDbPath);
    },
  };
});

// 2. Run store contract tests against PostgresStore (if TEST_DATABASE_URL is set)
const pgUrl = process.env["TEST_DATABASE_URL"];
if (pgUrl) {
  runStoreContractSuite("PostgresStore", async () => {
    const store = new PostgresStore({ connectionString: pgUrl });
    return {
      store,
      cleanup: async () => {
        // Clean up test tables between runs
        const p = (store as any).pool;
        await p.query("DROP TABLE IF EXISTS events, cursor_checkpoint");
      },
    };
  });
} else {
  console.log("Skipping PostgresStore tests: TEST_DATABASE_URL not set.");
}
