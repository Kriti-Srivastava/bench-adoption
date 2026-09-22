/**
 * The email sender. Runs continuously alongside the API (`npm run worker`),
 * polling the outbox. Several may run at once: claims use SKIP LOCKED.
 * Stops cleanly on SIGINT/SIGTERM, finishing the message in flight.
 */
import { systemClock } from '../clock.ts';
import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { createMailer } from '../email/mailer.ts';
import { createOutboxService } from '../services/outbox.ts';

const POLL_MS = 2000;

const config = loadConfig();
const { db, close } = createDb(config.databaseUrl, { max: 2 });
const outbox = createOutboxService({
  db,
  config,
  clock: systemClock,
  mailer: createMailer(config.mail),
  log: { error: (obj, msg) => console.error(msg ?? 'error', obj) },
});

let running = true;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    running = false;
  });
}

console.log('Outbox worker started.');
while (running) {
  try {
    const { sent, retrying, failed } = await outbox.dispatch();
    if (sent || retrying || failed) console.log(`sent ${sent}, retrying ${retrying}, gave up on ${failed}`);
    if (sent === 0) await new Promise((r) => setTimeout(r, POLL_MS));
  } catch (err) {
    console.error('worker loop error', err);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

await close();
console.log('Outbox worker stopped.');
