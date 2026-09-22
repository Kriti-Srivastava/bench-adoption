/**
 * Phase 2: adoption state stays consistent under concurrency. Commands on a
 * bench are serialised by a row lock, and database triggers reject what the
 * application must never do, even when its code is bypassed.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { violatedInvariants } from '../chaos/invariants.ts';
import { PG, pgErrorCode } from '../src/db/client.ts';
import { adoptions } from '../src/db/schema.ts';
import * as adoptionRepo from '../src/repositories/adoptions.ts';
import * as benchRepo from '../src/repositories/benches.ts';
import * as userRepo from '../src/repositories/users.ts';
import { createTestApp, resetData, signIn, type TestApp } from './helpers.ts';

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

async function failureOf(write: () => Promise<unknown>) {
  try {
    await write();
    return undefined;
  } catch (err) {
    return pgErrorCode(err);
  }
}

const adoptionValues = (benchId: string, adopterId: string, extra: Partial<adoptionRepo.NewAdoption> = {}) => ({
  benchId,
  adopterId,
  startDate: '2026-09-21',
  endDate: '2027-09-21',
  displayName: 'Direct write',
  ...extra,
});

describe('database guards (even when application code is bypassed)', () => {
  it('rejects an adoption on a retired bench', async () => {
    const user = await userRepo.findOrCreateUser(t.db, 'donor@example.org');
    await benchRepo.updateBench(t.db, benches[0].id, { status: 'retired' });
    expect(await failureOf(() => adoptionRepo.insertAdoption(t.db, adoptionValues(benches[0].id, user.id)))).toBe(
      PG.benchRetired,
    );
  });

  it('rejects moving an adoption onto a retired bench, but lets a kept one stay put', async () => {
    const user = await userRepo.findOrCreateUser(t.db, 'donor@example.org');
    const kept = await adoptionRepo.insertAdoption(t.db, adoptionValues(benches[0].id, user.id));
    await benchRepo.updateBench(t.db, benches[0].id, { status: 'retired' }); // "keep until it ends"
    await benchRepo.updateBench(t.db, benches[1].id, { status: 'retired' });

    const move = () => t.db.update(adoptions).set({ benchId: benches[1].id }).where(eq(adoptions.id, kept.id));
    expect(await failureOf(move)).toBe(PG.benchRetired);
    // Editing the kept adoption in place is fine.
    const rename = () => t.db.update(adoptions).set({ displayName: 'Renamed' }).where(eq(adoptions.id, kept.id));
    expect(await failureOf(rename)).toBeUndefined();
  });

  it('rejects an active renewal of an adoption that is not active', async () => {
    const user = await userRepo.findOrCreateUser(t.db, 'donor@example.org');
    const first = await adoptionRepo.insertAdoption(t.db, adoptionValues(benches[0].id, user.id));
    await adoptionRepo.cancelAdoptionChain(t.db, first.id);
    const renewal = adoptionValues(benches[0].id, user.id, {
      startDate: '2027-09-21',
      endDate: '2028-09-21',
      renewedFromId: first.id,
    });
    expect(await failureOf(() => adoptionRepo.insertAdoption(t.db, renewal))).toBe(PG.adoptionNotActive);
  });
});

describe('races between donors and staff (repeated to shake out timing)', () => {
  it('retiring a bench while donors adopt it never leaves an adoption on the retired bench', async () => {
    const staff = await signIn(t, 'staff@example.org', 'staff');
    const donors = await Promise.all(Array.from({ length: 8 }, (_, i) => signIn(t, `d${i}@example.org`)));
    for (let round = 0; round < 5; round++) {
      const bench = benches[round % 3]!;
      await t.app.inject({
        method: 'POST',
        url: `/api/v1/benches/${bench.id}/restore`,
        headers: { cookie: staff.cookie },
      });
      const results = await Promise.all([
        ...donors.map((d) =>
          t.app.inject({
            method: 'POST',
            url: '/api/v1/adoptions',
            headers: { cookie: d.cookie },
            payload: { benchId: bench.id, months: 1, displayName: 'Racer' },
          }),
        ),
        t.app.inject({
          method: 'POST',
          url: `/api/v1/benches/${bench.id}/retire`,
          headers: { cookie: staff.cookie },
          payload: { adoption: 'end' },
        }),
      ]);
      expect(results.filter((r) => r.statusCode >= 500).map((r) => r.body)).toEqual([]);
    }
    expect(await violatedInvariants(t.db)).toEqual({});
  });

  it('cancelling while the donor renews never leaves an active renewal of a cancelled adoption', async () => {
    const staff = await signIn(t, 'staff@example.org', 'staff');
    const donor = await signIn(t, 'donor@example.org');
    for (let round = 0; round < 5; round++) {
      const bench = benches[round % 3]!;
      const first = (
        await t.app.inject({
          method: 'POST',
          url: '/api/v1/adoptions',
          headers: { cookie: donor.cookie },
          payload: { benchId: bench.id, months: 12, displayName: 'Donor' },
        })
      ).json();
      const [renew, cancel] = await Promise.all([
        t.app.inject({
          method: 'POST',
          url: `/api/v1/adoptions/${first.id}/renew`,
          headers: { cookie: donor.cookie },
          payload: { months: 12 },
        }),
        t.app.inject({ method: 'POST', url: `/api/v1/adoptions/${first.id}/cancel`, headers: { cookie: staff.cookie } }),
      ]);
      expect([renew.statusCode, cancel.statusCode].filter((s) => s >= 500)).toEqual([]);
    }
    expect(await violatedInvariants(t.db)).toEqual({});
  });
});
