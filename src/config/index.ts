import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { IndexerConfigSchema, type IndexerConfig, type IndexerInputConfig } from "./schema.js";

/**
 * Load and validate indexer configuration from a file path or environment.
 */
export function loadConfig(configPath?: string): IndexerConfig {
  let fileConfig: Record<string, unknown> = {};

  const targetPath = configPath
    ? resolve(process.cwd(), configPath)
    : resolve(process.cwd(), "soroban-indexer.json");

  if (existsSync(targetPath)) {
    try {
      const content = readFileSync(targetPath, "utf-8");
      fileConfig = JSON.parse(content) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `Failed to parse configuration file at "${targetPath}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else if (configPath) {
    throw new Error(`Configuration file not found at: ${targetPath}`);
  }

  // Allow environment variables to override or provide fallbacks
  const merged: IndexerInputConfig = {
    rpcUrl: (process.env["SOROBAN_RPC_URL"] as string) || (fileConfig["rpcUrl"] as string),
    networkPassphrase:
      (process.env["STELLAR_NETWORK_PASSPHRASE"] as string) ||
      (fileConfig["networkPassphrase"] as string),
    startLedger:
      process.env["START_LEDGER"] !== undefined
        ? parseInt(process.env["START_LEDGER"], 10)
        : (fileConfig["startLedger"] as number | undefined),
    limit:
      process.env["INDEXER_LIMIT"] !== undefined
        ? parseInt(process.env["INDEXER_LIMIT"], 10)
        : (fileConfig["limit"] as number | undefined),
    pollIntervalMs:
      process.env["POLL_INTERVAL_MS"] !== undefined
        ? parseInt(process.env["POLL_INTERVAL_MS"], 10)
        : (fileConfig["pollIntervalMs"] as number | undefined),
    logLevel: (process.env["LOG_LEVEL"] as any) || (fileConfig["logLevel"] as any),
    filters: (fileConfig["filters"] as any) || [],
    storage: (fileConfig["storage"] as any) || undefined,
    metrics: (fileConfig["metrics"] as any) || undefined,
    maxRetries: fileConfig["maxRetries"] as number | undefined,
    backoffInitialMs: fileConfig["backoffInitialMs"] as number | undefined,
    backoffMaxMs: fileConfig["backoffMaxMs"] as number | undefined,
  };

  const parsed = IndexerConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid indexer configuration:\n${issues}`);
  }

  return parsed.data;
}

/**
 * Validate an in-memory configuration object against the schema.
 */
export function validateConfig(config: unknown): IndexerConfig {
  const result = IndexerConfigSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid indexer configuration:\n${issues}`);
  }
  return result.data;
}

export * from "./schema.js";
