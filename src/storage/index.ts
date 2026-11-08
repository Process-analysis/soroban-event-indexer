import { type Store } from "./store.js";
import { SqliteStore } from "./sqlite.js";
import { PostgresStore, type PostgresStoreOptions } from "./postgres.js";
import { type StorageConfig } from "../config/schema.js";

export function createStore(config: StorageConfig): Store {
  if (config.adapter === "sqlite") {
    return new SqliteStore({ path: config.path });
  }

  if (config.adapter === "postgres") {
    return new PostgresStore(config as PostgresStoreOptions);
  }

  throw new Error(`Unsupported storage adapter: ${(config as any).adapter}`);
}

export * from "./store.js";
export * from "./sqlite.js";
export * from "./postgres.js";
