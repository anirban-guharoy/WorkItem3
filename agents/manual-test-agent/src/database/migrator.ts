import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';
import { sha256 } from '../shared/util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const defaultMigrationsDir = path.resolve(here, '../../migrations');

const LOCK_KEY = 727_001;

/** Applies ordered *.sql files exactly once; each file runs in its own transaction. */
export async function migrate(db: Db, dir = defaultMigrationsDir): Promise<string[]> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    const sql = await readFile(path.join(dir, file), 'utf8');
    const checksum = sha256(sql);
    await db.transaction(async (tx) => {
      if (db.kind === 'postgres') await tx.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
      const existing = await tx.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE name = $1',
        [file],
      );
      const row = existing.rows[0];
      if (row) {
        if (row.checksum !== checksum) throw new Error(`Migration ${file} was modified after being applied`);
        return;
      }
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, checksum]);
      applied.push(file);
    });
  }
  return applied;
}
