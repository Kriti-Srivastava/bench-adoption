import { addDays, daysBetween, todayIn } from '@bench/shared';
import { renewalReminderEmail } from '../email/templates.ts';
import * as adoptionRepo from '../repositories/adoptions.ts';
import * as parkRepo from '../repositories/parks.ts';
import type { AppContext } from './context.ts';

/**
 * The reminder due for an adoption with `daysLeft` days to go: the tightest
 * threshold it has reached. An adoption with 20 days left gets the 30-day
 * reminder (not the 60-day one it missed), then the 7-day one later.
 */
export function dueThreshold(daysLeft: number, thresholds: readonly number[]): number | undefined {
  return [...thresholds].sort((a, b) => a - b).find((t) => daysLeft <= t);
}

export function createReminderService(ctx: AppContext) {
  const { db, config } = ctx;
  const furthest = Math.max(...config.reminderDaysBefore);

  return {
    /**
     * Emails every adopter whose adoption is nearing its end and hasn't been
     * renewed. Safe to run repeatedly (each reminder is recorded once).
     * Returns the number of emails sent.
     */
    async sendDueReminders(): Promise<number> {
      let sent = 0;
      for (const park of await parkRepo.listParks(db)) {
        const today = todayIn(park.timezone, ctx.clock.now());
        const ending = await adoptionRepo.listAdoptionViewsForPark(db, {
          parkId: park.id,
          today,
          includeEnded: false,
          endingOnOrBefore: addDays(today, furthest),
          onlyUnrenewed: true,
          // A retired bench can't be renewed, so don't ask.
          onlyActiveBenches: true,
        });

        for (const view of ending) {
          const a = view.adoption;
          const daysLeft = daysBetween(today, a.endDate);
          const threshold = dueThreshold(daysLeft, config.reminderDaysBefore);
          if (threshold === undefined) continue;
          if (!(await adoptionRepo.claimReminder(db, a.id, threshold))) continue;

          try {
            await ctx.mailer.send(
              renewalReminderEmail(view.adopterEmail, {
                benchCode: view.benchCode,
                benchName: view.benchName,
                startDate: a.startDate,
                endDate: a.endDate,
                daysLeft,
                manageUrl: `${config.webUrl}/me/benches?renew=${a.id}`,
              }),
            );
            sent++;
          } catch (err) {
            // Release the claim so the next run retries this reminder.
            await adoptionRepo.releaseReminder(db, a.id, threshold);
            ctx.log.error({ err, adoptionId: a.id }, 'reminder email failed');
          }
        }
      }
      return sent;
    },
  };
}
