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
});

export interface Config {
  databaseUrl: string;
  webUrl: string;
  port: number;
  smtp: { host: string; port: number; from: string };
  cookieSecure: boolean;
  authRateLimitPerMinute: number;
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
    magicLinkTtlMinutes: 15,
    sessionTtlDays: 30,
    reminderDaysBefore: [60, 30, 7],
  };
}
