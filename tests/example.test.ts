import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { main } from "../examples/payout-registry/index.js";
import { existsSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteStore } from "../src/storage/sqlite.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const exampleDbPath = resolve(__dirname, "../examples/payout-registry/payout-example.sqlite");

describe("Payout Registry Example Integration Test", () => {
  beforeEach(() => {
    if (existsSync(exampleDbPath)) unlinkSync(exampleDbPath);
  });

  afterEach(() => {
    if (existsSync(exampleDbPath)) unlinkSync(exampleDbPath);
  });

  it("runs the offline example end-to-end and updates aggregate totals per organization", async () => {
    process.env["USE_FIXTURES"] = "1";
    await main();

    expect(existsSync(exampleDbPath)).toBe(true);
    const store = new SqliteStore({ path: exampleDbPath });
    await store.init();

    const rows = await store.withTransaction(async (tx) => {
      return tx.query<any>("SELECT * FROM org_payout_aggregates WHERE org_id = 'org1'");
    });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.org_id).toBe("org1");
    expect(Number(row.total_funded)).toBeGreaterThan(0);
    expect(Number(row.total_allocated)).toBeGreaterThan(0);
    expect(Number(row.total_claimed)).toBeGreaterThan(0);

    await store.close();
  });
});
