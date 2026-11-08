import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface InitCommandOptions {
  path?: string | undefined;
  force?: boolean | undefined;
}

export function initCommand(options: InitCommandOptions): void {
  const targetPath = resolve(process.cwd(), options.path || "soroban-indexer.json");

  if (existsSync(targetPath) && !options.force) {
    console.error(
      `Error: Configuration file already exists at ${targetPath}. Use --force to overwrite.`,
    );
    process.exit(1);
  }

  const templateConfig = {
    $schema: "./node_modules/soroban-event-indexer/schema.json",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    storage: {
      adapter: "sqlite",
      path: "./indexer.sqlite",
    },
    pollIntervalMs: 1000,
    limit: 100,
    maxRetries: 5,
    backoffInitialMs: 500,
    backoffMaxMs: 30000,
    filters: [
      {
        contractIds: ["CA3D5KRYMCMQU7YOGCVCPKZASDF1234567890ASDF1234567890ASDF12"],
        topics: [["VeryPrince", "*"]],
      },
    ],
    metrics: {
      enabled: false,
      port: 9090,
      host: "0.0.0.0",
    },
    logLevel: "info",
  };

  writeFileSync(targetPath, JSON.stringify(templateConfig, null, 2) + "\n", "utf-8");
  console.log(`Created template configuration file at: ${targetPath}`);
}
