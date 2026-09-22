import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Db } from './client.ts';

const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder });
}
