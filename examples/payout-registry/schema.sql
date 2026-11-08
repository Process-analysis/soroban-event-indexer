-- Derived state schema for Very-Prince payout registry
CREATE TABLE IF NOT EXISTS org_payout_aggregates (
  org_id TEXT PRIMARY KEY,
  total_funded BIGINT NOT NULL DEFAULT 0,
  total_allocated BIGINT NOT NULL DEFAULT 0,
  total_claimed BIGINT NOT NULL DEFAULT 0,
  events_count INTEGER NOT NULL DEFAULT 0,
  last_updated_ledger INTEGER NOT NULL,
  last_updated_at TEXT NOT NULL
);
