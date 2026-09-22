import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { id, reportProblemInput, userReport, userReportList } from '@bench/shared';
import { requireUser } from '../auth/session.ts';
import type { Services } from '../services/index.ts';

/** Signed-in visitors reporting problems with a bench, and following up on them. */
export const reportRoutes =
  (services: Services): FastifyPluginAsyncZod =>
  async (app) => {
    const tags = ['reports'];

    app.post(
      '/benches/:id/reports',
      {
        schema: { tags, params: z.object({ id }), body: reportProblemInput, response: { 201: userReport } },
        config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      },
      async (req, reply) => {
        const report = await services.maintenance.report(
          requireUser(req),
          req.params.id,
          req.body.kind,
          req.body.details,
        );
        return reply.code(201).send(report);
      },
    );

    app.get('/me/reports', { schema: { tags, response: { 200: userReportList } } }, async (req) => ({
      items: await services.maintenance.myReports(requireUser(req)),
    }));
  };
