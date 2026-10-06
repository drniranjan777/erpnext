/**
 * Applies Drizzle migrations, then (re)applies RLS policies & privileges.
 * Runs as the owner role (DATABASE_OWNER_URL).
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, createPool } from './client';

async function main() {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is not set (see database/.env.example)');

  const pool = createPool(url, { max: 1 });
  try {
    const db = createDb(pool);
    console.log('Applying migrations...');
    await migrate(db, { migrationsFolder: join(__dirname, '..', 'migrations') });

    console.log('Applying RLS policies and privileges...');
    await pool.query(readFileSync(join(__dirname, '..', 'sql', 'rls.sql'), 'utf8'));
    console.log('Database is up to date.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
