/**
 * Core type definitions for soroban-event-indexer.
 */

/**
 * Raw or decoded Soroban contract event.
 */
export interface DecodedEvent {
  /** Unique event identifier assigned by Soroban RPC: e.g. "0000000000000001-0000000001" */
  id: string;
  /** Ledger sequence number where this event was emitted */
  ledger: number;
  /** ISO-8601 timestamp of ledger close */
  ledgerClosedAt: string;
  /** Contract ID (strkey C... format) that emitted the event */
  contractId: string;
  /** Event type returned by RPC: contract, system, or diagnostic */
  type: "contract" | "system" | "diagnostic";
  /** Decoded topics array as native JS values (strings, bigints, arrays, objects) */
  topics: unknown[];
  /** Decoded data payload as native JS value */
  data: unknown;
  /** Flag indicating whether decoding encountered an unsupported or malformed ScVal */
  decodeError: boolean;
  /** Description of decode failure if decodeError is true */
  decodeErrorReason?: string | undefined;
  /** Raw base64-encoded XDR representation of topics */
  rawTopicsXdr: string[];
  /** Raw base64-encoded XDR representation of data */
  rawDataXdr: string;
  /** Pagination paging token from the RPC */
  pagingToken: string;
  /** Timestamp when event was indexed into the database */
  indexedAt?: string | undefined;
}

/**
 * Transaction abstraction allowing database writes within the same transaction.
 */
export interface DatabaseTransaction {
  /** Execute an arbitrary SQL statement with parameters */
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> | T[];
  /** Execute an arbitrary SQL write statement (INSERT/UPDATE/DELETE) */
  execute(sql: string, params?: unknown[]): Promise<number> | number;
}

/**
 * Context passed to event handler functions.
 */
export interface HandlerContext {
  /** Active database transaction for writing derived state */
  tx: DatabaseTransaction;
  /** Ledger sequence number of current batch */
  ledger: number;
  /** RPC cursor position of current event */
  cursor: string;
}

/**
 * Event handler function signature.
 */
export type EventHandler<T = DecodedEvent> = (
  event: T,
  ctx: HandlerContext,
) => Promise<void> | void;

/**
 * Filter configuration for matching events.
 */
export interface EventFilter {
  /** Target contract ID(s) to monitor */
  contractIds?: string[] | undefined;
  /** Topic pattern filter (e.g. ["VeryPrince", "*"]) */
  topics?: Array<string | string[]> | undefined;
}

/**
 * Checkpoint cursor persisted in storage.
 */
export interface CursorCheckpoint {
  /** The last processed RPC paging cursor */
  cursor: string;
  /** The last processed ledger sequence number */
  ledger: number;
  /** Timestamp when cursor was last updated */
  updatedAt: string;
}

/**
 * Indexer status summary.
 */
export interface IndexerStatus {
  cursor: string | null;
  currentLedger: number;
  latestLedger: number;
  lag: number;
  eventsCount: number;
  decodeErrorsCount: number;
  lastError: string | null;
  updatedAt: string | null;
}
