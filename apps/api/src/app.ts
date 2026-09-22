import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import etag from '@fastify/etag';
import rateLimit from '@fastify/rate-limit';
import { Redis } from 'ioredis';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import type { ErrorResponse } from '@bench/shared';
import { registerSessionAuth } from './auth/session.ts';
import { fastSerializerCompiler } from './serializer.ts';
import { AppError } from './errors.ts';
import { adoptionRoutes } from './routes/adoptions.ts';
import { authRoutes } from './routes/auth.ts';
import { publicRoutes } from './routes/public.ts';
import { reportRoutes } from './routes/reports.ts';
import { staffRoutes } from './routes/staff.ts';
import type { AppContext } from './services/context.ts';
import { createServices } from './services/index.ts';

const errorBody = (code: string, message: string): ErrorResponse => ({ error: { code, message } });

export async function buildApp(
  deps: Omit<AppContext, 'log'>,
  opts: { logger?: FastifyServerOptions['logger'] } = {},
) {
  const app = Fastify({
    logger: opts.logger ?? false,
    // Behind a load balancer, read the client's address from X-Forwarded-For.
    trustProxy: (_address: string, hop: number) => hop < deps.config.trustProxyHops,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(fastSerializerCompiler);

  const ctx: AppContext = { ...deps, log: app.log };
  const services = createServices(ctx);

  await app.register(cookie);
  // Gzip/brotli: the map's bench list is ~130 KB of JSON and compresses ~10x.
  await app.register(compress, { threshold: 1024 });
  // Weak ETags let browsers and CDNs revalidate with a 304 instead of re-downloading.
  await app.register(etag, { weak: true });
  // In-memory limits are per instance; with REDIS_URL all instances share one count.
  const redis = deps.config.redisUrl
    ? new Redis(deps.config.redisUrl, { connectTimeout: 500, maxRetriesPerRequest: 1 })
    : undefined;
  if (redis) app.addHook('onClose', async () => void (await redis.quit()));
  await app.register(rateLimit, {
    global: false,
    redis,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      code: 'rate_limited',
      message: `Too many requests. Try again in ${context.after}.`,
    }),
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Bench Adoption API',
        version: '1.0.0',
        description: 'Browse park benches and adopt them.',
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  registerSessionAuth(app, services.auth);

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      const detail = err.validation
        .map((v) => `${v.instancePath.replace(/^\//, '') || 'request'}: ${v.message}`)
        .join('; ');
      return reply.code(400).send(errorBody('validation_error', detail));
    }
    if (err instanceof AppError) {
      return reply.code(err.status).send(errorBody(err.code, err.message));
    }
    // Framework-level client errors: malformed JSON, wrong content type, rate limits...
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send(errorBody(err.code ?? 'bad_request', err.message));
    }
    req.log.error(err);
    return reply.code(500).send(errorBody('internal', 'Something went wrong.'));
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send(errorBody('not_found', 'No such endpoint.')),
  );

  app.get('/api/health', async () => {
    await deps.db.execute(sql`select 1`);
    return { ok: true };
  });

  await app.register(
    async (v1) => {
      await v1.register(publicRoutes(services));
      await v1.register(authRoutes(services, deps.config));
      await v1.register(adoptionRoutes(services));
      await v1.register(reportRoutes(services));
      await v1.register(staffRoutes(services));
    },
    { prefix: '/api/v1' },
  );

  return { app, services };
}
