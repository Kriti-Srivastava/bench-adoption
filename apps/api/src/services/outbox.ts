/**
 * Sends the queued emails. Each message is claimed, sent and marked in its
 * own transaction, so a worker that dies mid-send leaves the message for the
 * next run rather than losing it. Failures back off; messages that keep
 * failing are parked as `failed` for a person to look at.
 */
import * as eventRepo from '../repositories/events.ts';
import type { AppContext } from './context.ts';

/** Wait before the next attempt: ~1, 4, 9, 16, 25 minutes. */
const backoffMs = (attempts: number) => attempts ** 2 * 60_000;
const MAX_ATTEMPTS = 5;
const KEEP_SENT_DAYS = 30;

export function createOutboxService(ctx: AppContext) {
  const { db } = ctx;

  return {
    /** Sends up to `limit` due messages. Returns what happened, for logging. */
    async dispatch(limit = 20): Promise<{ sent: number; retrying: number; failed: number }> {
      const result = { sent: 0, retrying: 0, failed: 0 };
      for (let i = 0; i < limit; i++) {
        const done = await db.transaction(async (tx) => {
          const [message] = await eventRepo.claimDueEmails(tx, ctx.clock.now(), 1);
          if (!message) return true;
          try {
            await ctx.mailer.send({ to: message.recipient, subject: message.subject, text: message.body });
            await eventRepo.markSent(tx, message.id, ctx.clock.now());
            result.sent++;
          } catch (err) {
            const attempts = message.attempts + 1;
            const giveUp = attempts >= MAX_ATTEMPTS;
            await eventRepo.markAttemptFailed(tx, message.id, {
              error: err instanceof Error ? err.message : String(err),
              nextAttemptAt: giveUp ? null : new Date(ctx.clock.now().getTime() + backoffMs(attempts)),
            });
            if (giveUp) {
              result.failed++;
              ctx.log.error({ err, to: message.recipient, subject: message.subject }, 'email given up on');
            } else {
              result.retrying++;
            }
          }
          return false;
        });
        if (done) break;
      }
      return result;
    },

    /** Queue health, for the daily job's log and the admin dashboard. */
    counts: () => eventRepo.countByStatus(db),

    purgeSent: () =>
      eventRepo.purgeSentEmails(db, new Date(ctx.clock.now().getTime() - KEEP_SENT_DAYS * 86_400_000)),
  };
}

export type OutboxService = ReturnType<typeof createOutboxService>;
