import { loadConfig } from "../../config/index.js";
import { SorobanIndexer } from "../../engine/index.js";
import { RetentionWindowExceededError } from "../../rpc/client.js";
import { ExitCodes } from "../exit-codes.js";

export interface RunCommandOptions {
  config?: string | undefined;
}

export async function runCommand(options: RunCommandOptions): Promise<void> {
  let config;
  try {
    config = loadConfig(options.config);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Configuration Error] ${msg}`);
    process.exit(ExitCodes.INVALID_CONFIG);
  }

  const indexer = new SorobanIndexer({ config });

  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    try {
      await indexer.stop();
      process.exit(ExitCodes.SUCCESS);
    } catch (err) {
      console.error("Error during graceful shutdown:", err);
      process.exit(ExitCodes.GENERAL_ERROR);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await indexer.start();
  } catch (err: unknown) {
    if (err instanceof RetentionWindowExceededError) {
      console.error(`\n[Retention Window Error] ${err.message}\n`);
      process.exit(ExitCodes.RETENTION_WINDOW_EXCEEDED);
    }

    if (err instanceof Error && err.name === "HandlerFailureError") {
      console.error(`\n[Handler Failure] ${err.message}\n`);
      process.exit(ExitCodes.HANDLER_FAILED);
    }

    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n[Fatal Error] ${msg}\n`);
    process.exit(ExitCodes.GENERAL_ERROR);
  }
}
