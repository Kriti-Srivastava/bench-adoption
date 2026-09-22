import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { benchDetail, benchList, listBenchesQuery, park } from '@bench/shared';
import type { Services } from '../services/index.ts';

/**
 * Caching for public data. Browsers always revalidate (cheap: an unchanged
 * response is a 304 thanks to ETags), so someone who just adopted a bench
 * never sees a stale map. Shared caches (a CDN) may serve a copy for a few
 * seconds, which is what lets the public pages scale: the origin computes
 * each response a handful of times a minute rather than once per visitor.
 */
const PUBLIC_CACHE = 'public, max-age=0, must-revalidate, s-maxage=15, stale-while-revalidate=60';

/** Read-only endpoints anyone can use. */
export const publicRoutes =
  (services: Services): FastifyPluginAsyncZod =>
  async (app) => {
    const tags = ['benches'];
    const parkParams = z.object({ slug: z.string() });

    app.get(
      '/parks/:slug',
      { schema: { tags, params: parkParams, response: { 200: park } } },
      async (req, reply) => {
        reply.header('cache-control', PUBLIC_CACHE);
        return services.benches.getPark(req.params.slug);
      },
    );

    app.get(
      '/parks/:slug/benches',
      { schema: { tags, params: parkParams, querystring: listBenchesQuery, response: { 200: benchList } } },
      async (req, reply) => {
        reply.header('cache-control', PUBLIC_CACHE);
        return services.benches.listBenches(req.params.slug, req.query);
      },
    );

    app.get(
      '/parks/:slug/benches/:code',
      {
        schema: {
          tags,
          params: parkParams.extend({ code: z.string() }),
          response: { 200: benchDetail },
        },
      },
      async (req, reply) => {
        reply.header('cache-control', PUBLIC_CACHE);
        return services.benches.getBench(req.params.slug, req.params.code);
      },
    );
  };
