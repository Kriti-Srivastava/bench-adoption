/**
 * Park staff and donors are kept apart: staff accounts look after benches and
 * cannot adopt them, and the staff entrance issues its own short-lived links
 * that only work for accounts with staff access.
 */
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
  t.mailer.sent.length = 0;
});

const requestLink = async (email: string, audience?: 'donor' | 'staff') => {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/v1/auth/magic-link',
    payload: { email, audience, redirectTo: '/parks/test-park/admin' },
  });
  await t.services.outbox.dispatch(10); // stand in for the worker
  return res;
};

const lastEmail = () => t.mailer.sent.at(-1);
const tokenFromLastEmail = () =>
  new URL(lastEmail()!.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token');
const verify = (token: string | null) =>
  t.app.inject({ method: 'POST', url: '/api/v1/auth/verify', payload: { token } });

describe('staff accounts cannot adopt', () => {
  it('refuses adoption and renewal, explaining what to do instead', async () => {
    const staff = await signIn(t, 'ranger@example.org', 'staff');
    const donor = await signIn(t, 'donor@example.org');

    const attempt = await t.app.inject({
      method: 'POST',
      url: '/api/v1/adoptions',
      headers: { cookie: staff.cookie },
      payload: { benchId: benches[0].id, months: 12, displayName: 'Ranger' },
    });
    expect(attempt.statusCode).toBe(403);
    expect(attempt.json().error.message).toContain('personal email address');

    // A donor can still adopt, and the staff member cannot renew it either.
    const adoption = (
      await t.app.inject({
        method: 'POST',
        url: '/api/v1/adoptions',
        headers: { cookie: donor.cookie },
        payload: { benchId: benches[0].id, months: 12, displayName: 'Donor' },
      })
    ).json();
    const renewal = await t.app.inject({
      method: 'POST',
      url: `/api/v1/adoptions/${adoption.id}/renew`,
      headers: { cookie: staff.cookie },
      payload: { months: 12 },
    });
    expect(renewal.statusCode).toBe(403);
  });
});

describe('granting staff access', () => {
  it('refuses an address that still adopts a bench, so no account is both', async () => {
    const admin = await signIn(t, 'admin@example.org', 'admin');
    const donor = await signIn(t, 'donor@example.org');
    const adoption = (
      await t.app.inject({
        method: 'POST',
        url: '/api/v1/adoptions',
        headers: { cookie: donor.cookie },
        payload: { benchId: benches[0].id, months: 12, displayName: 'Donor' },
      })
    ).json();

    const promote = () =>
      t.app.inject({
        method: 'PUT',
        url: '/api/v1/users/role',
        headers: { cookie: admin.cookie },
        payload: { email: 'donor@example.org', role: 'staff' },
      });

    const refused = await promote();
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({ code: 'adopter_has_benches' });
    expect(refused.json().error.message).toContain('separate work address');

    // Once the address holds no bench, it can take up staff work.
    await t.app.inject({
      method: 'POST',
      url: `/api/v1/adoptions/${adoption.id}/cancel`,
      headers: { cookie: admin.cookie },
      payload: {},
    });
    expect((await promote()).statusCode).toBe(200);
  });
});

describe('the staff entrance', () => {
  it('sends a short-lived link to a staff address', async () => {
    await signIn(t, 'ranger@example.org', 'staff');
    t.mailer.sent.length = 0;
    t.clock.advance(61_000); // past the per-address limit

    expect((await requestLink('ranger@example.org', 'staff')).statusCode).toBe(204);
    expect(lastEmail()).toMatchObject({ to: 'ranger@example.org', subject: 'Your park staff sign-in link' });
    expect(lastEmail()!.text).toContain('expire in 5 minutes');

    const token = tokenFromLastEmail();
    t.clock.advance(6 * 60_000); // donors would still have 9 minutes left
    expect((await verify(token)).json().error.code).toBe('invalid_link');
  });

  it('tells a donor address that it has no staff access, without creating a link', async () => {
    await signIn(t, 'walker@example.org'); // an ordinary donor account
    t.mailer.sent.length = 0;
    t.clock.advance(61_000);

    // The same 204 as any other request: it reveals nothing about who has access.
    expect((await requestLink('walker@example.org', 'staff')).statusCode).toBe(204);
    expect(lastEmail()).toMatchObject({
      to: 'walker@example.org',
      subject: 'No park staff access for this address',
    });
    expect(lastEmail()!.text).not.toContain('/auth/verify');
  });

  it('refuses a staff link whose access was revoked before it was used', async () => {
    const admin = await signIn(t, 'admin@example.org', 'admin');
    await signIn(t, 'ranger@example.org', 'staff');
    t.mailer.sent.length = 0;
    t.clock.advance(61_000);
    await requestLink('ranger@example.org', 'staff');
    const token = tokenFromLastEmail();

    await t.app.inject({
      method: 'PUT',
      url: '/api/v1/users/role',
      headers: { cookie: admin.cookie },
      payload: { email: 'ranger@example.org', role: 'adopter' },
    });

    const res = await verify(token);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('no_staff_access');
  });

  it('turns a staff account away from the donor entrance', async () => {
    await signIn(t, 'ranger@example.org', 'staff');
    t.mailer.sent.length = 0;
    t.clock.advance(61_000);

    // Nothing is given away when the link is requested: the refusal only
    // reaches the mailbox's owner, when they use it.
    await requestLink('ranger@example.org');
    expect(lastEmail()).toMatchObject({ subject: 'Your sign-in link' });

    const res = await verify(tokenFromLastEmail());
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('use_staff_entrance');
  });

  it('still lets donors sign in the normal way', async () => {
    expect((await requestLink('walker@example.org')).statusCode).toBe(204);
    expect(lastEmail()).toMatchObject({ subject: 'Your sign-in link' });
    expect((await verify(tokenFromLastEmail())).statusCode).toBe(200);
  });
});
