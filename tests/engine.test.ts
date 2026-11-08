import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SorobanIndexer, HandlerFailureError } from "../src/engine/index.js";
import { FakeSorobanRpcClient } from "../src/rpc/fake-client.js";
import { RetentionWindowExceededError } from "../src/rpc/client.js";
import { SqliteStore } from "../src/storage/sqlite.js";
import { type RawRpcEvent } from "../src/decode/index.js";
import { type DecodedEvent, type HandlerContext } from "../src/types/index.js";
import { xdr } from "@stellar/stellar-sdk";
import { unlinkSync, existsSync } from "node:fs";

function makeRawEvent(id: string, ledger: number, eventName = "OrgFunded"): RawRpcEvent {
  const sym = xdr.ScVal.scvSymbol(eventName).toXDR("base64");
  const prefix = xdr.ScVal.scvSymbol("VeryPrince").toXDR("base64");
  return {
    id,
    type: "contract",
    ledger,
    ledgerClosedAt: "2026-11-08T15:00:00Z",
    contractId: "CA3D5KRYMCMQU7YOGCVCPKZASDF1234567890ASDF1234567890ASDF12",
    topic: [prefix, sym],
    value: { xdr: sym },
    pagingToken: `token-${id}`,
  };
}

describe("SorobanIndexer Engine Tests", () => {
  const dbPath = "./test-engine.sqlite";
  let store: SqliteStore;
  let fakeRpc: FakeSorobanRpcClient;

  beforeEach(() => {
    if (existsSync(dbPath)) unlinkSync(dbPath);
    store = new SqliteStore({ path: dbPath });
    fakeRpc = new FakeSorobanRpcClient({
      latestLedger: 500,
      oldestRetainedLedger: 100,
    });
  });

  afterEach(async () => {
    await store.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it("handles normal paging across multiple RPC pages and advances cursor", async () => {
    // Add 5 events
    for (let i = 1; i <= 5; i++) {
      fakeRpc.addEvent(makeRawEvent(`evt-${i}`, 200 + i));
    }

    const indexer = new SorobanIndexer({
      config: {
        rpcUrl: "http://fake-rpc",
        storage: { adapter: "sqlite", path: dbPath },
        startLedger: 200,
        limit: 2, // 2 per page -> 3 pages
        pollIntervalMs: 10,
        maxRetries: 3,
        backoffInitialMs: 10,
        backoffMaxMs: 50,
        logLevel: "error",
        filters: [],
        metrics: { enabled: false, port: 9090, host: "0.0.0.0" },
        networkPassphrase: "Test",
      },
      store,
      rpcClient: fakeRpc,
    });

    await indexer.init();

    // Page 1: evt-1, evt-2
    const p1 = await indexer.step();
    expect(p1).toBe(2);
    let checkpoint = await store.getCursor();
    expect(checkpoint?.cursor).toBe("token-evt-2");

    // Page 2: evt-3, evt-4
    const p2 = await indexer.step();
    expect(p2).toBe(2);
    checkpoint = await store.getCursor();
    expect(checkpoint?.cursor).toBe("token-evt-4");

    // Page 3: evt-5
    const p3 = await indexer.step();
    expect(p3).toBe(1);
    checkpoint = await store.getCursor();
    expect(checkpoint?.cursor).toBe("token-evt-5");

    // Page 4: empty
    const p4 = await indexer.step();
    expect(p4).toBe(0);

    const storedEvents = await store.getEvents();
    expect(storedEvents).toHaveLength(5);
  });

  it("handles empty pages without advancing cursor or throwing errors", async () => {
    const indexer = new SorobanIndexer({
      config: {
        rpcUrl: "http://fake-rpc",
        storage: { adapter: "sqlite", path: dbPath },
        startLedger: 200,
        limit: 10,
        pollIntervalMs: 10,
        maxRetries: 3,
        backoffInitialMs: 10,
        backoffMaxMs: 50,
        logLevel: "error",
        filters: [],
        metrics: { enabled: false, port: 9090, host: "0.0.0.0" },
        networkPassphrase: "Test",
      },
      store,
      rpcClient: fakeRpc,
    });

    await indexer.init();
    const count = await indexer.step();
    expect(count).toBe(0);

    const checkpoint = await store.getCursor();
    expect(checkpoint).toBeNull();
  });

  it("handles duplicate delivery safely without duplicating stored records", async () => {
    // Add identical events
    fakeRpc.addEvent(makeRawEvent("dup-1", 201));
    fakeRpc.addEvent(makeRawEvent("dup-1", 201)); // duplicate id

    const indexer = new SorobanIndexer({
      config: {
        rpcUrl: "http://fake-rpc",
        storage: { adapter: "sqlite", path: dbPath },
        startLedger: 200,
        limit: 10,
        pollIntervalMs: 10,
        maxRetries: 3,
        backoffInitialMs: 10,
        backoffMaxMs: 50,
        logLevel: "error",
        filters: [],
        metrics: { enabled: false, port: 9090, host: "0.0.0.0" },
        networkPassphrase: "Test",
      },
      store,
      rpcClient: fakeRpc,
    });

    await indexer.init();
    await indexer.step();

    const stored = await store.getEvents();
    expect(stored).toHaveLength(1);
  });

  it("rolls back batch and does not advance cursor if handler crashes between fetch and commit", async () => {
    fakeRpc.addEvent(makeRawEvent("crash-evt", 205, "OrgFunded"));

    const indexer = new SorobanIndexer({
      config: {
        rpcUrl: "http://fake-rpc",
        storage: { adapter: "sqlite", path: dbPath },
        startLedger: 200,
        limit: 10,
        pollIntervalMs: 10,
        maxRetries: 3,
        backoffInitialMs: 10,
        backoffMaxMs: 50,
        logLevel: "error",
        filters: [],
        metrics: { enabled: false, port: 9090, host: "0.0.0.0" },
        networkPassphrase: "Test",
      },
      store,
      rpcClient: fakeRpc,
    });

    // Register a handler that writes derived row then throws
    indexer.on("OrgFunded", (_event: DecodedEvent, ctx: HandlerContext) => {
      ctx.tx.execute("CREATE TABLE IF NOT EXISTS test_derived (val INT)");
      ctx.tx.execute("INSERT INTO test_derived VALUES (999)");
      throw new Error("Simulated handler crash mid-batch");
    });

    await indexer.init();

    // Step must throw
    await expect(indexer.step()).rejects.toThrow("Simulated handler crash mid-batch");

    // Assert: events NOT committed, cursor NOT advanced
    const checkpoint = await store.getCursor();
    expect(checkpoint).toBeNull();

    const storedEvents = await store.getEvents();
    expect(storedEvents).toHaveLength(0);
  });

  it("retries failed steps and terminates with HandlerFailureError after maxRetries", async () => {
    fakeRpc.addEvent(makeRawEvent("fail-evt", 210, "PayoutClaimed"));

    const indexer = new SorobanIndexer({
      config: {
        rpcUrl: "http://fake-rpc",
        storage: { adapter: "sqlite", path: dbPath },
        startLedger: 200,
        limit: 10,
        pollIntervalMs: 5,
        maxRetries: 2,
        backoffInitialMs: 5,
        backoffMaxMs: 20,
        logLevel: "error",
        filters: [],
        metrics: { enabled: false, port: 9090, host: "0.0.0.0" },
        networkPassphrase: "Test",
      },
      store,
      rpcClient: fakeRpc,
    });

    let attempts = 0;
    indexer.on("PayoutClaimed", () => {
      attempts++;
      throw new Error("Persistent handler failure");
    });

    await expect(indexer.start()).rejects.toThrow(HandlerFailureError);
    expect(attempts).toBe(2);
  });

  it("detects when startLedger is older than RPC retention window and fails actionably", async () => {
    fakeRpc.oldestRetainedLedger = 1000;

    const indexer = new SorobanIndexer({
      config: {
        rpcUrl: "http://fake-rpc",
        storage: { adapter: "sqlite", path: dbPath },
        startLedger: 500, // older than 1000!
        limit: 10,
        pollIntervalMs: 10,
        maxRetries: 1,
        backoffInitialMs: 10,
        backoffMaxMs: 50,
        logLevel: "error",
        filters: [],
        metrics: { enabled: false, port: 9090, host: "0.0.0.0" },
        networkPassphrase: "Test",
      },
      store,
      rpcClient: fakeRpc,
    });

    await indexer.init();

    await expect(indexer.step()).rejects.toThrow(RetentionWindowExceededError);
    await expect(indexer.step()).rejects.toThrow(/retained history window/);
  });
});
