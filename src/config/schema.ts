import { z } from "zod";

/**
 * Filter item schema.
 */
export const FilterConfigSchema = z.object({
  contractIds: z.array(z.string().min(1)).optional(),
  topics: z.array(z.union([z.string(), z.array(z.string())])).optional(),
});

/**
 * SQLite storage configuration.
 */
export const SqliteStorageConfigSchema = z.object({
  adapter: z.literal("sqlite"),
  path: z.string().default("./indexer.sqlite"),
});

/**
 * PostgreSQL storage configuration.
 */
export const PostgresStorageConfigSchema = z.object({
  adapter: z.literal("postgres"),
  connectionString: z.string().optional(),
  host: z.string().optional(),
  port: z.number().int().positive().optional().default(5432),
  database: z.string().optional(),
  user: z.string().optional(),
  password: z.string().optional(),
  ssl: z.boolean().optional().default(false),
});

/**
 * Combined storage configuration.
 */
export const StorageConfigSchema = z.discriminatedUnion("adapter", [
  SqliteStorageConfigSchema,
  PostgresStorageConfigSchema,
]);

/**
 * Metrics server configuration.
 */
export const MetricsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().positive().default(9090),
  host: z.string().default("0.0.0.0"),
});

/**
 * Complete Indexer Configuration Schema.
 */
export const IndexerConfigSchema = z.object({
  rpcUrl: z.string().url("Must be a valid Soroban RPC URL"),
  networkPassphrase: z.string().default("Test SDF Network ; September 2015"),
  startLedger: z.number().int().nonnegative().optional(),
  filters: z.array(FilterConfigSchema).default([]),
  storage: StorageConfigSchema.default({
    adapter: "sqlite",
    path: "./indexer.sqlite",
  }),
  pollIntervalMs: z.number().int().positive().default(1000),
  limit: z.number().int().positive().max(1000).default(100),
  maxRetries: z.number().int().nonnegative().default(5),
  backoffInitialMs: z.number().int().positive().default(500),
  backoffMaxMs: z.number().int().positive().default(30000),
  metrics: MetricsConfigSchema.default({
    enabled: false,
    port: 9090,
    host: "0.0.0.0",
  }),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
});

export type FilterConfig = z.infer<typeof FilterConfigSchema>;
export type StorageConfig = z.infer<typeof StorageConfigSchema>;
export type MetricsConfig = z.infer<typeof MetricsConfigSchema>;
export type IndexerConfig = z.infer<typeof IndexerConfigSchema>;
export type IndexerInputConfig = z.input<typeof IndexerConfigSchema>;
