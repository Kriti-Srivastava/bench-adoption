import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { benchDetail, benchList, listBenchesQuery, park } from '@bench/shared';
import type { Services } from '../services/index.ts';

/**
 * Read-only endpoints anyone can use. They are the only public (cacheable)
 * routes: a CDN can serve them, which is what lets the public pages scale.
 */
export const publicRoutes =
  (services: Services): FastifyPluginAsyncZod =>
  async (app) => {
    const tags = ['benches'];
    const parkParams = z.object({ slug: z.string() });

    app.get(
      '/parks/:slug',
      { config: { cache: 'public' }, schema: { tags, params: parkParams, response: { 200: park } } },
      async (req) => services.benches.getPark(req.params.slug),
    );

    app.get(
      '/parks/:slug/benches',
      {
        config: { cache: 'public' },
        schema: { tags, params: parkParams, querystring: listBenchesQuery, response: { 200: benchList } },
      },
      async (req) => services.benches.listBenches(req.params.slug, req.query),
    );

    app.get(
      '/parks/:slug/benches/:code',
      {
        config: { cache: 'public' },
        schema: {
          tags,
          params: parkParams.extend({ code: z.string() }),
          response: { 200: benchDetail },
        },
      },
      async (req) => services.benches.getBench(req.params.slug, req.params.code),
    );
  };
