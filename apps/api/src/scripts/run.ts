import { systemClock } from '../clock.ts';
import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { createSmtpMailer } from '../email/mailer.ts';
import type { AppContext } from '../services/context.ts';
import { createServices, type Services } from '../services/index.ts';

/**
 * Runs a command-line task with the same services the API uses, so scripts
 * never duplicate business rules. Exits non-zero on failure.
 */
export async function runScript(task: (services: Services, ctx: AppContext) => Promise<void>) {
  const config = loadConfig();
  const { db, close } = createDb(config.databaseUrl, { max: 2 });
  const ctx: AppContext = {
    db,
    config,
    clock: systemClock,
    mailer: createSmtpMailer(config.smtp),
    log: { error: (obj, msg) => console.error(msg ?? 'error', obj) },
  };
  try {
    await task(createServices(ctx), ctx);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await close();
  }
}
