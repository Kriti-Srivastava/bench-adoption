import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { adoption, adoptionList, createAdoptionInput, id, renewAdoptionInput } from '@bench/shared';
import { requireUser } from '../auth/session.ts';
import type { Services } from '../services/index.ts';

/** Endpoints for signed-in adopters. */
export const adoptionRoutes =
  (services: Services): FastifyPluginAsyncZod =>
  async (app) => {
    const tags = ['adoptions'];

    app.post(
      '/adoptions',
      { schema: { tags, body: createAdoptionInput, response: { 201: adoption } } },
      async (req, reply) => {
        const created = await services.adoptions.adopt(requireUser(req), req.body);
        return reply.code(201).send(created);
      },
    );

    app.post(
      '/adoptions/:id/renew',
      {
        schema: {
          tags,
          params: z.object({ id }),
          body: renewAdoptionInput,
          response: { 201: adoption },
        },
      },
      async (req, reply) => {
        const renewed = await services.adoptions.renew(
          requireUser(req),
          req.params.id,
          req.body.months,
        );
        return reply.code(201).send(renewed);
      },
    );

    app.get(
      '/me/adoptions',
      { schema: { tags, response: { 200: adoptionList } } },
      async (req) => ({ items: await services.adoptions.listMine(requireUser(req)) }),
    );
  };
