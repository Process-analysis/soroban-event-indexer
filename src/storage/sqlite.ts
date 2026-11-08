import {
  type Store,
  type EventQueryFilter,
  type StoreStats,
  safeStringify,
  safeParse,
} from "./store.js";
import {
  type DecodedEvent,
  type CursorCheckpoint,
  type DatabaseTransaction,
} from "../types/index.js";

export interface SqliteStoreOptions {
  path: string;
}

interface SqliteEventRow {
  id: string;
  ledger: number;
  ledger_closed_at: string;
  contract_id: string;
  type: "contract" | "system" | "diagnostic";
  topics: string;
  data: string | null;
  decode_error: number;
  decode_error_reason: string | null;
  raw_topics_xdr: string;
  raw_data_xdr: string;
  paging_token: string;
  indexed_at: string;
}

interface SqliteStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabaseInstance {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  pragma?(cmd: string): unknown;
  close(): void;
}

function createSqliteDatabase(dbPath: string): SqliteDatabaseInstance {
  // If in an Electron-hosted Node environment or explicit override, use built-in node:sqlite
  const isElectron = typeof (process.versions as any).electron !== "undefined";

  if (!isElectron && !process.env["USE_NODE_SQLITE"]) {
    try {
      // Dynamic import / require better-sqlite3 for standard Node environments
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const BetterSqlite3 = require("better-sqlite3");
      const db = new BetterSqlite3(dbPath);
      db.pragma("journal_mode = WAL");
      db.pragma("synchronous = NORMAL");
      return {
        exec: (sql: string) => db.exec(sql),
        prepare: (sql: string) => {
          const stmt = db.prepare(sql);
          return {
            run: (...params: unknown[]) => stmt.run(...params),
            get: (...params: unknown[]) => stmt.get(...params),
            all: (...params: unknown[]) => stmt.all(...params),
          };
        },
        close: () => db.close(),
      };
    } catch {
      // Fall through to node:sqlite
    }
  }

  // Built-in node:sqlite available in Node.js 22+
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
  } catch {
    // pragma might be restricted in in-memory mode
  }

  return {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => {
      const stmt = db.prepare(sql);
      return {
        run: (...params: unknown[]) => stmt.run(...params),
        get: (...params: unknown[]) => stmt.get(...params),
        all: (...params: unknown[]) => stmt.all(...params),
      };
    },
    close: () => db.close(),
  };
}

export class SqliteStore implements Store {
  private db: SqliteDatabaseInstance;
  private inTransaction = false;

  constructor(options: SqliteStoreOptions) {
    this.db = createSqliteDatabase(options.path);
  }

