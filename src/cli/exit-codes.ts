/**
 * Standard process exit codes for soroban-indexer CLI.
 */
export const ExitCodes = {
  /** Clean process termination */
  SUCCESS: 0,
  /** Unhandled generic error */
  GENERAL_ERROR: 1,
  /** Configuration file missing or schema validation failed */
  INVALID_CONFIG: 2,
  /** Requested ledger position is older than RPC retention window */
  RETENTION_WINDOW_EXCEEDED: 3,
  /** Database connection or initialization failed */
  STORE_ERROR: 4,
  /** Event handler exceeded max retries and crashed */
  HANDLER_FAILED: 5,
} as const;

export type ExitCode = (typeof ExitCodes)[keyof typeof ExitCodes];
