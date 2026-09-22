import { z } from 'zod';

/**
 * Configuration from environment variables. Development defaults make local
 * setup effortless; in production the secure choice is the default and
 * unsafe combinations stop the API from starting (fail fast, loudly) rather
 * than letting it run insecurely.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().default('postgres://bench:bench@localhost:5442/bench'),
  // Validated as a URL: a typo (or a stray newline from pasting into a
  // dashboard) would otherwise end up inside every emailed link.
  WEB_URL: z.url().default('http://localhost:5173'),
  PORT: z.coerce.number().int().default(3000),
  /** 'smtp' for a mail server (or Mailpit in development), 'resend' for Resend's API. */
  MAIL_PROVIDER: z.enum(['smtp', 'resend']).default('smtp'),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  MAIL_FROM: z.string().default('Bench Adoption <benches@example.org>'),
  /** Defaults to true in production. */
  COOKIE_SECURE: z.stringbool().optional(),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(5),
  /** Shared store for per-IP rate limits when running several API instances. */
  REDIS_URL: z.string().optional(),
  /** Trust X-Forwarded-For from this many proxy hops (e.g. 1 behind a load balancer). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
  /**
   * Send queued email from the API as soon as it is queued, as well as from
   * the worker. Useful where a separate always-on worker isn't available
   * (most free hosting); set false when running `npm run worker`.
   */
  SEND_MAIL_FROM_API: z.stringbool().default(true),
  /** Bearer token that lets a scheduler trigger the daily job over HTTP. */
  JOBS_TOKEN: z.string().optional(),
});

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid production configuration:\n  - ${problems.join('\n  - ')}`);
  }
}

export interface Config {
  environment: 'development' | 'test' | 'production';
  databaseUrl: string;
  webUrl: string;
  port: number;
  mail:
    | { provider: 'smtp'; host: string; port: number; from: string }
    | { provider: 'resend'; apiKey: string; from: string };
  sendMailFromApi: boolean;
  jobsToken: string | undefined;
  cookieSecure: boolean;
  /** Sign-in requests allowed per IP address per minute (burst protection). */
  authRateLimitPerMinute: number;
  /** Per-address limits on sign-in emails, shared by all instances via the database. */
  magicLinkPerEmail: { minIntervalSeconds: number; maxPerHour: number };
  redisUrl: string | undefined;
  trustProxyHops: number;
  dbPoolMax: number;
  magicLinkTtlMinutes: number;
  sessionTtlDays: number;
  /** Days before an adoption ends that a renewal reminder is emailed. */
  reminderDaysBefore: readonly number[];
}

/**
 * Trims every value and drops empty ones, so a stray space or newline copied
 * into a hosting dashboard can't reach the rest of the system, and a blank
 * value falls back to its default instead of overriding it.
 */
function clean(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env)
      .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
      .filter(([, value]) => value !== ''),
  );
}

/** Settings that have development defaults but must be chosen explicitly in production. */
const REQUIRED_IN_PRODUCTION = ['DATABASE_URL', 'WEB_URL', 'MAIL_FROM'] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = envSchema.parse(clean(env));
  const production = e.NODE_ENV === 'production';
  const cookieSecure = e.COOKIE_SECURE ?? production;

  if (production) {
    const problems: string[] = REQUIRED_IN_PRODUCTION.filter((key) => !env[key]).map(
      (key) => `${key} must be set`,
    );
    if (!e.WEB_URL.startsWith('https://')) problems.push('WEB_URL must use https://');
    if (e.MAIL_PROVIDER === 'resend' && !e.RESEND_API_KEY) {
      problems.push('RESEND_API_KEY must be set when MAIL_PROVIDER=resend');
    }
    if (!cookieSecure) problems.push('COOKIE_SECURE cannot be false: session cookies would travel over plain HTTP');
    if (problems.length > 0) throw new ConfigError(problems);
  }

  return {
    environment: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    webUrl: e.WEB_URL.replace(/\/$/, ''),
    port: e.PORT,
    mail:
      e.MAIL_PROVIDER === 'resend'
        ? { provider: 'resend', apiKey: e.RESEND_API_KEY ?? '', from: e.MAIL_FROM }
        : { provider: 'smtp', host: e.SMTP_HOST, port: e.SMTP_PORT, from: e.MAIL_FROM },
    sendMailFromApi: e.SEND_MAIL_FROM_API,
    jobsToken: e.JOBS_TOKEN,
    cookieSecure,
    authRateLimitPerMinute: e.AUTH_RATE_LIMIT_PER_MINUTE,
    // Common practice (Supabase, Auth0, Clerk): one email a minute, a handful an hour.
    magicLinkPerEmail: { minIntervalSeconds: 60, maxPerHour: 5 },
    redisUrl: e.REDIS_URL,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    dbPoolMax: e.DB_POOL_MAX,
    magicLinkTtlMinutes: 15,
    sessionTtlDays: 30,
    reminderDaysBefore: [60, 30, 7],
  };
}
