/**
 * Response policy: one place decides how every response may be cached.
 *
 * Routes declare their audience in their config (`config: { cache: 'public' }`).
 * Anything that doesn't is treated as private and never stored by browsers or
 * shared caches, so forgetting to think about caching fails safe: a new
 * endpoint can't leak one person's data to another through a CDN.
 */
import type { FastifyInstance } from 'fastify';

export type CachePolicy = 'public' | 'private';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Who may cache this route's responses. Defaults to 'private'. */
    cache?: CachePolicy;
  }
}

const CACHE_CONTROL: Record<CachePolicy | 'error', string> = {
  // Browsers always revalidate (a cheap 304 via ETag), so nobody sees stale
  // data after changing it; a CDN may hold a copy for a few seconds.
  public: 'public, max-age=0, must-revalidate, s-maxage=15, stale-while-revalidate=60',
  private: 'private, no-store',
  // Errors are never cached anywhere (a cached 404 or 500 would outlive the fix).
  error: 'no-store',
};

export interface RoutePolicy {
  method: string;
  url: string;
  cache: CachePolicy;
}

/**
 * Applies the policy to every response and records each route's policy, so
 * tests can check that only intended routes are public. Register before routes.
 */
export function registerResponsePolicy(app: FastifyInstance): RoutePolicy[] {
  const routes: RoutePolicy[] = [];
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      routes.push({ method, url: route.url, cache: route.config?.cache ?? 'private' });
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const policy = req.routeOptions.config?.cache ?? 'private';
    reply.header('cache-control', CACHE_CONTROL[reply.statusCode >= 400 ? 'error' : policy]);
    // Don't let browsers second-guess content types (e.g. render a CSV as HTML).
    reply.header('x-content-type-options', 'nosniff');
    return payload;
  });
  return routes;
}
