import { loadConfig } from "../../config/index.js";
import { SorobanIndexer } from "../../engine/index.js";
import { ExitCodes } from "../exit-codes.js";

export interface StatusCommandOptions {
  config?: string | undefined;
  json?: boolean | undefined;
}

export async function statusCommand(options: StatusCommandOptions): Promise<void> {
  let config;
  try {
    config = loadConfig(options.config);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Configuration Error] ${msg}`);
    process.exit(ExitCodes.INVALID_CONFIG);
  }

  const indexer = new SorobanIndexer({ config });

  try {
    await indexer.init();
    const status = await indexer.getStatus();
    await indexer.stop();

    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
      process.exit(ExitCodes.SUCCESS);
    }

    console.log("\n--- Soroban Event Indexer Status ---");
    console.log(`Current Ledger:       ${status.currentLedger}`);
    console.log(`Latest RPC Ledger:    ${status.latestLedger}`);
    console.log(`Lag:                  ${status.lag} ledgers`);
    console.log(`Active Cursor:        ${status.cursor || "(None - at head or start ledger)"}`);
    console.log(`Total Stored Events:  ${status.eventsCount}`);
    console.log(`Decode Errors:        ${status.decodeErrorsCount}`);
    console.log(`Last Error:           ${status.lastError || "None"}`);
    console.log(`Last Updated At:      ${status.updatedAt || "N/A"}\n`);

    process.exit(ExitCodes.SUCCESS);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n[Status Error] ${msg}\n`);
    await indexer.stop();
    process.exit(ExitCodes.STORE_ERROR);
  }
}
