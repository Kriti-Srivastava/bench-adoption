import { sql } from 'drizzle-orm';
import { createDb } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { TEST_DATABASE_URL } from './helpers.ts';

/** Rebuilds the test database from the migrations before the suite runs. */
export default async function setup() {
  const { db, close } = createDb(TEST_DATABASE_URL);
  try {
    await db.execute(sql`drop schema if exists public cascade`);
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`create schema public`);
    await runMigrations(db);
  } finally {
    await close();
  }
}
