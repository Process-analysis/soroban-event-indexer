import { loadConfig } from "../../config/index.js";
import { SorobanIndexer } from "../../engine/index.js";
import { ExitCodes } from "../exit-codes.js";

export interface BackfillCommandOptions {
  from: string;
  to: string;
  config?: string;
}

export async function backfillCommand(options: BackfillCommandOptions): Promise<void> {
  const fromLedger = parseInt(options.from, 10);
  const toLedger = parseInt(options.to, 10);

  if (isNaN(fromLedger) || isNaN(toLedger)) {
    console.error("Error: --from and --to must be valid integer ledger numbers.");
    process.exit(ExitCodes.INVALID_CONFIG);
  }

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
    const total = await indexer.backfill(fromLedger, toLedger);
    console.log(
      `\nBackfill complete! Indexed ${total} events across ledgers ${fromLedger}..${toLedger}.`,
    );
    await indexer.stop();
    process.exit(ExitCodes.SUCCESS);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n[Backfill Error] ${msg}`);
    await indexer.stop();
    process.exit(ExitCodes.GENERAL_ERROR);
  }
}
