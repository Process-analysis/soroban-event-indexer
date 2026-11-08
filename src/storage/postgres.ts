import pg from "pg";
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

const { Pool } = pg;

export interface PostgresStoreOptions {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
}

export class PostgresStore implements Store {
  private pool: pg.Pool;

  constructor(options: PostgresStoreOptions) {
    this.pool = new Pool({
      connectionString: options.connectionString,
      host: options.host,
      port: options.port,
      database: options.database,
      user: options.user,
      password: options.password,
      ssl: options.ssl ? { rejectUnauthorized: false } : undefined,
      max: 10,
    });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id VARCHAR(255) PRIMARY KEY,
        ledger BIGINT NOT NULL,
        ledger_closed_at VARCHAR(100) NOT NULL,
        contract_id VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        topics TEXT NOT NULL,
        data TEXT,
        decode_error BOOLEAN NOT NULL DEFAULT FALSE,
        decode_error_reason TEXT,
        raw_topics_xdr TEXT NOT NULL,
        raw_data_xdr TEXT NOT NULL,
        paging_token VARCHAR(255) NOT NULL,
        indexed_at VARCHAR(100) NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_contract_ledger ON events (contract_id, ledger);
      CREATE INDEX IF NOT EXISTS idx_events_ledger ON events (ledger);

      CREATE TABLE IF NOT EXISTS cursor_checkpoint (
        id VARCHAR(50) PRIMARY KEY,
        cursor TEXT NOT NULL,
        ledger BIGINT NOT NULL,
        updated_at VARCHAR(100) NOT NULL
      );
    `);
  }

  async getCursor(): Promise<CursorCheckpoint | null> {
    const res = await this.pool.query(
      "SELECT cursor, ledger, updated_at FROM cursor_checkpoint WHERE id = 'default'",
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      cursor: row.cursor,
      ledger: Number(row.ledger),
      updatedAt: row.updated_at,
    };
  }

  async setCursor(cursor: string, ledger: number, tx?: DatabaseTransaction): Promise<void> {
    const now = new Date().toISOString();
    const sql = `
      INSERT INTO cursor_checkpoint (id, cursor, ledger, updated_at)
      VALUES ('default', $1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET
        cursor = EXCLUDED.cursor,
        ledger = EXCLUDED.ledger,
        updated_at = EXCLUDED.updated_at
    `;
    if (tx) {
      await tx.execute(sql, [cursor, ledger, now]);
    } else {
      await this.pool.query(sql, [cursor, ledger, now]);
    }
  }

  async insertEvents(events: DecodedEvent[], tx?: DatabaseTransaction): Promise<number> {
    if (events.length === 0) return 0;

    let totalInserted = 0;
    const now = new Date().toISOString();

    const sql = `
      INSERT INTO events (
        id, ledger, ledger_closed_at, contract_id, type,
        topics, data, decode_error, decode_error_reason,
        raw_topics_xdr, raw_data_xdr, paging_token, indexed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (id) DO NOTHING
    `;

    for (const evt of events) {
      const params = [
        evt.id,
        evt.ledger,
        evt.ledgerClosedAt,
        evt.contractId,
        evt.type,
        safeStringify(evt.topics),
        safeStringify(evt.data),
        evt.decodeError,
        evt.decodeErrorReason || null,
        JSON.stringify(evt.rawTopicsXdr),
        evt.rawDataXdr,
        evt.pagingToken,
        now,
      ];

      if (tx) {
        const count = await tx.execute(sql, params);
        totalInserted += count;
      } else {
        const res = await this.pool.query(sql, params);
        totalInserted += res.rowCount || 0;
      }
    }

    return totalInserted;
  }

  async withTransaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const tx: DatabaseTransaction = {
        async query<R = unknown>(sql: string, params: unknown[] = []): Promise<R[]> {
          const res = await client.query(sql, params);
          return res.rows as R[];
        },
        async execute(sql: string, params: unknown[] = []): Promise<number> {
          const res = await client.query(sql, params);
          return res.rowCount || 0;
        },
      };

      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getEvents(filter?: EventQueryFilter): Promise<DecodedEvent[]> {
    let query = "SELECT * FROM events WHERE 1=1";
    const params: unknown[] = [];
    let pIdx = 1;

    if (filter?.contractId) {
      query += ` AND contract_id = $${pIdx++}`;
      params.push(filter.contractId);
    }
    if (filter?.ledgerFrom !== undefined) {
      query += ` AND ledger >= $${pIdx++}`;
      params.push(filter.ledgerFrom);
    }
    if (filter?.ledgerTo !== undefined) {
      query += ` AND ledger <= $${pIdx++}`;
      params.push(filter.ledgerTo);
    }
    if (filter?.decodeError !== undefined) {
      query += ` AND decode_error = $${pIdx++}`;
      params.push(filter.decodeError);
    }

    query += " ORDER BY ledger ASC, id ASC";

    if (filter?.limit !== undefined) {
      query += ` LIMIT $${pIdx++}`;
      params.push(filter.limit);
      if (filter?.offset !== undefined) {
        query += ` OFFSET $${pIdx++}`;
        params.push(filter.offset);
      }
    }

    const res = await this.pool.query(query, params);

    return res.rows.map((r: any) => ({
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
    const res = await this.pool.query(`
      SELECT
        COUNT(*)::text as total_events,
        COALESCE(SUM(CASE WHEN decode_error THEN 1 ELSE 0 END), 0)::text as decode_errors,
        COALESCE(MAX(ledger), 0)::text as last_ledger
      FROM events
    `);
    const row = res.rows[0];
    return {
      totalEvents: parseInt(row.total_events, 10),
      decodeErrors: parseInt(row.decode_errors, 10),
      lastLedger: parseInt(row.last_ledger, 10),
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
