import type { Clock } from '../clock.ts';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import type { Mailer } from '../email/mailer.ts';

/** Everything a service depends on; injected so tests can substitute parts. */
export interface AppContext {
  db: Db;
  mailer: Mailer;
  clock: Clock;
  config: Config;
  log: { error(obj: unknown, msg?: string): void };
}
