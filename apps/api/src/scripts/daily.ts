// Run once a day (cron, a scheduled container, etc.). Safe to run more often.
import { runScript } from './run.ts';

await runScript(async (services) => {
  const sent = await services.reminders.sendDueReminders();
  console.log(`Sent ${sent} renewal reminder(s).`);
  const purged = await services.auth.purgeExpired();
  console.log(`Removed ${purged.tokens} old sign-in link(s) and ${purged.sessions} expired session(s).`);
});
