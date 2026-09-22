// Run once a day (cron, a scheduled container, etc.). Safe to run more often.
import { runScript } from './run.ts';

await runScript(async (services) => {
  const queued = await services.reminders.enqueueDueReminders();
  console.log(`Queued ${queued} renewal reminder(s); the worker delivers them.`);

  const purged = await services.auth.purgeExpired();
  console.log(`Removed ${purged.tokens} old sign-in link(s) and ${purged.sessions} expired session(s).`);
  console.log(`Removed ${await services.outbox.purgeSent()} sent email(s) from the outbox.`);

  const counts = await services.outbox.counts();
  if (counts.failed) console.error(`${counts.failed} email(s) could not be delivered and need attention.`);
  if (counts.pending) console.log(`${counts.pending} email(s) waiting to be sent.`);
});
