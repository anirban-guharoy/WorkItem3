import 'dotenv/config';
import { createDb } from './db.js';
import { migrate } from './migrator.js';

const config = {
  DATABASE_URL: process.env['DATABASE_URL'] ?? 'pglite://memory',
  DATABASE_SSL: process.env['DATABASE_SSL'] === 'true',
  DATABASE_POOL_MAX: 2,
};
const db = await createDb(config);
try {
  const applied = await migrate(db);
  process.stdout.write(
    `Applied ${applied.length} migration(s): ${applied.join(', ') || 'none (up to date)'}\n`,
  );
} finally {
  await db.close();
}
