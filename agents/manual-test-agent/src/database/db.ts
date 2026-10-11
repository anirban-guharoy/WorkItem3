import pg from 'pg';
import type { AppConfig } from '../config/index.js';

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Executes one or more statements without parameters (used for migrations). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  ping(): Promise<void>;
  close(): Promise<void>;
  readonly kind: 'postgres' | 'pglite';
  /** Underlying pg pool (PostgreSQL only); used by the LangGraph PostgreSQL checkpointer. */
  readonly pool?: pg.Pool;
}

class PgDb implements Db {
  readonly kind = 'postgres' as const;
  constructor(readonly pool: pg.Pool) {}

  async query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    const r = await this.pool.query(sql, params);
    return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx: Queryable = {
      query: async <R>(sql: string, params?: unknown[]) => {
        const r = await client.query(sql, params);
        return { rows: r.rows as R[], rowCount: r.rowCount ?? 0 };
      },
      exec: async (sql) => {
        await client.query(sql);
      },
    };
    try {
      await client.query('BEGIN');
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

interface PgliteLike {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
  transaction<T>(fn: (tx: PgliteLike) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const wrapPglite = (db: PgliteLike): Queryable => ({
  query: async <T>(sql: string, params?: unknown[]) => {
    const r = await db.query<T>(sql, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  },
  exec: async (sql) => {
    await db.exec(sql);
  },
});

class PgliteDb implements Db {
  readonly kind = 'pglite' as const;
  private readonly base: Queryable;
  constructor(private readonly db: PgliteLike) {
    this.base = wrapPglite(db);
  }
  query<T>(sql: string, params?: unknown[]) {
    return this.base.query<T>(sql, params);
  }
  exec(sql: string) {
    return this.base.exec(sql);
  }
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(wrapPglite(tx)));
  }
  async ping() {
    await this.db.query('SELECT 1');
  }
  close() {
    return this.db.close();
  }
}

/** In-process PostgreSQL (WASM) for local development and automated tests only. */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = (dataDir ? new PGlite(dataDir) : new PGlite()) as unknown as PgliteLike;
  return new PgliteDb(db);
}

export async function createDb(
  config: Pick<AppConfig, 'DATABASE_URL' | 'DATABASE_SSL' | 'DATABASE_POOL_MAX'>,
): Promise<Db> {
  if (config.DATABASE_URL.startsWith('pglite:')) {
    const location = config.DATABASE_URL.slice('pglite:'.length).replace(/^\/\//, '');
    return createPgliteDb(location === 'memory' ? undefined : location);
  }
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    ssl: config.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 60_000,
  });
  pool.on('error', () => undefined);
  return new PgDb(pool);
}

export const iso = (value: unknown): string =>
  value instanceof Date
    ? value.toISOString()
    : typeof value === 'string'
      ? new Date(value).toISOString()
      : '';
