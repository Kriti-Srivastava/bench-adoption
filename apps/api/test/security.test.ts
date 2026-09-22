/**
 * Phase 1 hardening: response caching policy, CSV output encoding,
 * production-safe configuration, and graceful degradation without Redis.
 */
import { parse } from 'csv-parse/sync';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.ts';
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

const get = (url: string, cookie = '') => t.app.inject({ method: 'GET', url, headers: { cookie } });

describe('response caching policy', () => {
  it('makes only the intended read-only endpoints public', () => {
    const publicRoutes = t.routePolicies
      .filter((r) => r.cache === 'public' && r.method === 'GET')
      .map((r) => r.url)
      .sort();
    // Adding a public route is a deliberate decision: update this list with care.
    expect(publicRoutes).toEqual([
      '/api/v1/parks/:slug',
      '/api/v1/parks/:slug/benches',
      '/api/v1/parks/:slug/benches/:code',
    ]);
  });

  it('never lets private data be stored by a browser or a CDN', async () => {
    const donor = await signIn(t, 'donor@example.org');
    const staff = await signIn(t, 'staff@example.org', 'staff');
    const privateUrls: [string, string][] = [
      ['/api/v1/session', donor.cookie],
      ['/api/v1/me', donor.cookie],
      ['/api/v1/me/adoptions', donor.cookie],
      [`/api/v1/parks/${PARK}/adoptions`, staff.cookie],
      ['/api/v1/admin/users', staff.cookie],
    ];
    for (const [url, cookie] of privateUrls) {
      const res = await get(url, cookie);
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['cache-control'], url).toBe('private, no-store');
    }
  });

  it('lets CDNs cache public data briefly, and never caches errors', async () => {
    expect((await get(`/api/v1/parks/${PARK}/benches`)).headers['cache-control']).toContain('s-maxage=15');
    const missing = await get(`/api/v1/parks/${PARK}/benches/NOPE`);
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['cache-control']).toBe('no-store');
  });

  it('answers "who am I?" without an error when signed out', async () => {
    const res = await get('/api/v1/session');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: null });
  });
});

describe('CSV export', () => {
  it('neutralises formulas in donor-written text, and marks the download nosniff', async () => {
    const donor = await signIn(t, 'donor@example.org');
    const staff = await signIn(t, 'staff@example.org', 'staff');
    await t.app.inject({
      method: 'POST',
      url: '/api/v1/adoptions',
      headers: { cookie: donor.cookie },
      payload: {
        benchId: benches[0].id,
        months: 12,
        displayName: '=HYPERLINK("http://evil.example","Click")',
        dedication: '@SUM(1)',
      },
    });
    const res = await get(`/api/v1/parks/${PARK}/adoptions.csv`, staff.cookie);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const [row] = parse(res.body, { columns: true }) as Record<string, string>[];
    expect(row!.display_name).toBe(`'=HYPERLINK("http://evil.example","Click")`);
    expect(row!.dedication).toBe("'@SUM(1)");

    // The stored data itself is untouched.
    const bench = (await get(`/api/v1/parks/${PARK}/benches/T-001`)).json();
    expect(bench.currentAdoption.displayName).toBe('=HYPERLINK("http://evil.example","Click")');
  });
});

describe('configuration', () => {
  const production = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://db/bench',
    WEB_URL: 'https://benches.example.org',
    SMTP_HOST: 'smtp.example.org',
    MAIL_FROM: 'Benches <benches@example.org>',
  };

  it('uses secure cookies in production by default', () => {
    expect(loadConfig(production).cookieSecure).toBe(true);
    expect(loadConfig({}).cookieSecure).toBe(false); // development
  });

  it('refuses to start production with unsafe or missing settings, listing every problem', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ConfigError);
    try {
      loadConfig({ ...production, WEB_URL: 'http://benches.example.org', COOKIE_SECURE: 'false' });
    } catch (err) {
      expect((err as ConfigError).problems).toEqual([
        'WEB_URL must use https://',
        'COOKIE_SECURE cannot be false: session cookies would travel over plain HTTP',
      ]);
    }
  });
});

describe('scheduled job endpoints', () => {
  it('are only registered with a token, and refuse the wrong one', async () => {
    // Without JOBS_TOKEN the routes do not exist at all.
    const closed = await t.app.inject({ method: 'POST', url: '/api/v1/internal/jobs/daily' });
    expect(closed.statusCode).toBe(404);

    const scheduled = await createTestApp({ jobsToken: 'shared-with-the-scheduler' });
    try {
      const url = '/api/v1/internal/jobs/daily';
      expect((await scheduled.app.inject({ method: 'POST', url })).statusCode).toBe(401);
      expect(
        (await scheduled.app.inject({ method: 'POST', url, headers: { authorization: 'Bearer wrong' } }))
          .statusCode,
      ).toBe(401);

      const ran = await scheduled.app.inject({
        method: 'POST',
        url,
        headers: { authorization: 'Bearer shared-with-the-scheduler' },
      });
      expect(ran.statusCode).toBe(200);
      expect(ran.json()).toMatchObject({ remindersQueued: 0, delivered: { sent: 0 } });
    } finally {
      await scheduled.app.close();
    }
  });
});

describe('without Redis', () => {
  it('keeps sign-in working and reports itself degraded, not down', async () => {
    const degraded = await createTestApp({ redisUrl: 'redis://127.0.0.1:1' });
    try {
      const signInRes = await degraded.app.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-link',
        payload: { email: 'walker@example.org' },
      });
      expect(signInRes.statusCode).toBe(204);

      const health = await degraded.app.inject({ method: 'GET', url: '/api/health/ready' });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ status: 'degraded', checks: { database: 'ok', redis: 'down' } });

      expect((await degraded.app.inject({ method: 'GET', url: '/api/health/live' })).statusCode).toBe(200);
    } finally {
      await degraded.app.close();
    }
  });
});
