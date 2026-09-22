import { buildApp } from './app.ts';
import { systemClock } from './clock.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { createMailer } from './email/mailer.ts';

// Refuses to start with an unsafe production configuration (see config.ts).
const config = loadConfig();
const { db, close } = createDb(config.databaseUrl, { max: config.dbPoolMax });
const { app } = await buildApp(
  { db, config, clock: systemClock, mailer: createMailer(config.mail) },
  { logger: { level: 'info' } },
);

app.addHook('onClose', close);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close());
}

await app.listen({ port: config.port, host: '0.0.0.0' });
