/**
 * Health checks, split the standard way:
 * - live:  the process is up (restart it if not);
 * - ready: it can serve traffic (route to it if so).
 *
 * Dependencies are classed by how much the API needs them. Postgres is
 * critical: without it the instance is not ready. Redis only backs shared
 * per-IP rate limits: without it the API keeps serving (per-address sign-in
 * limits live in Postgres), so it reports "degraded" rather than failing.
 */
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { Db } from '../db/client.ts';

type Check = 'ok' | 'down' | 'not_configured';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

export function registerHealthRoutes(app: FastifyInstance, deps: { db: Db; redis?: Redis }) {
  app.get('/api/health/live', async () => ({ status: 'ok' }));

  const ready = async (_req: unknown, reply: { code: (n: number) => unknown }) => {
    const database: Check = await withTimeout(deps.db.execute(sql`select 1`), 2000).then(
      () => 'ok',
      () => 'down',
    );
    const redis: Check = !deps.redis ? 'not_configured' : deps.redis.status === 'ready' ? 'ok' : 'down';
    const status = database === 'down' ? 'unavailable' : redis === 'down' ? 'degraded' : 'ok';
    if (status === 'unavailable') reply.code(503);
    return { status, checks: { database, redis } };
  };
  app.get('/api/health/ready', ready);
  app.get('/api/health', ready);
}
