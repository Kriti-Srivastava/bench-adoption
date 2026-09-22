/**
 * Chaos scenarios, in the spirit of Netflix's Chaos Monkey: break things on
 * purpose while the system is busy, then check that (a) every request got an
 * answer, (b) the rules in invariants.ts still hold, and (c) it recovers.
 *
 * Run with `npm run test:chaos -w @bench/api`. Each run prints its seed;
 * replay a failure exactly with CHAOS_SEED=<seed>.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, TEST_DATABASE_URL, type TestApp } from '../test/helpers.ts';
import { violatedInvariants } from './invariants.ts';
import { connectionKiller, flakyMailer, rng, SEED } from './monkey.ts';
import { runWorkload, setUpPark } from './workload.ts';

let t: TestApp;

beforeAll(async () => {
  console.log(`\n🐒 chaos seed: ${SEED} (replay with CHAOS_SEED=${SEED})\n`);
  t = await createTestApp();
});
afterAll(() => t.app.close());
beforeEach(() => {
  t.clock.set('2026-09-21');
});

const adopt = (cookie: string, benchId: string, months = 12) =>
  t.app.inject({
    method: 'POST',
    url: '/api/v1/adoptions',
    headers: { cookie },
    payload: { benchId, months, displayName: 'Chaos donor' },
  });

async function benchIds(count: number) {
  const res = await t.app.inject({ method: 'GET', url: '/api/v1/parks/test-park/benches?limit=1000' });
  return (res.json().items as { id: string; availability: string }[])
    .filter((b) => b.availability === 'available')
    .slice(0, count)
    .map((b) => b.id);
}

describe('🐒 chaos', () => {
  it('thundering herd: 30 donors grab one bench while staff retire it', async () => {
    const actors = await setUpPark(t, 3, 30);
    const [target] = await benchIds(1);

    const herd = actors.donors.map((d) => adopt(d.cookie, target!));
    const retire = t.app.inject({
      method: 'POST',
      url: `/api/v1/benches/${target}/retire`,
      headers: { cookie: actors.staff },
      payload: { adoption: 'keep' },
    });
    const results = await Promise.all([...herd, retire]);

    const adopted = results.slice(0, -1).filter((r) => r.statusCode === 201).length;
    expect(adopted).toBeLessThanOrEqual(1);
    expect(results.filter((r) => r.statusCode >= 500).map((r) => r.body)).toEqual([]);
    expect(await violatedInvariants(t.db)).toEqual({});
  });

  it('lifecycle storm: random concurrent operations never break the rules', async () => {
    const actors = await setUpPark(t, 12, 15);
    const tally = await runWorkload(t, actors, rng(SEED), { waves: 8, perWave: 20 });

    console.log('storm outcomes', JSON.stringify(tally.byOp));
    expect(tally.crashes).toEqual([]);
    expect(tally.serverErrors).toEqual([]);
    expect(await violatedInvariants(t.db)).toEqual({});
  });

  it('connection killer: database connections die mid-request; the system stays consistent and recovers', async () => {
    const actors = await setUpPark(t, 12, 15);
    const random = rng(SEED + 1);
    const killer = connectionKiller(TEST_DATABASE_URL, random);

    await killer.start();
    const tally = await runWorkload(t, actors, random, { waves: 6, perWave: 15 });
    const kills = await killer.stop();
    console.log(`killed ${kills} connections; ${tally.serverErrors.length} requests failed with 5xx during chaos`);

    // Failing a request whose connection was killed is fine; hanging or crashing is not.
    expect(tally.crashes).toEqual([]);
    for (const e of tally.serverErrors) expect(JSON.parse(e.body)).toHaveProperty('error.code');
    // Half-finished work must never leave broken data behind (transactions roll back).
    expect(await violatedInvariants(t.db)).toEqual({});

    // Recovery: once the monkey stops, everything works again.
    const health = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    const [free] = await benchIds(1);
    if (free) expect((await adopt(actors.donors[0]!.cookie, free)).statusCode).toBe(201);
  });

  it('mail outage: adoptions still succeed, and reminders are delivered exactly once after recovery', async () => {
    const actors = await setUpPark(t, 10, 10);
    const random = rng(SEED + 2);
    const realSend = t.mailer.send;
    const flaky = flakyMailer({ send: realSend }, random, { failRate: 0.6, maxDelayMs: 30 });
    t.mailer.send = flaky.mailer.send;
    try {
      // Adoptions are the donor's action; a mail outage must not fail them.
      const ids = await benchIds(10);
      const results = await Promise.all(ids.map((id, i) => adopt(actors.donors[i]!.cookie, id, 1)));
      expect(results.map((r) => r.statusCode)).toEqual(ids.map(() => 201));

      // The daily job runs a few times during the outage...
      t.mailer.sent.length = 0;
      for (let i = 0; i < 4; i++) await t.services.reminders.sendDueReminders();
      // ...then mail recovers and it runs again.
      flaky.heal();
      await t.services.reminders.sendDueReminders();
      await t.services.reminders.sendDueReminders();

      const reminded = t.mailer.sent.filter((m) => m.subject.includes('ends in')).map((m) => m.to);
      expect(reminded.sort()).toEqual(actors.donors.map((d) => d.email).sort()); // everyone, once
      console.log(`mail failed ${flaky.failures()} times; every donor got exactly one reminder`);
    } finally {
      t.mailer.send = realSend;
    }
  });

  it('mail outage: a sign-in email that failed to send does not lock the person out', async () => {
    await setUpPark(t, 3, 0);
    const realSend = t.mailer.send;
    t.mailer.send = async () => {
      throw new Error('chaos: mail provider unavailable');
    };
    const failed = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link',
      payload: { email: 'unlucky@example.org' },
    });
    t.mailer.send = realSend;
    expect(failed.statusCode).toBeGreaterThanOrEqual(500);

    // Mail is back; the person tries again straight away and should get their link.
    const retry = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link',
      payload: { email: 'unlucky@example.org' },
    });
    expect(retry.statusCode).toBe(204);
  });

  it('clock chaos: time jumps never duplicate or misdirect reminders', async () => {
    const actors = await setUpPark(t, 8, 8);
    const random = rng(SEED + 3);
    const ids = await benchIds(8);
    await Promise.all(ids.map((id, i) => adopt(actors.donors[i]!.cookie, id, random.pick([1, 12, 24]))));
    t.mailer.sent.length = 0;

    // Leap forward by random amounts (hours to months), running the daily job after each leap.
    for (let i = 0; i < 25; i++) {
      t.clock.advance((1 + random.int(40 * 24)) * 3_600_000);
      await t.services.reminders.sendDueReminders();
    }

    const perDonor = new Map<string, string[]>();
    for (const m of t.mailer.sent.filter((m) => m.subject.includes('ends in'))) {
      perDonor.set(m.to, [...(perDonor.get(m.to) ?? []), m.subject]);
    }
    for (const [donor, subjects] of perDonor) {
      // At most one reminder per threshold (60, 30, 7 days), never the same one twice.
      expect(subjects.length, donor).toBeLessThanOrEqual(3);
      expect(new Set(subjects).size, donor).toBe(subjects.length);
    }
    expect(await violatedInvariants(t.db)).toEqual({});
  });
});
