import { addDays, daysBetween, todayIn } from '@bench/shared';
import * as adoptionRepo from '../repositories/adoptions.ts';
import * as parkRepo from '../repositories/parks.ts';
import type { AppContext } from './context.ts';
import { recordEvent } from './events.ts';

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
     * Queues a reminder for every adopter whose adoption is nearing its end
     * and hasn't been renewed. Claiming the reminder and queueing its email
     * happen in one transaction, so each is queued exactly once however
     * often this runs. The worker delivers them.
     */
    async enqueueDueReminders(): Promise<number> {
      let queued = 0;
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

          await db.transaction(async (tx) => {
            if (!(await adoptionRepo.claimReminder(tx, a.id, threshold))) return;
            await recordEvent(
              tx,
              ctx,
              {
                type: 'adoption.ending_soon',
                payload: {
                  email: view.adopterEmail,
                  benchCode: view.benchCode,
                  benchName: view.benchName,
                  startDate: a.startDate,
                  endDate: a.endDate,
                  daysLeft,
                  adoptionId: a.id,
                },
              },
              { benchId: a.benchId, adoptionId: a.id },
            );
            queued++;
          });
        }
      }
      return queued;
    },
  };
}
