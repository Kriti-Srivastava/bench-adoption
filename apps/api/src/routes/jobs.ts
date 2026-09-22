/**
 * Endpoints a scheduler can call (GitHub Actions, cron-job.org, a cloud
 * scheduler), for hosts where running a long-lived worker isn't possible.
 * They do exactly what `npm run jobs:daily` and `npm run worker` do.
 *
 * Protected by a bearer token (`JOBS_TOKEN`). Without that setting the routes
 * are not registered at all.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Config } from '../config.ts';
import { unauthorized } from '../errors.ts';
import type { Services } from '../services/index.ts';

export const jobRoutes =
  (services: Services, config: Config): FastifyPluginAsyncZod =>
  async (app) => {
    if (!config.jobsToken) return;
    const tags = ['jobs'];

    app.addHook('onRequest', async (req) => {
      if (req.headers.authorization !== `Bearer ${config.jobsToken}`) throw unauthorized();
    });

    app.post(
      '/internal/jobs/daily',
      {
        schema: {
          tags,
          response: {
            200: z.object({
              remindersQueued: z.number(),
              signInLinksRemoved: z.number(),
              sessionsRemoved: z.number(),
              sentEmailsRemoved: z.number(),
              delivered: z.object({ sent: z.number(), retrying: z.number(), failed: z.number() }),
            }),
          },
        },
      },
      async () => {
        const remindersQueued = await services.reminders.enqueueDueReminders();
        const purged = await services.auth.purgeExpired();
        const sentEmailsRemoved = await services.outbox.purgeSent();
        const delivered = await services.outbox.dispatch(200);
        return {
          remindersQueued,
          signInLinksRemoved: purged.tokens,
          sessionsRemoved: purged.sessions,
          sentEmailsRemoved,
          delivered,
        };
      },
    );

    app.post(
      '/internal/jobs/send-mail',
      {
        schema: {
          tags,
          response: { 200: z.object({ sent: z.number(), retrying: z.number(), failed: z.number() }) },
        },
      },
      async () => services.outbox.dispatch(200),
    );
  };
