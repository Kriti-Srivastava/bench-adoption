import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgres://bench:bench@localhost:5442/bench'),
  WEB_URL: z.string().default('http://localhost:5173'),
  PORT: z.coerce.number().int().default(3000),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  MAIL_FROM: z.string().default('Bench Adoption <benches@example.org>'),
  COOKIE_SECURE: z.stringbool().default(false),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(5),
  /** Shared store for per-IP rate limits when running several API instances. */
  REDIS_URL: z.string().optional(),
  /** Trust X-Forwarded-For from this many proxy hops (e.g. 1 behind a load balancer). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
});

export interface Config {
  databaseUrl: string;
  webUrl: string;
  port: number;
  smtp: { host: string; port: number; from: string };
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = envSchema.parse(env);
  return {
    databaseUrl: e.DATABASE_URL,
    webUrl: e.WEB_URL.replace(/\/$/, ''),
    port: e.PORT,
    smtp: { host: e.SMTP_HOST, port: e.SMTP_PORT, from: e.MAIL_FROM },
    cookieSecure: e.COOKIE_SECURE,
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
