/**
 * Phase 3: events are the history, and notifications go through the outbox.
 * Recording an event and queueing its emails happen in the same transaction
 * as the change, and a worker delivers them with retries.
 */
import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { events, outbox } from '../src/db/schema.ts';
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
  t.mailer.sent.length = 0;
});

const call = (method: 'POST' | 'GET', url: string, cookie: string, payload?: object) =>
  t.app.inject({ method, url: `/api/v1${url}`, headers: { cookie }, payload });

const adopt = (cookie: string, benchId: string) =>
  call('POST', '/adoptions', cookie, { benchId, months: 12, displayName: 'The Smiths' }).then((r) => r.json());

const eventTypes = async () =>
  (await t.db.select({ type: events.type }).from(events).orderBy(desc(events.createdAt))).map((e) => e.type);

const queued = () => t.db.select().from(outbox).where(eq(outbox.status, 'pending'));

describe('events and notifications', () => {
  it('records what happened and queues the donor’s confirmation together', async () => {
    const donor = await signIn(t, 'donor@example.org');
    t.mailer.sent.length = 0; // signing in queues and delivers its own link
    await adopt(donor.cookie, benches[0].id);

    expect(await eventTypes()).toContain('adoption.created');
    expect(await queued()).toMatchObject([
      { recipient: 'donor@example.org', subject: "You've adopted bench T-001", attempts: 0 },
    ]);
    // Nothing has been sent yet: the worker does that.
    expect(t.mailer.sent).toEqual([]);

    await t.services.outbox.dispatch();
    expect(t.mailer.sent).toMatchObject([{ to: 'donor@example.org' }]);
    // Running the worker again sends nothing twice.
    expect(await t.services.outbox.dispatch()).toEqual({ sent: 0, retrying: 0, failed: 0 });
  });

  it('tells the donor when staff cancel their adoption', async () => {
    const donor = await signIn(t, 'donor@example.org');
    const staff = await signIn(t, 'staff@example.org', 'staff');
    const adoption = await adopt(donor.cookie, benches[0].id);
    await t.services.outbox.dispatch();
    t.mailer.sent.length = 0;

    await call('POST', `/adoptions/${adoption.id}/cancel`, staff.cookie);
    await t.services.outbox.dispatch();
    expect(t.mailer.sent).toMatchObject([
      { to: 'donor@example.org', subject: 'Your adoption of bench T-001 has ended' },
    ]);
    expect(await eventTypes()).toContain('adoption.cancelled');
  });

  it('records restoring a bench without emailing anyone', async () => {
    const staff = await signIn(t, 'staff@example.org', 'staff');
    await call('POST', `/benches/${benches[0].id}/retire`, staff.cookie, { adoption: 'keep' });
    await call('POST', `/benches/${benches[0].id}/restore`, staff.cookie);
    expect(await eventTypes()).toEqual(expect.arrayContaining(['bench.retired', 'bench.restored']));
    expect(await queued()).toEqual([]); // no adoption, so nobody to tell
  });
});

describe('the outbox worker', () => {
  async function queueOne() {
    const donor = await signIn(t, 'donor@example.org');
    await adopt(donor.cookie, benches[0].id);
    t.mailer.sent.length = 0;
  }

  it('retries a failed send later, and gives up after five attempts', async () => {
    await queueOne();
    const realSend = t.mailer.send;
    t.mailer.send = async () => {
      throw new Error('SMTP down');
    };

    expect(await t.services.outbox.dispatch()).toEqual({ sent: 0, retrying: 1, failed: 0 });
    // Not due yet: the backoff holds it back.
    expect(await t.services.outbox.dispatch()).toEqual({ sent: 0, retrying: 0, failed: 0 });

    for (let attempt = 2; attempt <= 4; attempt++) {
      t.clock.advance(attempt ** 2 * 60_000);
      expect(await t.services.outbox.dispatch()).toEqual({ sent: 0, retrying: 1, failed: 0 });
    }
    t.clock.advance(60 * 60_000);
    expect(await t.services.outbox.dispatch()).toEqual({ sent: 0, retrying: 0, failed: 1 });

    t.mailer.send = realSend;
    expect(await t.services.outbox.counts()).toMatchObject({ failed: 1 });
    // A parked message is not retried on its own; it needs a person to look.
    t.clock.advance(24 * 3_600_000);
    expect(await t.services.outbox.dispatch()).toEqual({ sent: 0, retrying: 0, failed: 0 });
  });

  it('never sends the same email twice, even with two workers running', async () => {
    const donors = await Promise.all(
      Array.from({ length: 4 }, (_, i) => signIn(t, `donor${i}@example.org`)),
    );
    for (const [i, donor] of donors.entries()) await adopt(donor.cookie, benches[i % 3]!.id);
    t.mailer.sent.length = 0;

    const [a, b] = await Promise.all([t.services.outbox.dispatch(10), t.services.outbox.dispatch(10)]);
    expect(a.sent + b.sent).toBe(t.mailer.sent.length);
    expect(new Set(t.mailer.sent.map((m) => m.to)).size).toBe(t.mailer.sent.length);
  });

  it('clears out old sent emails but keeps recent ones', async () => {
    await queueOne(); // a sign-in link and an adoption confirmation
    await t.services.outbox.dispatch();
    expect(await t.services.outbox.purgeSent()).toBe(0);
    t.clock.advance(31 * 86_400_000);
    expect(await t.services.outbox.purgeSent()).toBe(2);
  });
});
