import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

export function createDb(
  databaseUrl: string,
  opts: { max?: number; onError?: (err: Error) => void } = {},
) {
  // Keep (instances x max) under the database's connection limit, or put a
  // pooler such as PgBouncer in front when running many instances.
  const pool = new pg.Pool({ connectionString: databaseUrl, max: opts.max ?? 10 });
  const onError = opts.onError ?? ((err: Error) => console.error('Postgres connection error', err));
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

/** The Postgres error behind a failed query (drizzle wraps the driver's error). */
export function pgError(err: unknown): { code?: string; constraint?: string } {
  for (let e: unknown = err; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    const { code, constraint } = e as { code?: unknown; constraint?: unknown };
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return { code, constraint: typeof constraint === 'string' ? constraint : undefined };
    }
  }
  return {};
}

/** Postgres SQLSTATE of a failed query. */
export const pgErrorCode = (err: unknown) => pgError(err).code;

export const PG = {
  uniqueViolation: '23505',
  exclusionViolation: '23P01',
  serializationFailure: '40001',
  deadlockDetected: '40P01',
  // Raised by our own triggers (migration 0007_adoption_guards).
  benchRetired: 'BA001',
  adoptionNotActive: 'BA002',
} as const;

/**
 * Runs `write`, retrying when Postgres aborts it only because of contention.
 * Several sessions inserting conflicting rows under an exclusion constraint
 * at the same moment can deadlock; Postgres then aborts one of them. Retrying
 * lets that request see the winner's committed row and fail cleanly instead.
 */
export async function retryOnContention<T>(write: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write();
    } catch (err) {
      const code = pgErrorCode(err);
      const transient = code === PG.deadlockDetected || code === PG.serializationFailure;
      if (!transient || attempt >= attempts) throw err;
    }
  }
}

/** LIKE/ILIKE pattern matching `text` literally anywhere in the value. */
export const likeContains = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;
