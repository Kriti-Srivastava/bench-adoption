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

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';
const call = (method: Method, url: string, cookie: string, payload?: object) =>
  t.app.inject({ method, url: `/api/v1${url}`, headers: { cookie }, payload });

/** Runs the worker so queued emails land in the test mailbox. */
const deliver = () => t.services.outbox.dispatch(100);

const adopt = (cookie: string, benchId: string, extra: object = {}) =>
  call('POST', '/adoptions', cookie, { benchId, months: 12, displayName: 'The Smiths', ...extra }).then((r) =>
    r.json(),
  );

const benchByCode = async (code: string) =>
  (await t.app.inject({ method: 'GET', url: `/api/v1/parks/${PARK}/benches/${code}` })).json();

const tasksFor = async (cookie: string, benchId: string) =>
  (await call('GET', `/benches/${benchId}/maintenance`, cookie)).json().items;

describe('plaques', () => {
  it('queues a plaque installation for every new adoption, and cancels it if the adoption is', async () => {
    const donor = await signIn(t, 'donor@example.org');
    const staff = await signIn(t, 'staff@example.org', 'staff');
    const a = await adopt(donor.cookie, benches[0].id, { dedication: 'For Nana' });

    const [plaque] = await tasksFor(staff.cookie, benches[0].id);
    expect(plaque).toMatchObject({ type: 'plaque', status: 'open', title: 'Install plaque: The Smiths', details: 'For Nana' });

    await call('POST', `/adoptions/${a.id}/cancel`, staff.cookie);
    const [after] = await tasksFor(staff.cookie, benches[0].id);
    expect(after.status).toBe('cancelled');
  });
});

