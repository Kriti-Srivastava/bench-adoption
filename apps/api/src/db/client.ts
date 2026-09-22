import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

export function createDb(
  databaseUrl: string,
  onError: (err: Error) => void = (err) => console.error('Postgres connection error', err),
) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  // An idle connection can drop (e.g. the database restarts). Without a
  // listener, node treats that as fatal; the pool reconnects on next use.
  pool.on('error', onError);
  const db = drizzle(pool, { schema });
  return { db, close: () => pool.end() };
}

export type Db = ReturnType<typeof createDb>['db'];
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything that can run a query: the pool or an open transaction. */
export type Executor = Db | Tx;

/** Postgres SQLSTATE of a failed query (drizzle wraps the driver error). */
export function pgErrorCode(err: unknown): string | undefined {
  for (let e: unknown = err; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}

export const PG = {
  uniqueViolation: '23505',
  exclusionViolation: '23P01',
} as const;

/** LIKE/ILIKE pattern matching `text` literally anywhere in the value. */
export const likeContains = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;
