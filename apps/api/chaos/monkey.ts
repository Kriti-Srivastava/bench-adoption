/**
 * Chaos monkeys: deliberately break the system's dependencies while it works.
 * Every source of randomness is seeded, so a failing run can be replayed with
 * CHAOS_SEED=<seed printed by the run>.
 */
import pg from 'pg';
import type { EmailMessage, Mailer } from '../src/email/mailer.ts';

export const SEED = Number(process.env.CHAOS_SEED ?? Math.floor(Math.random() * 1e9));

/** Deterministic PRNG (mulberry32). */
export function rng(seed = SEED) {
  let s = seed;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (max: number) => Math.floor(next() * max),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    chance: (p: number) => next() < p,
  };
}
export type Rng = ReturnType<typeof rng>;

/**
 * Terminates random Postgres backends of the test database at random
 * intervals: the database equivalent of Chaos Monkey killing an instance.
 * Uses its own connection, which it never kills.
 */
export function connectionKiller(databaseUrl: string, random: Rng, opts = { minMs: 20, maxMs: 120 }) {
  const client = new pg.Client({ connectionString: databaseUrl });
  let running = false;
  let kills = 0;
  let loop: Promise<void> = Promise.resolve();

  async function killOne() {
    const { rows } = await client.query<{ pid: number }>(
      `select pid from pg_stat_activity
       where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend'`,
    );
    if (rows.length === 0) return;
    await client.query('select pg_terminate_backend($1)', [random.pick(rows).pid]);
    kills++;
  }

  return {
    async start() {
      await client.connect();
      running = true;
      loop = (async () => {
        while (running) {
          await new Promise((r) => setTimeout(r, opts.minMs + random.int(opts.maxMs - opts.minMs)));
          if (running) await killOne().catch(() => undefined);
        }
      })();
    },
    async stop() {
      running = false;
      await loop;
      await client.end();
      return kills;
    },
  };
}

/**
 * Wraps a mailer so it fails some of the time and is slow some of the time,
 * like a flaky email provider. `healthy` turns the chaos off.
 */
export function flakyMailer(inner: Mailer, random: Rng, opts = { failRate: 0.5, maxDelayMs: 50 }) {
  let chaos = true;
  let failures = 0;
  return {
    mailer: {
      async send(message: EmailMessage) {
        if (chaos) {
          await new Promise((r) => setTimeout(r, random.int(opts.maxDelayMs)));
          if (random.chance(opts.failRate)) {
            failures++;
            throw new Error('chaos: mail provider unavailable');
          }
        }
        await inner.send(message);
      },
    } satisfies Mailer,
    heal: () => {
      chaos = false;
    },
    failures: () => failures,
  };
}
