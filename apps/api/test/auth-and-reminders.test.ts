import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

const requestLink = async (payload: Record<string, unknown>) => {
  const res = await t.app.inject({ method: 'POST', url: '/api/v1/auth/magic-link', payload });
  await t.services.outbox.dispatch(100); // stand in for the worker
  return res;
};

const lastToken = () =>
  new URL(t.mailer.sent.at(-1)!.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token');

const verify = (token: string | null) =>
  t.app.inject({ method: 'POST', url: '/api/v1/auth/verify', payload: { token } });

describe('magic-link sign in', () => {
  it('creates the account on first use and carries the redirect', async () => {
    expect((await requestLink({ email: ' New@Example.org ', redirectTo: '/adopt/T-001' })).statusCode).toBe(204);
    expect(t.mailer.sent.at(-1)!.to).toBe('new@example.org');

    const res = await verify(lastToken());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      user: { email: 'new@example.org', role: 'adopter', fullName: null },
      redirectTo: '/adopt/T-001',
    });
    const cookie = res.cookies.find((c) => c.name === 'sid')!;
    expect(cookie.httpOnly).toBe(true);

    const me = await t.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: `sid=${cookie.value}` } });
    expect(me.json().email).toBe('new@example.org');
  });

  it('works only once', async () => {
    await requestLink({ email: 'a@example.org' });
    const token = lastToken();
    expect((await verify(token)).statusCode).toBe(200);
    expect((await verify(token)).json().error.code).toBe('invalid_link');
  });

  it('expires', async () => {
    await requestLink({ email: 'a@example.org' });
    t.clock.set('2026-09-22');
    expect((await verify(lastToken())).json().error.code).toBe('invalid_link');
  });

  it('sends at most one link a minute to the same address', async () => {
    expect((await requestLink({ email: 'a@example.org' })).statusCode).toBe(204);
    const again = await requestLink({ email: 'a@example.org' });
    expect(again.statusCode).toBe(429);
    expect(again.json().error.code).toBe('too_many_requests');
    // Other addresses are unaffected.
    expect((await requestLink({ email: 'b@example.org' })).statusCode).toBe(204);

    t.clock.advance(61_000);
    expect((await requestLink({ email: 'a@example.org' })).statusCode).toBe(204);
  });

  it('sends at most five links an hour to the same address', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await requestLink({ email: 'a@example.org' })).statusCode).toBe(204);
      t.clock.advance(2 * 60_000);
    }
    expect((await requestLink({ email: 'a@example.org' })).statusCode).toBe(429);
    t.clock.advance(60 * 60_000);
    expect((await requestLink({ email: 'a@example.org' })).statusCode).toBe(204);
  });

  it('counts concurrent requests correctly', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => requestLink({ email: 'burst@example.org' })),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([204, 429, 429, 429, 429]);
  });

  it('refuses redirects to other sites', async () => {
    const res = await requestLink({ email: 'a@example.org', redirectTo: '//evil.example' });
    expect(res.statusCode).toBe(400);
  });

  it('logs out', async () => {
    const { cookie } = await signIn(t, 'a@example.org');
    await t.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie } });
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('lets people set their name', async () => {
    const { cookie } = await signIn(t, 'a@example.org');
    const res = await t.app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie },
      payload: { fullName: 'Ada Lovelace' },
    });
    expect(res.json().fullName).toBe('Ada Lovelace');
  });
});

describe('renewal reminders', () => {
  async function adoptFor(months: number) {
    const { cookie } = await signIn(t, 'donor@example.org');
    const adoption = (
      await t.app.inject({
        method: 'POST',
        url: '/api/v1/adoptions',
        headers: { cookie },
        payload: { benchId: benches[0].id, months, displayName: 'Donor' },
      })
    ).json();
    return { ...adoption, cookie };
  }

  const reminders = () => t.mailer.sent.filter((m) => m.subject.includes('ends in'));

  /** The daily job queues reminders; the worker delivers them. Returns how many were queued. */
  async function runDailyJobAndWorker(): Promise<number> {
    const queued = await t.services.reminders.enqueueDueReminders();
    await t.services.outbox.dispatch(100);
    return queued;
  }

  it('sends each reminder once as the end date approaches', async () => {
    await adoptFor(12); // ends 2027-09-21
    t.mailer.sent.length = 0;

    t.clock.set('2027-06-01');
    expect(await runDailyJobAndWorker()).toBe(0);

    t.clock.set('2027-08-01'); // 51 days left
    expect(await runDailyJobAndWorker()).toBe(1);
    expect(await runDailyJobAndWorker()).toBe(0);

    t.clock.set('2027-09-01'); // 20 days left
    expect(await runDailyJobAndWorker()).toBe(1);

    t.clock.set('2027-09-16'); // 5 days left
    expect(await runDailyJobAndWorker()).toBe(1);

    expect(reminders().map((m) => m.subject)).toEqual([
      'Bench T-001: your adoption ends in 51 days',
      'Bench T-001: your adoption ends in 20 days',
      'Bench T-001: your adoption ends in 5 days',
    ]);
    expect(reminders()[0]!.text).toContain('http://web.test/me/benches?renew=');
  });

  it('skips reminders it missed rather than sending them all at once', async () => {
    await adoptFor(1); // ends 2026-10-21, 30 days away
    expect(await runDailyJobAndWorker()).toBe(1);
    expect(await runDailyJobAndWorker()).toBe(0);
  });

  it('stops once the adoption is renewed', async () => {
    const first = await adoptFor(12);
    await t.app.inject({
      method: 'POST',
      url: `/api/v1/adoptions/${first.id}/renew`,
      headers: { cookie: first.cookie },
      payload: { months: 12 },
    });
    t.clock.set('2027-09-01');
    expect(await runDailyJobAndWorker()).toBe(0);
  });

  it('delivers a reminder whose first send failed, without queueing it twice', async () => {
    await adoptFor(1);
    t.mailer.sent.length = 0;
    const send = t.mailer.send;
    t.mailer.send = async () => {
      throw new Error('SMTP down');
    };
    try {
      // Queued once; the attempt fails and is scheduled for a retry.
      expect(await runDailyJobAndWorker()).toBe(1);
      expect(reminders()).toHaveLength(0);
      // The job runs again during the outage: nothing is queued twice.
      expect(await runDailyJobAndWorker()).toBe(0);
    } finally {
      t.mailer.send = send;
    }
    t.clock.advance(2 * 60_000); // past the backoff
    await t.services.outbox.dispatch();
    expect(reminders()).toHaveLength(1);
  });
});
