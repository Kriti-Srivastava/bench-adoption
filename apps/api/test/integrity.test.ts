/**
 * Rules the database enforces on its own, and the audit fixes around
 * cancellation, reminders and housekeeping. Database tests write directly
 * through repositories to prove Postgres rejects bad data even when the
 * API's validation is bypassed (imports, scripts, future code).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pgErrorCode } from '../src/db/client.ts';
import { adoptions, users } from '../src/db/schema.ts';
import * as benchRepo from '../src/repositories/benches.ts';
import * as parkRepo from '../src/repositories/parks.ts';
import * as userRepo from '../src/repositories/users.ts';
import { createTestApp, PARK, resetData, signIn, type TestApp } from './helpers.ts';

let t: TestApp;
let data: Awaited<ReturnType<typeof resetData>>;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  t.clock.set('2026-09-21');
  data = await resetData(t);
});

/** The SQLSTATE a write fails with (undefined if it succeeds). */
async function failureOf(write: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await write();
    return undefined;
  } catch (err) {
    return pgErrorCode(err);
  }
}

const FOREIGN_KEY = '23503';
const CHECK = '23514';

async function otherPark() {
  const park = await parkRepo.upsertPark(t.db, { slug: 'other', name: 'Other', timezone: 'America/New_York' });
  const areaIds = await parkRepo.ensureAreas(t.db, park.id, ['Elsewhere']);
  const trail = await parkRepo.upsertTrail(t.db, {
    parkId: park.id,
    slug: 'far-trail',
    name: 'Far Trail',
    description: null,
    lengthMiles: 1,
    facts: [],
    path: [
      [41, -74],
      [41.001, -74.001],
    ],
  });
  return { park, areaId: areaIds.get('Elsewhere')!, trail };
}

describe('database rules', () => {
  it("rejects a bench whose area is in another park", async () => {
    const other = await otherPark();
    const code = await failureOf(() =>
      benchRepo.insertBench(t.db, {
        parkId: data.park.id,
        areaId: other.areaId,
        code: 'X-1',
        name: 'Misplaced',
        lat: 40.9,
        lng: -73.89,
      }),
    );
    expect(code).toBe(FOREIGN_KEY);
  });

  it('rejects linking a bench to a trail in another park', async () => {
    const other = await otherPark();
    const code = await failureOf(() =>
      parkRepo.setBenchTrails(t.db, data.park.id, [{ benchId: data.benches[0].id, trailIds: [other.trail.id] }]),
    );
    expect(code).toBe(FOREIGN_KEY);
  });

  it('rejects impossible coordinates', async () => {
    const code = await failureOf(() => benchRepo.updateBench(t.db, data.benches[0].id, { lat: 123 }));
    expect(code).toBe(CHECK);
  });

  it('rejects a trail with fewer than two points', async () => {
    const code = await failureOf(() =>
      parkRepo.upsertTrail(t.db, {
        parkId: data.park.id,
        slug: 'dot',
        name: 'Dot',
        description: null,
        lengthMiles: 0,
        facts: [],
        path: [[40.9, -73.89]],
      }),
    );
    expect(code).toBe(CHECK);
  });

  it('rejects emails that are not lower-case', async () => {
    const code = await failureOf(() => t.db.insert(users).values({ email: 'Mixed@Example.org' }));
    expect(code).toBe(CHECK);
  });

  it('rejects over-long dedications', async () => {
    const user = await userRepo.findOrCreateUser(t.db, 'donor@example.org');
    const code = await failureOf(() =>
      t.db.insert(adoptions).values({
        benchId: data.benches[0].id,
        adopterId: user.id,
        startDate: '2026-09-21',
        endDate: '2027-09-21',
        displayName: 'Donor',
        dedication: 'x'.repeat(281),
      }),
    );
    expect(code).toBe(CHECK);
  });
});

describe('cancelling', () => {
  it('also cancels renewals, freeing the bench', async () => {
    const donor = await signIn(t, 'donor@example.org');
    const staff = await signIn(t, 'staff@example.org', 'staff');
    const first = (
      await t.app.inject({
        method: 'POST',
        url: '/api/v1/adoptions',
        headers: { cookie: donor.cookie },
        payload: { benchId: data.benches[0].id, months: 12, displayName: 'Donor' },
      })
    ).json();
    await t.app.inject({
      method: 'POST',
      url: `/api/v1/adoptions/${first.id}/renew`,
      headers: { cookie: donor.cookie },
      payload: { months: 12 },
    });

    await t.app.inject({
      method: 'POST',
      url: `/api/v1/adoptions/${first.id}/cancel`,
      headers: { cookie: staff.cookie },
    });

    const mine = (
      await t.app.inject({ method: 'GET', url: '/api/v1/me/adoptions', headers: { cookie: donor.cookie } })
    ).json();
    expect(mine.items.map((a: { status: string }) => a.status)).toEqual(['cancelled', 'cancelled']);

    const bench = (
      await t.app.inject({ method: 'GET', url: `/api/v1/parks/${PARK}/benches/T-001` })
    ).json();
    expect(bench).toMatchObject({ availability: 'available', availableFrom: '2026-09-21' });
  });
});

describe('daily job', () => {
  it('does not send renewal reminders for retired benches', async () => {
    const donor = await signIn(t, 'donor@example.org');
    await t.app.inject({
      method: 'POST',
      url: '/api/v1/adoptions',
      headers: { cookie: donor.cookie },
      payload: { benchId: data.benches[0].id, months: 1, displayName: 'Donor' },
    });
    await benchRepo.updateBench(t.db, data.benches[0].id, { status: 'retired' });
    expect(await t.services.reminders.sendDueReminders()).toBe(0);
  });

  it('removes used and expired sign-in links and expired sessions, keeping live ones', async () => {
    await signIn(t, 'old@example.org'); // used link + session
    await t.app.inject({ method: 'POST', url: '/api/v1/auth/magic-link', payload: { email: 'new@example.org' } });

    // Nothing has expired yet: only the used link goes.
    expect(await t.services.auth.purgeExpired()).toEqual({ tokens: 1, sessions: 0 });

    t.clock.set('2026-12-01'); // past the link's 15 minutes and the session's 30 days
    expect(await t.services.auth.purgeExpired()).toEqual({ tokens: 1, sessions: 1 });
  });
});
