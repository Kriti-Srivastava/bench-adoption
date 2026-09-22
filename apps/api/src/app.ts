import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import etag from '@fastify/etag';
import rateLimit from '@fastify/rate-limit';
import { Redis } from 'ioredis';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyServerOptions } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { ErrorResponse } from '@bench/shared';
import { registerSessionAuth } from './auth/session.ts';
import { registerResponsePolicy } from './http/policy.ts';
import { fastSerializerCompiler } from './serializer.ts';
import { AppError } from './errors.ts';
import { adoptionRoutes } from './routes/adoptions.ts';
import { authRoutes } from './routes/auth.ts';
import { registerHealthRoutes } from './routes/health.ts';
import { publicRoutes } from './routes/public.ts';
import { reportRoutes } from './routes/reports.ts';
import { staffRoutes } from './routes/staff.ts';
import type { AppContext } from './services/context.ts';
import { createServices } from './services/index.ts';

const errorBody = (code: string, message: string): ErrorResponse => ({ error: { code, message } });

/**
 * A Redis client that fails fast instead of queueing commands while
 * disconnected, and logs outages once per transition rather than per retry.
 */
function connectRedis(url: string, log: FastifyBaseLogger): Redis {
  const redis = new Redis(url, { connectTimeout: 500, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  let down = false;
  redis.on('error', (err) => {
    if (!down) log.warn({ err }, 'Redis unavailable: per-IP rate limits paused');
    down = true;
  });
  redis.on('ready', () => {
    if (down) log.info('Redis reconnected: per-IP rate limits resumed');
    down = false;
  });
  return redis;
}

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
  const routePolicies = registerResponsePolicy(app);

  await app.register(cookie);
  // Gzip/brotli: the map's bench list is ~130 KB of JSON and compresses ~10x.
  await app.register(compress, { threshold: 1024 });
  // Weak ETags let browsers and CDNs revalidate with a 304 instead of re-downloading.
  await app.register(etag, { weak: true });
  // Per-IP limits are in memory per instance, or shared via Redis when configured.
  const redis = deps.config.redisUrl ? connectRedis(deps.config.redisUrl, app.log) : undefined;
  if (redis) app.addHook('onClose', async () => void redis.disconnect());
  await app.register(rateLimit, {
    global: false,
    redis,
    // Redis is a helper, not a dependency: if it's unreachable, skip the
    // per-IP limit rather than fail the request. Sign-in stays protected by
    // the per-address limit, which lives in Postgres.
    skipOnError: true,
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

  registerHealthRoutes(app, { db: deps.db, redis });

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

  return { app, services, routePolicies };
}
