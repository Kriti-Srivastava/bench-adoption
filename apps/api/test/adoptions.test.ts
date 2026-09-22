import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, PARK, resetData, signIn, type TestApp } from './helpers.ts';

let t: TestApp;
let benches: Awaited<ReturnType<typeof resetData>>['benches'];

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  t.clock.set('2026-09-21');
  ({ benches } = await resetData(t));
});

const adopt = (cookie: string, benchId: string, extra: Record<string, unknown> = {}) =>
  t.app.inject({
    method: 'POST',
    url: '/api/v1/adoptions',
    headers: { cookie },
    payload: { benchId, months: 12, displayName: 'The Smiths', ...extra },
  });

const getBench = (code: string) =>
  t.app.inject({ method: 'GET', url: `/api/v1/parks/${PARK}/benches/${code}` }).then((r) => r.json());

const list = (query = '') =>
  t.app.inject({ method: 'GET', url: `/api/v1/parks/${PARK}/benches${query}` }).then((r) => r.json());

describe('browsing', () => {
  it('lists every bench as available when nothing is adopted', async () => {
    const body = await list();
    expect(body.items.map((b: { code: string }) => b.code)).toEqual(['T-001', 'T-002', 'T-003']);
    expect(body.items.every((b: { currentAdoption: unknown }) => b.currentAdoption === null)).toBe(true);
    expect(body.nextCursor).toBeNull();
  });

  it('paginates with a cursor', async () => {
    const first = await list('?limit=2');
    expect(first.items).toHaveLength(2);
    const second = await list(`?limit=2&cursor=${first.nextCursor}`);
    expect(second.items.map((b: { code: string }) => b.code)).toEqual(['T-003']);
    expect(second.nextCursor).toBeNull();
  });

  it('filters by zone and search text', async () => {
    expect((await list('?zone=Meadow')).items).toHaveLength(1);
    expect((await list('?q=bench%202')).items[0].code).toBe('T-002');
  });

  it('returns 404 for an unknown bench', async () => {
    const res = await t.app.inject({ method: 'GET', url: `/api/v1/parks/${PARK}/benches/NOPE` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
});

describe('adopting', () => {
  it('requires signing in', async () => {
    const res = await adopt('', benches[0].id);
    expect(res.statusCode).toBe(401);
  });

  it('adopts a bench from today for the chosen term', async () => {
    const { cookie } = await signIn(t, 'donor@example.org');
    const res = await adopt(cookie, benches[0].id, { dedication: 'For Grandma' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ startDate: '2026-09-21', endDate: '2027-09-21' });

    const bench = await getBench('T-001');
    expect(bench.currentAdoption).toEqual({
      displayName: 'The Smiths',
      dedication: 'For Grandma',
      startDate: '2026-09-21',
      endDate: '2027-09-21',
    });
    expect(bench.availableFrom).toBe('2027-09-21');
    // The public view never includes who the adopter is beyond their display name.
    expect(JSON.stringify(bench)).not.toContain('donor@example.org');

    expect((await list('?availability=adopted')).items).toHaveLength(1);
    expect((await list('?availability=available')).items).toHaveLength(2);
    expect(t.mailer.sent.at(-1)).toMatchObject({
      to: 'donor@example.org',
      subject: "You've adopted bench T-001",
    });
  });

  it('shows anonymous adopters as "Anonymous donor"', async () => {
    const { cookie } = await signIn(t, 'shy@example.org');
    await adopt(cookie, benches[0].id, { isAnonymous: true });
    expect((await getBench('T-001')).currentAdoption.displayName).toBe('Anonymous donor');
  });

  it('refuses a bench that is already adopted', async () => {
    const a = await signIn(t, 'a@example.org');
    const b = await signIn(t, 'b@example.org');
    expect((await adopt(a.cookie, benches[0].id)).statusCode).toBe(201);
    const res = await adopt(b.cookie, benches[0].id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('bench_unavailable');
  });

  it('lets exactly one of two simultaneous requests win', async () => {
    const people = await Promise.all(
      Array.from({ length: 5 }, (_, i) => signIn(t, `racer${i}@example.org`)),
    );
    const results = await Promise.all(people.map((p) => adopt(p.cookie, benches[1].id)));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409, 409, 409, 409]);
  });

  it('frees the bench once the adoption ends', async () => {
    const { cookie } = await signIn(t, 'donor@example.org');
    await adopt(cookie, benches[0].id, { months: 1 });
    t.clock.set('2026-10-20');
    expect((await getBench('T-001')).currentAdoption).not.toBeNull();
    t.clock.set('2026-10-21');
    expect((await getBench('T-001')).currentAdoption).toBeNull();

    const other = await signIn(t, 'next@example.org');
    expect((await adopt(other.cookie, benches[0].id)).statusCode).toBe(201);
  });

  it('validates the term length', async () => {
    const { cookie } = await signIn(t, 'donor@example.org');
    const res = await adopt(cookie, benches[0].id, { months: 0 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('refuses retired benches', async () => {
    const staff = await signIn(t, 'staff@example.org', 'staff');
    await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/benches/${benches[2].id}`,
      headers: { cookie: staff.cookie },
      payload: { status: 'retired' },
    });
    const res = await adopt(staff.cookie, benches[2].id);
    expect(res.json().error.code).toBe('bench_retired');
    // Retired benches stay on the map, marked as such.
    expect((await getBench('T-003')).availability).toBe('retired');
    expect((await list('?availability=retired')).items).toHaveLength(1);
  });

  it('reports each bench as available, adopted, ending soon or retired', async () => {
    const { cookie } = await signIn(t, 'donor@example.org');
    const staff = await signIn(t, 'staff@example.org', 'staff');
    await adopt(cookie, benches[0].id, { months: 12 });
    await adopt(cookie, benches[1].id, { months: 1 }); // ends in 30 days
    await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/benches/${benches[2].id}`,
      headers: { cookie: staff.cookie },
      payload: { status: 'retired' },
    });

    const byCode = Object.fromEntries(
      (await list()).items.map((b: { code: string; availability: string }) => [b.code, b.availability]),
    );
    expect(byCode).toEqual({ 'T-001': 'adopted', 'T-002': 'ending_soon', 'T-003': 'retired' });
    for (const a of ['adopted', 'ending_soon', 'retired']) {
      expect((await list(`?availability=${a}`)).items).toHaveLength(1);
    }
    expect((await list('?availability=available')).items).toHaveLength(0);
  });

  it('stops calling an adoption "ending soon" once it is renewed', async () => {
    const { cookie } = await signIn(t, 'donor@example.org');
    const first = (await adopt(cookie, benches[0].id, { months: 1 })).json();
    expect((await getBench('T-001')).availability).toBe('ending_soon');
    await t.app.inject({
      method: 'POST',
      url: `/api/v1/adoptions/${first.id}/renew`,
      headers: { cookie },
      payload: { months: 12 },
    });
    expect((await getBench('T-001')).availability).toBe('adopted');
  });
});

describe('renewing', () => {
  const renew = (cookie: string, id: string, months = 12) =>
    t.app.inject({
      method: 'POST',
      url: `/api/v1/adoptions/${id}/renew`,
      headers: { cookie },
      payload: { months },
    });

  it('continues from the end of the current adoption', async () => {
    const { cookie } = await signIn(t, 'donor@example.org');
    const first = (await adopt(cookie, benches[0].id)).json();
    const res = await renew(cookie, first.id, 24);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      startDate: '2027-09-21',
      endDate: '2029-09-21',
      renewedFromId: first.id,
      displayName: 'The Smiths',
    });
    expect((await getBench('T-001')).availableFrom).toBe('2029-09-21');

    const mine = await t.app.inject({ method: 'GET', url: '/api/v1/me/adoptions', headers: { cookie } });
    expect(mine.json().items.map((a: { isRenewed: boolean }) => a.isRenewed)).toEqual([true, false]);
  });

  it('can only renew an adoption once', async () => {
    const { cookie } = await signIn(t, 'donor@example.org');
    const first = (await adopt(cookie, benches[0].id)).json();
    await renew(cookie, first.id);
    const res = await renew(cookie, first.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('already_renewed');
  });

  it("hides other people's adoptions", async () => {
    const owner = await signIn(t, 'owner@example.org');
    const other = await signIn(t, 'other@example.org');
    const first = (await adopt(owner.cookie, benches[0].id)).json();
    expect((await renew(other.cookie, first.id)).statusCode).toBe(404);
  });

  it('refuses an adoption that has already ended', async () => {
    const { cookie } = await signIn(t, 'donor@example.org');
    const first = (await adopt(cookie, benches[0].id, { months: 1 })).json();
    t.clock.set('2026-11-01');
    expect((await renew(cookie, first.id)).statusCode).toBe(401);
    // Sessions last 30 days, so sign in again after moving the clock.
    const later = await signIn(t, 'donor@example.org');
    expect((await renew(later.cookie, first.id)).json().error.code).toBe('adoption_ended');
  });
});

describe('staff tools', () => {
  it('lets staff cancel an adoption, freeing the bench', async () => {
    const donor = await signIn(t, 'donor@example.org');
    const staff = await signIn(t, 'staff@example.org', 'staff');
    const a = (await adopt(donor.cookie, benches[0].id)).json();

    const cancelUrl = `/api/v1/adoptions/${a.id}/cancel`;
    expect((await t.app.inject({ method: 'POST', url: cancelUrl, headers: { cookie: donor.cookie } })).statusCode).toBe(403);
    const res = await t.app.inject({ method: 'POST', url: cancelUrl, headers: { cookie: staff.cookie } });
    expect(res.json().status).toBe('cancelled');
    expect((await getBench('T-001')).currentAdoption).toBeNull();
  });

  it('lists adoptions with adopter contact details, as JSON and CSV', async () => {
    const donor = await signIn(t, 'donor@example.org');
    const staff = await signIn(t, 'staff@example.org', 'staff');
    await adopt(donor.cookie, benches[0].id, { months: 1 });
    await adopt(donor.cookie, benches[1].id, { months: 24 });

    const soon = await t.app.inject({
      method: 'GET',
      url: `/api/v1/parks/${PARK}/adoptions?expiringWithinDays=60`,
      headers: { cookie: staff.cookie },
    });
    expect(soon.json().items).toHaveLength(1);
    expect(soon.json().items[0].adopterEmail).toBe('donor@example.org');

    const csv = await t.app.inject({
      method: 'GET',
      url: `/api/v1/parks/${PARK}/adoptions.csv`,
      headers: { cookie: staff.cookie },
    });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.trim().split('\n')).toHaveLength(3);
  });

  it('imports benches from CSV, updating existing codes', async () => {
    const staff = await signIn(t, 'staff@example.org', 'staff');
    const csv = [
      'code,name,zone,lat,lng',
      'T-001,Renamed bench,Lake,40.9,-73.89',
      'T-100,New bench,Hill,40.91,-73.88',
    ].join('\n');
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/parks/${PARK}/benches/import`,
      headers: { cookie: staff.cookie },
      payload: { csv },
    });
    expect(res.json()).toEqual({ created: 1, updated: 1 });
    expect((await getBench('T-001')).name).toBe('Renamed bench');
  });

  it('rejects a CSV with a bad row, naming the row', async () => {
    const staff = await signIn(t, 'staff@example.org', 'staff');
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/parks/${PARK}/benches/import`,
      headers: { cookie: staff.cookie },
      payload: { csv: 'code,name,zone,lat,lng\nT-200,Bench,Hill,not-a-number,-73.9' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('Row 2');
  });

  it('is closed to adopters', async () => {
    const donor = await signIn(t, 'donor@example.org');
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/parks/${PARK}/adoptions`,
      headers: { cookie: donor.cookie },
    });
    expect(res.statusCode).toBe(403);
  });
});
