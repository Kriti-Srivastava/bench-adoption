import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  adminAdoptionList,
  adminBenchList,
  adminSummary,
  adminUserList,
  adminUsersQuery,
  createTaskInput,
  maintenanceQuery,
  maintenanceTask,
  maintenanceTaskList,
  retireBenchInput,
  updateTaskInput,
  adminAdoptionsQuery,
  adoption,
  benchSummary,
  createBenchInput,
  id,
  importBenchesInput,
  importBenchesResult,
  me,
  setRoleInput,
  updateBenchInput,
} from '@bench/shared';
import { requireRole, requireUser } from '../auth/session.ts';
import { toMe } from '../services/auth.ts';
import type { Services } from '../services/index.ts';

/** Park staff tools. Everything here requires the staff role or higher. */
export const staffRoutes =
  (services: Services): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('preHandler', requireRole('staff'));
    const tags = ['staff'];
    const parkParams = z.object({ slug: z.string() });

    app.post(
      '/parks/:slug/benches',
      { schema: { tags, params: parkParams, body: createBenchInput, response: { 201: benchSummary } } },
      async (req, reply) => {
        const bench = await services.benches.createBench(req.params.slug, req.body);
        return reply.code(201).send(bench);
      },
    );

    app.patch(
      '/benches/:id',
      {
        schema: { tags, params: z.object({ id }), body: updateBenchInput, response: { 200: benchSummary } },
      },
      async (req) => services.benches.updateBench(req.params.id, req.body),
    );

    app.post(
      '/parks/:slug/benches/import',
      {
        schema: { tags, params: parkParams, body: importBenchesInput, response: { 200: importBenchesResult } },
      },
      async (req) => services.benches.importCsv(req.params.slug, req.body.csv),
    );

    app.get(
      '/parks/:slug/adoptions',
      {
        schema: { tags, params: parkParams, querystring: adminAdoptionsQuery, response: { 200: adminAdoptionList } },
      },
      async (req) => ({ items: await services.adoptions.listForPark(req.params.slug, req.query) }),
    );

    app.get(
      '/parks/:slug/adoptions.csv',
      { schema: { tags, params: parkParams, querystring: adminAdoptionsQuery } },
      async (req, reply) => {
        const items = await services.adoptions.listForPark(req.params.slug, req.query);
        return reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${req.params.slug}-adoptions.csv"`)
          .send(services.adoptions.toCsv(items));
      },
    );

    app.post(
      '/adoptions/:id/cancel',
      { schema: { tags, params: z.object({ id }), response: { 200: adoption } } },
      async (req) => services.adoptions.cancel(req.params.id),
    );

    app.put(
      '/users/role',
      {
        preHandler: requireRole('admin'),
        schema: { tags, body: setRoleInput, response: { 200: me } },
      },
      async (req) => toMe(await services.auth.setRole(req.body.email, req.body.role, requireUser(req))),
    );

    // ------------------------------------------------------------ admin overview

    app.get(
      '/parks/:slug/admin/summary',
      { schema: { tags, params: parkParams, response: { 200: adminSummary } } },
      async (req) => services.admin.summary(req.params.slug),
    );

    app.get(
      '/parks/:slug/admin/benches',
      { schema: { tags, params: parkParams, response: { 200: adminBenchList } } },
      async (req) => ({ items: await services.admin.listBenches(req.params.slug) }),
    );

    app.get(
      '/admin/users',
      { schema: { tags, querystring: adminUsersQuery, response: { 200: adminUserList } } },
      async (req) => services.admin.listUsers(req.query),
    );

    // ------------------------------------------------------------ bench lifecycle

    const benchParams = z.object({ id });

    app.post(
      '/benches/:id/retire',
      { schema: { tags, params: benchParams, body: retireBenchInput, response: { 200: benchSummary } } },
      async (req) => services.admin.retire(requireUser(req), req.params.id, req.body),
    );

    app.post(
      '/benches/:id/restore',
      { schema: { tags, params: benchParams, response: { 200: benchSummary } } },
      async (req) => services.admin.restore(requireUser(req), req.params.id),
    );

    // ------------------------------------------------------------ maintenance

    app.get(
      '/parks/:slug/maintenance',
      { schema: { tags, params: parkParams, querystring: maintenanceQuery, response: { 200: maintenanceTaskList } } },
      async (req) => services.maintenance.listForPark(req.params.slug, req.query),
    );

    app.get(
      '/benches/:id/maintenance',
      { schema: { tags, params: benchParams, response: { 200: maintenanceTaskList } } },
      async (req) => services.maintenance.listForBench(req.params.id),
    );

    app.post(
      '/benches/:id/maintenance',
      { schema: { tags, params: benchParams, body: createTaskInput, response: { 201: maintenanceTask } } },
      async (req, reply) => {
        const task = await services.maintenance.create(requireUser(req), req.params.id, req.body);
        return reply.code(201).send(task);
      },
    );

    app.patch(
      '/maintenance/:id',
      { schema: { tags, params: z.object({ id }), body: updateTaskInput, response: { 200: maintenanceTask } } },
      async (req) => services.maintenance.update(req.params.id, req.body),
    );
  };
