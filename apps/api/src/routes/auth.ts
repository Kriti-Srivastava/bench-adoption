import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  me,
  session,
  requestMagicLinkInput,
  updateMeInput,
  verifyMagicLinkInput,
  verifyMagicLinkResult,
} from '@bench/shared';
import {
  clearSessionCookie,
  requireUser,
  SESSION_COOKIE,
  setSessionCookie,
} from '../auth/session.ts';
import type { Config } from '../config.ts';
import { toMe } from '../services/auth.ts';
import type { Services } from '../services/index.ts';

export const authRoutes =
  (services: Services, config: Config): FastifyPluginAsyncZod =>
  async (app) => {
    const tags = ['auth'];

    app.post(
      '/auth/magic-link',
      {
        schema: { tags, body: requestMagicLinkInput },
        // Each request sends an email, so limit how often it can be called.
        config: { rateLimit: { max: config.authRateLimitPerMinute, timeWindow: '1 minute' } },
      },
      async (req, reply) => {
        await services.auth.requestMagicLink(req.body.email, req.body.redirectTo ?? null);
        return reply.code(204).send();
      },
    );

    app.post(
      '/auth/verify',
      { schema: { tags, body: verifyMagicLinkInput, response: { 200: verifyMagicLinkResult } } },
      async (req, reply) => {
        const result = await services.auth.verifyMagicLink(req.body.token);
        setSessionCookie(reply, config, result.sessionToken, result.sessionExpiresAt);
        return { user: toMe(result.user), redirectTo: result.redirectTo };
      },
    );

    app.post('/auth/logout', { schema: { tags } }, async (req, reply) => {
      const token = req.cookies[SESSION_COOKIE];
      if (token) await services.auth.logout(token);
      clearSessionCookie(reply);
      return reply.code(204).send();
    });

    app.get(
      '/session',
      { schema: { tags, response: { 200: session } } },
      async (req) => ({ user: req.user ? toMe(req.user) : null }),
    );

    app.get('/me', { schema: { tags, response: { 200: me } } }, async (req) =>
      toMe(requireUser(req)),
    );

    app.patch(
      '/me',
      { schema: { tags, body: updateMeInput, response: { 200: me } } },
      async (req) => toMe(await services.auth.updateProfile(requireUser(req), req.body.fullName)),
    );
  };