describe('retiring a bench', () => {
  async function adoptedBench() {
    const donor = await signIn(t, 'donor@example.org');
    const staff = await signIn(t, 'staff@example.org', 'staff');
    const adoption = await adopt(donor.cookie, benches[0].id);
    await deliver(); // flush the adoption confirmation, so the mailbox shows only what follows
    t.mailer.sent.length = 0;
    return { donor, staff, adoption };
  }

  it('can keep the adoption running until it ends', async () => {
    const { staff } = await adoptedBench();
    const res = await call('POST', `/benches/${benches[0].id}/retire`, staff.cookie, { adoption: 'keep' });
    expect(res.json()).toMatchObject({ availability: 'retired', currentAdoption: { displayName: 'The Smiths' } });
    // The donor keeps their dedication but can't renew, so they are told now.
    await deliver();
    expect(t.mailer.sent).toMatchObject([
      { to: 'donor@example.org', subject: 'Bench T-001 is leaving the park' },
    ]);

    const history = await tasksFor(staff.cookie, benches[0].id);
    expect(history[0]).toMatchObject({ title: 'Bench retired', status: 'done' });
    expect(history[0].details).toContain('Adoption kept until it ends on 2027-09-21');
  });

  it('can end the adoption now and tell the donor', async () => {
    const { staff } = await adoptedBench();
    const res = await call('POST', `/benches/${benches[0].id}/retire`, staff.cookie, {
      adoption: 'end',
      reason: 'storm damage',
    });
    expect(res.json()).toMatchObject({ availability: 'retired', currentAdoption: null });
    await deliver();
    expect(t.mailer.sent[0]).toMatchObject({
      to: 'donor@example.org',
      subject: 'Your adoption of bench T-001 has ended',
    });
    expect(t.mailer.sent[0]!.text).toContain('storm damage');
  });

  it('can move the adoption and plaque to another bench', async () => {
    const { staff, donor } = await adoptedBench();
    const res = await call('POST', `/benches/${benches[0].id}/retire`, staff.cookie, {
      adoption: 'relocate',
      relocateTo: 'T-003',
    });
    expect(res.json()).toMatchObject({ availability: 'retired', currentAdoption: null });

    const target = await benchByCode('T-003');
    expect(target.currentAdoption).toMatchObject({ displayName: 'The Smiths', endDate: '2027-09-21' });
    const [move] = await tasksFor(staff.cookie, benches[2].id);
    expect(move).toMatchObject({ type: 'relocation', status: 'open', title: 'Move plaque from T-001' });
    await deliver();
    expect(t.mailer.sent[0]!.subject).toBe('Your adoption has moved to bench T-003');

    const mine = (await call('GET', '/me/adoptions', donor.cookie)).json().items;
    expect(mine[0].benchCode).toBe('T-003');
  });

  it('refuses to move an adoption onto a bench that is taken', async () => {
    const { staff } = await adoptedBench();
    const other = await signIn(t, 'other@example.org');
    await adopt(other.cookie, benches[2].id);
    const res = await call('POST', `/benches/${benches[0].id}/retire`, staff.cookie, {
      adoption: 'relocate',
      relocateTo: 'T-003',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('relocation_target_unavailable');
    expect((await benchByCode('T-001')).availability).toBe('adopted'); // nothing changed
  });

  it('requires a destination when moving', async () => {
    const { staff } = await adoptedBench();
    const res = await call('POST', `/benches/${benches[0].id}/retire`, staff.cookie, { adoption: 'relocate' });
    expect(res.statusCode).toBe(400);
  });

  it('can return a retired bench to the program', async () => {
    const staff = await signIn(t, 'staff@example.org', 'staff');
    await call('POST', `/benches/${benches[2].id}/retire`, staff.cookie, { adoption: 'keep' });
    const res = await call('POST', `/benches/${benches[2].id}/restore`, staff.cookie);
    expect(res.json().availability).toBe('available');
  });

  it('is staff-only', async () => {
    const donor = await signIn(t, 'donor@example.org');
    const res = await call('POST', `/benches/${benches[0].id}/retire`, donor.cookie, { adoption: 'keep' });
    expect(res.statusCode).toBe(403);
  });
});

describe('maintenance', () => {
  it('tracks a task from open to done and derives the last inspection', async () => {
    const staff = await signIn(t, 'staff@example.org', 'staff');
    const before = (await call('GET', `/parks/${PARK}/admin/benches`, staff.cookie)).json().items[0];
    expect(before).toMatchObject({ code: 'T-001', needsInspection: true, lastInspectedOn: null, openTasks: 0 });

    const created = (
      await call('POST', `/benches/${benches[0].id}/maintenance`, staff.cookie, {
        type: 'inspection',
        title: 'Annual survey',
        scheduledFor: '2026-10-01',
      })
    ).json();
    expect(created).toMatchObject({ status: 'scheduled', priority: 'normal', reportedBy: { email: 'staff@example.org' } });

    const done = (
      await call('PATCH', `/maintenance/${created.id}`, staff.cookie, { status: 'done', resolution: 'All good.' })
    ).json();
    expect(done.completedAt).not.toBeNull();

    const after = (await call('GET', `/parks/${PARK}/admin/benches`, staff.cookie)).json().items[0];
    expect(after).toMatchObject({ needsInspection: false, lastInspectedOn: '2026-09-21', openTasks: 0 });

    // A year later it is due again.
    t.clock.set('2027-09-22');
    const staffLater = await signIn(t, 'staff@example.org', 'staff');
    const due = (await call('GET', `/parks/${PARK}/admin/benches`, staffLater.cookie)).json().items[0];
    expect(due.needsInspection).toBe(true);
  });

  it('reopening a done task clears its completion time', async () => {
    const staff = await signIn(t, 'staff@example.org', 'staff');
    const task = (
      await call('POST', `/benches/${benches[0].id}/maintenance`, staff.cookie, { type: 'painting', title: 'Repaint' })
    ).json();
    await call('PATCH', `/maintenance/${task.id}`, staff.cookie, { status: 'done' });
    const reopened = (await call('PATCH', `/maintenance/${task.id}`, staff.cookie, { status: 'open' })).json();
    expect(reopened.completedAt).toBeNull();
  });

  it('only assigns work to staff', async () => {
    const staff = await signIn(t, 'staff@example.org', 'staff');
    await signIn(t, 'donor@example.org');
    const users = (await call('GET', '/admin/users', staff.cookie)).json().items;
    const idOf = (email: string) => users.find((u: { email: string }) => u.email === email).id;
    const task = (
      await call('POST', `/benches/${benches[0].id}/maintenance`, staff.cookie, { type: 'repair', title: 'Loose slat' })
    ).json();

    const bad = await call('PATCH', `/maintenance/${task.id}`, staff.cookie, { assigneeId: idOf('donor@example.org') });
    expect(bad.json().error.code).toBe('invalid_assignee');
    const good = await call('PATCH', `/maintenance/${task.id}`, staff.cookie, { assigneeId: idOf('staff@example.org') });
    expect(good.json().assignee.email).toBe('staff@example.org');
  });

  it('summarises the park for the dashboard', async () => {
    const donor = await signIn(t, 'donor@example.org');
    const staff = await signIn(t, 'staff@example.org', 'staff');
    await adopt(donor.cookie, benches[0].id);
    await call('POST', `/benches/${benches[1].id}/maintenance`, staff.cookie, {
      type: 'repair',
      priority: 'urgent',
      title: 'Broken slat',
    });
    const summary = (await call('GET', `/parks/${PARK}/admin/summary`, staff.cookie)).json();
    expect(summary).toEqual({
      benches: { available: 2, adopted: 1, ending_soon: 0, retired: 0 },
      needsInspection: 3,
      openTasks: 2,
      urgentTasks: 1,
      plaquesToInstall: 1,
      endingSoon: 0,
    });
  });
});

describe('visitor reports', () => {
  it('lets a signed-in visitor report a problem and follow it', async () => {
    const visitor = await signIn(t, 'walker@example.org');
    const staff = await signIn(t, 'staff@example.org', 'staff');
    const res = await call('POST', `/benches/${benches[0].id}/reports`, visitor.cookie, {
      kind: 'graffiti',
      details: 'Spray paint on the back rest.',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ type: 'graffiti', status: 'open', benchCode: 'T-001' });

    const queue = (await call('GET', `/parks/${PARK}/maintenance?openOnly=true`, staff.cookie)).json().items;
    expect(queue[0]).toMatchObject({ title: 'Reported: graffiti', reportedBy: { email: 'walker@example.org' } });

    await call('PATCH', `/maintenance/${queue[0].id}`, staff.cookie, { status: 'done', resolution: 'Cleaned off.' });
    const mine = (await call('GET', '/me/reports', visitor.cookie)).json().items;
    expect(mine[0]).toMatchObject({ status: 'done', resolution: 'Cleaned off.' });
  });

  it('requires signing in', async () => {
    const res = await call('POST', `/benches/${benches[0].id}/reports`, '', { kind: 'other', details: 'x' });
    expect(res.statusCode).toBe(401);
  });

  it('keeps the crew queue staff-only', async () => {
    const visitor = await signIn(t, 'walker@example.org');
    expect((await call('GET', `/parks/${PARK}/maintenance`, visitor.cookie)).statusCode).toBe(403);
  });
});

describe('users', () => {
  it('lets admins change roles, but not their own', async () => {
    const admin = await signIn(t, 'admin@example.org', 'admin');
    await signIn(t, 'helper@example.org');

    const promoted = await call('PUT', '/users/role', admin.cookie, { email: 'helper@example.org', role: 'staff' });
    expect(promoted.json().role).toBe('staff');

    const self = await call('PUT', '/users/role', admin.cookie, { email: 'admin@example.org', role: 'adopter' });
    expect(self.json().error.code).toBe('cannot_change_own_role');
  });

  it('lets staff see users but not change roles', async () => {
    const staff = await signIn(t, 'staff@example.org', 'staff');
    const donor = await signIn(t, 'donor@example.org');
    await adopt(donor.cookie, benches[0].id);

    const users = (await call('GET', '/admin/users?q=donor', staff.cookie)).json().items;
    expect(users).toEqual([expect.objectContaining({ email: 'donor@example.org', activeAdoptions: 1 })]);
    const res = await call('PUT', '/users/role', staff.cookie, { email: 'donor@example.org', role: 'admin' });
    expect(res.statusCode).toBe(403);
  });
});
