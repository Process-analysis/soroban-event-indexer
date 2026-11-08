import { describe, it, expect } from "vitest";
import { validateConfig } from "../src/config/index.js";

describe("Configuration and Validation Tests", () => {
  it("populates defaults for minimal valid configuration", () => {
    const raw = {
      rpcUrl: "https://soroban-testnet.stellar.org",
    };

    const config = validateConfig(raw);
    expect(config.rpcUrl).toBe("https://soroban-testnet.stellar.org");
    expect(config.pollIntervalMs).toBe(1000);
    expect(config.limit).toBe(100);
    expect(config.maxRetries).toBe(5);
    expect(config.storage.adapter).toBe("sqlite");
    expect(config.networkPassphrase).toBe("Test SDF Network ; September 2015");
  });

  it("validates postgres storage configuration", () => {
    const raw = {
      rpcUrl: "https://soroban-testnet.stellar.org",
      storage: {
        adapter: "postgres",
        connectionString: "postgres://user:pass@localhost:5432/db",
      },
    };

    const config = validateConfig(raw);
    expect(config.storage.adapter).toBe("postgres");
    if (config.storage.adapter === "postgres") {
      expect(config.storage.connectionString).toBe("postgres://user:pass@localhost:5432/db");
    }
  });

  it("rejects invalid rpcUrl format", () => {
    const raw = {
      rpcUrl: "not-a-valid-url",
    };

    expect(() => validateConfig(raw)).toThrow(/Must be a valid Soroban RPC URL/);
  });

  it("rejects negative pollIntervalMs or zero limit", () => {
    const rawNegative = {
      rpcUrl: "https://soroban-testnet.stellar.org",
      pollIntervalMs: -100,
    };
    expect(() => validateConfig(rawNegative)).toThrow();

    const rawZeroLimit = {
      rpcUrl: "https://soroban-testnet.stellar.org",
      limit: 0,
    };
    expect(() => validateConfig(rawZeroLimit)).toThrow();
  });

  it("rejects limit greater than 1000", () => {
    const raw = {
      rpcUrl: "https://soroban-testnet.stellar.org",
      limit: 5000,
    };
    expect(() => validateConfig(raw)).toThrow();
  });

  it("validates custom filters with wildcard topics", () => {
    const raw = {
      rpcUrl: "https://soroban-testnet.stellar.org",
      filters: [
        {
          contractIds: ["CA3D5KRYMCMQU7YOGCVCPKZASDF1234567890ASDF1234567890ASDF12"],
          topics: [["VeryPrince", "*"]],
        },
      ],
    };

    const config = validateConfig(raw);
    expect(config.filters).toHaveLength(1);
    expect(config.filters[0]?.topics).toEqual([["VeryPrince", "*"]]);
  });
});
