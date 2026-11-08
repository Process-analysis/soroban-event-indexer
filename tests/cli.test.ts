import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initCommand } from "../src/cli/commands/init.js";
import { ExitCodes } from "../src/cli/exit-codes.js";
import { existsSync, unlinkSync, readFileSync } from "node:fs";

describe("CLI Commands Unit Tests", () => {
  const testConfigPath = "./test-cli-config.json";

  beforeEach(() => {
    if (existsSync(testConfigPath)) unlinkSync(testConfigPath);
  });

  afterEach(() => {
    if (existsSync(testConfigPath)) unlinkSync(testConfigPath);
  });

  it("initCommand writes valid template config file", () => {
    initCommand({ path: testConfigPath });
    expect(existsSync(testConfigPath)).toBe(true);

    const content = JSON.parse(readFileSync(testConfigPath, "utf-8"));
    expect(content.rpcUrl).toBe("https://soroban-testnet.stellar.org");
    expect(content.storage.adapter).toBe("sqlite");
    expect(content.filters).toBeDefined();
  });

  it("defines standard semantic ExitCodes", () => {
    expect(ExitCodes.SUCCESS).toBe(0);
    expect(ExitCodes.GENERAL_ERROR).toBe(1);
    expect(ExitCodes.INVALID_CONFIG).toBe(2);
    expect(ExitCodes.RETENTION_WINDOW_EXCEEDED).toBe(3);
    expect(ExitCodes.STORE_ERROR).toBe(4);
    expect(ExitCodes.HANDLER_FAILED).toBe(5);
  });
});
