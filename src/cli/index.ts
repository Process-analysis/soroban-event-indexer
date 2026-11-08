#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { runCommand } from "./commands/run.js";
import { backfillCommand } from "./commands/backfill.js";
import { statusCommand } from "./commands/status.js";

const program = new Command();

program
  .name("soroban-indexer")
  .description(
    "Reliable, reusable toolkit to index and decode Soroban contract events with transactional checkpointing.",
  )
  .version("0.1.0");

program
  .command("init")
  .description("Generate a template soroban-indexer.json configuration file")
  .option("-p, --path <path>", "Destination config file path", "soroban-indexer.json")
  .option("-f, --force", "Overwrite existing file if present", false)
  .action((options) => {
    initCommand(options);
  });

program
  .command("run")
  .description("Start the live continuous event indexing daemon")
  .option("-c, --config <path>", "Path to configuration file")
  .action(async (options) => {
    await runCommand(options);
  });

program
  .command("backfill")
  .description("Backfill historical contract events between two ledger sequence numbers")
  .requiredOption("--from <ledger>", "Start ledger sequence number")
  .requiredOption("--to <ledger>", "End ledger sequence number")
  .option("-c, --config <path>", "Path to configuration file")
  .action(async (options) => {
    await backfillCommand(options);
  });

program
  .command("status")
  .description("Inspect current cursor checkpoint, ledger lag, and indexing statistics")
  .option("-c, --config <path>", "Path to configuration file")
  .option("--json", "Output status as machine-readable JSON", false)
  .action(async (options) => {
    await statusCommand(options);
  });

program.parse(process.argv);