  async init(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        ledger INTEGER NOT NULL,
        ledger_closed_at TEXT NOT NULL,
        contract_id TEXT NOT NULL,
        type TEXT NOT NULL,
        topics TEXT NOT NULL,
        data TEXT,
        decode_error INTEGER NOT NULL DEFAULT 0,
        decode_error_reason TEXT,
        raw_topics_xdr TEXT NOT NULL,
        raw_data_xdr TEXT NOT NULL,
        paging_token TEXT NOT NULL,
        indexed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_contract_ledger ON events (contract_id, ledger);
      CREATE INDEX IF NOT EXISTS idx_events_ledger ON events (ledger);

      CREATE TABLE IF NOT EXISTS cursor_checkpoint (
        id TEXT PRIMARY KEY,
        cursor TEXT NOT NULL,
        ledger INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  async getCursor(): Promise<CursorCheckpoint | null> {
    const row = this.db
      .prepare("SELECT cursor, ledger, updated_at FROM cursor_checkpoint WHERE id = 'default'")
      .get() as { cursor: string; ledger: number; updated_at: string } | undefined;

    if (!row) return null;
    return {
      cursor: row.cursor,
      ledger: row.ledger,
      updatedAt: row.updated_at,
    };
  }

  async setCursor(cursor: string, ledger: number, _tx?: DatabaseTransaction): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO cursor_checkpoint (id, cursor, ledger, updated_at)
        VALUES ('default', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          cursor = excluded.cursor,
          ledger = excluded.ledger,
          updated_at = excluded.updated_at
      `,
      )
      .run(cursor, ledger, now);
  }

  async insertEvents(events: DecodedEvent[], _tx?: DatabaseTransaction): Promise<number> {
    if (events.length === 0) return 0;

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO events (
        id, ledger, ledger_closed_at, contract_id, type,
        topics, data, decode_error, decode_error_reason,
        raw_topics_xdr, raw_data_xdr, paging_token, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    const now = new Date().toISOString();

    for (const evt of events) {
      const result = stmt.run(
        evt.id,
        evt.ledger,
        evt.ledgerClosedAt,
        evt.contractId,
        evt.type,
        safeStringify(evt.topics),
        safeStringify(evt.data),
        evt.decodeError ? 1 : 0,
        evt.decodeErrorReason || null,
        JSON.stringify(evt.rawTopicsXdr),
        evt.rawDataXdr,
        evt.pagingToken,
        now,
      );
      inserted += Number(result.changes);
    }

    return inserted;
  }

  async withTransaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    if (this.inTransaction) {
      const tx = this.createTxObject();
      return await fn(tx);
    }

    this.db.prepare("BEGIN IMMEDIATE").run();
    this.inTransaction = true;
    try {
      const tx = this.createTxObject();
      const result = await fn(tx);
      this.db.prepare("COMMIT").run();
      return result;
    } catch (err) {
      this.db.prepare("ROLLBACK").run();
      throw err;
    } finally {
      this.inTransaction = false;
    }
  }

  private createTxObject(): DatabaseTransaction {
    const db = this.db;
    return {
      query<T = unknown>(sql: string, params: unknown[] = []): T[] {
        return db.prepare(sql).all(...params) as T[];
      },
      execute(sql: string, params: unknown[] = []): number {
        const result = db.prepare(sql).run(...params);
        return Number(result.changes);
      },
    };
  }

  async getEvents(filter?: EventQueryFilter): Promise<DecodedEvent[]> {
    let query = "SELECT * FROM events WHERE 1=1";
    const params: unknown[] = [];

    if (filter?.contractId) {
      query += " AND contract_id = ?";
      params.push(filter.contractId);
    }
    if (filter?.ledgerFrom !== undefined) {
      query += " AND ledger >= ?";
      params.push(filter.ledgerFrom);
    }
    if (filter?.ledgerTo !== undefined) {
      query += " AND ledger <= ?";
      params.push(filter.ledgerTo);
    }
    if (filter?.decodeError !== undefined) {
      query += " AND decode_error = ?";
      params.push(filter.decodeError ? 1 : 0);
    }

    query += " ORDER BY ledger ASC, id ASC";

    if (filter?.limit !== undefined) {
      query += " LIMIT ?";
      params.push(filter.limit);
      if (filter?.offset !== undefined) {
        query += " OFFSET ?";
        params.push(filter.offset);
      }
    }

    const rows = this.db.prepare(query).all(...params) as SqliteEventRow[];

    return rows.map((r) => ({
      id: r.id,
      ledger: Number(r.ledger),
      ledgerClosedAt: r.ledger_closed_at,
      contractId: r.contract_id,
      type: r.type,
      topics: (safeParse(r.topics) as unknown[]) || [],
      data: safeParse(r.data),
      decodeError: Boolean(r.decode_error),
      decodeErrorReason: r.decode_error_reason || undefined,
      rawTopicsXdr: JSON.parse(r.raw_topics_xdr || "[]"),
      rawDataXdr: r.raw_data_xdr,
      pagingToken: r.paging_token,
      indexedAt: r.indexed_at,
    }));
  }

  async getStats(): Promise<StoreStats> {
    const statsRow = this.db
      .prepare(
        `
        SELECT
          COUNT(*) as total_events,
          COALESCE(SUM(decode_error), 0) as decode_errors,
          COALESCE(MAX(ledger), 0) as last_ledger
        FROM events
      `,
      )
      .get() as { total_events: number; decode_errors: number; last_ledger: number };

    return {
      totalEvents: Number(statsRow.total_events),
      decodeErrors: Number(statsRow.decode_errors),
      lastLedger: Number(statsRow.last_ledger),
    };
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
