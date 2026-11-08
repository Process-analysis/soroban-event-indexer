import { describe, it, expect } from "vitest";
import { DefaultSorobanRpcClient } from "../src/rpc/client.js";

const rpcUrl = process.env["SOROBAN_RPC_URL"];

describe("Live Testnet Smoke Test (Optional)", () => {
  if (!rpcUrl) {
    it.skip("Skipped: SOROBAN_RPC_URL environment variable is not defined", () => {
      // Reason: Live testnet tests require active network connection and SOROBAN_RPC_URL
    });
    return;
  }

  it("successfully connects to live Soroban RPC and fetches latest ledger", async () => {
    const client = new DefaultSorobanRpcClient({ rpcUrl });
    const latest = await client.getLatestLedger();

    expect(latest.sequence).toBeGreaterThan(0);
    expect(latest.protocolVersion).toBeGreaterThanOrEqual(20);
    expect(typeof latest.id).toBe("string");
  });
});
