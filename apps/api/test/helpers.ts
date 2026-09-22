import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.ts';
import { loadConfig, type Config } from '../src/config.ts';
import { createDb } from '../src/db/client.ts';
import { createMemoryMailer } from '../src/email/mailer.ts';
import * as benchRepo from '../src/repositories/benches.ts';
import * as parkRepo from '../src/repositories/parks.ts';
import * as userRepo from '../src/repositories/users.ts';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://bench:bench@localhost:5442/bench_test';

export const PARK = 'test-park';

/** A clock tests can move: `clock.set('2027-01-01')`. */
export function createTestClock(start: string) {
  let current = new Date(start);
  return {
    now: () => current,
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
    /** Noon in New York on the given date, so "today" is unambiguous. */
    set(date: string) {
      current = new Date(`${date}T16:00:00Z`);
    },
  };
}

export async function createTestApp(overrides: Partial<Config> = {}) {
  const config: Config = {
    ...loadConfig({ WEB_URL: 'http://web.test', AUTH_RATE_LIMIT_PER_MINUTE: '1000' }),
    databaseUrl: TEST_DATABASE_URL,
    ...overrides,
  };
  // The chaos suite kills connections on purpose; the resulting "terminated"
  // errors are the scenario working, not a failure, so they are not logged.
  const { db, close } = createDb(TEST_DATABASE_URL, { onError: () => {} });
  const mailer = createMemoryMailer();
  const clock = createTestClock('2026-09-21T16:00:00Z');
  const { app, services, routePolicies } = await buildApp({ db, config, clock, mailer });
  app.addHook('onClose', close);
  return { app, services, routePolicies, db, mailer, clock };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

/**
 * Empties every table and loads one park with two areas, one trail and
 * three benches: T-001 and T-002 by the lake (both on the lake trail) and
 * T-003 in the meadow.
 */
export async function resetData({ db, mailer }: TestApp) {
  await db.execute(sql`
    truncate outbox, events, maintenance_tasks, reminders_sent, adoptions, sessions, auth_tokens, users,
             bench_trails, benches, trails, areas, parks
    restart identity cascade
  `);
  mailer.sent.length = 0;
  const park = await parkRepo.upsertPark(db, {
    slug: PARK,
    name: 'Test Park',
    timezone: 'America/New_York',
    // Short terms keep expiry and reminder tests readable.
    adoptionTermsMonths: [1, 12, 24],
  });
  await parkRepo.upsertArea(db, {
    parkId: park.id,
    name: 'Lake',
    description: 'By the water.',
    facts: ['Herons fish here.'],
  });
  const areaIds = await parkRepo.ensureAreas(db, park.id, ['Lake', 'Meadow']);
  const trail = await parkRepo.upsertTrail(db, {
    parkId: park.id,
    slug: 'lake-loop',
    name: 'Lake Loop',
    description: null,
    lengthMiles: 1,
    facts: [],
    path: [
      [40.9, -73.89],
      [40.901, -73.891],
    ],
  });
  const benches = [];
  for (const [i, area] of ['Lake', 'Lake', 'Meadow'].entries()) {
    benches.push(
      await benchRepo.insertBench(db, {
        parkId: park.id,
        code: `T-00${i + 1}`,
        name: `Test bench ${i + 1}`,
        areaId: areaIds.get(area)!,
        lat: 40.9,
        lng: -73.89,
      }),
    );
  }
  await parkRepo.setBenchTrails(
    db,
    park.id,
    benches.slice(0, 2).map((b) => ({ benchId: b.id, trailIds: [trail.id] })),
  );
  return { park, benches: benches as [(typeof benches)[0], (typeof benches)[0], (typeof benches)[0]] };
}

/** Signs in through the real magic-link flow and returns the session cookie. */
export async function signIn(t: TestApp, email: string, role?: 'staff' | 'admin') {
  await t.app.inject({ method: 'POST', url: '/api/v1/auth/magic-link', payload: { email } });
  await t.services.outbox.dispatch(100); // stand in for the worker
  const message = t.mailer.sent.findLast((m) => m.to === email);
  const token = new URL(message!.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token');
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/v1/auth/verify',
    payload: { token },
  });
  if (role) {
    const user = await userRepo.findOrCreateUser(t.db, email);
    await userRepo.updateUser(t.db, user.id, { role });
  }
  const cookie = res.cookies.find((c) => c.name === 'sid')!;
  return { cookie: `sid=${cookie.value}` };
}
