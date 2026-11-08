import {
  type DecodedEvent,
  type CursorCheckpoint,
  type DatabaseTransaction,
} from "../types/index.js";

export interface EventQueryFilter {
  contractId?: string;
  ledgerFrom?: number;
  ledgerTo?: number;
  decodeError?: boolean;
  limit?: number;
  offset?: number;
}

export interface StoreStats {
  totalEvents: number;
  decodeErrors: number;
  lastLedger: number;
}

/**
 * Storage adapter interface decoupling the core engine from database implementations.
 */
export interface Store {
  /** Initialize tables, indexes, and schemas */
  init(): Promise<void>;

  /** Retrieve the latest persisted cursor checkpoint */
  getCursor(): Promise<CursorCheckpoint | null>;

  /**
   * Persist a new cursor checkpoint.
   * If tx is provided, executes within that active transaction.
   */
  setCursor(cursor: string, ledger: number, tx?: DatabaseTransaction): Promise<void>;

  /**
   * Idempotently insert decoded events.
   * Re-processing existing event IDs is a no-op (ON CONFLICT IGNORE).
   * Returns count of newly inserted events.
   */
  insertEvents(events: DecodedEvent[], tx?: DatabaseTransaction): Promise<number>;

  /**
   * Execute an atomic database transaction.
   * If fn throws, the transaction is rolled back; otherwise committed.
   */
  withTransaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;

  /** Query stored events with optional filters */
  getEvents(filter?: EventQueryFilter): Promise<DecodedEvent[]>;

  /** Query summary counts and latest position */
  getStats(): Promise<StoreStats>;

  /** Close database connections / pools */
  close(): Promise<void>;
}

/**
 * Serialize values with BigInt support.
 */
export function safeStringify(val: unknown): string {
  return JSON.stringify(val, (_, v) => (typeof v === "bigint" ? `${v.toString()}n` : v));
}

/**
 * Parse JSON strings restoring BigInt values.
 */
export function safeParse(str: string | null | undefined): unknown {
  if (!str) return null;
  return JSON.parse(str, (_, v) => {
    if (typeof v === "string" && /^-?\d+n$/.test(v)) {
      return BigInt(v.slice(0, -1));
    }
    return v;
  });
}
