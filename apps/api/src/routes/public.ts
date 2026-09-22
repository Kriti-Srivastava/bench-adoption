import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { benchDetail, benchList, listBenchesQuery, park } from '@bench/shared';
import type { Services } from '../services/index.ts';

/** Read-only endpoints anyone can use. */
export const publicRoutes =
  (services: Services): FastifyPluginAsyncZod =>
  async (app) => {
    const tags = ['benches'];
    const parkParams = z.object({ slug: z.string() });

    app.get(
      '/parks/:slug',
      { schema: { tags, params: parkParams, response: { 200: park } } },
      async (req) => services.benches.getPark(req.params.slug),
    );

    app.get(
      '/parks/:slug/benches',
      { schema: { tags, params: parkParams, querystring: listBenchesQuery, response: { 200: benchList } } },
      async (req, reply) => {
        // Public and read-heavy: let browsers and a CDN cache it briefly.
        reply.header('cache-control', 'public, max-age=30');
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
      async (req) => services.benches.getBench(req.params.slug, req.params.code),
    );
  };
