import { and, asc, eq, lt, lte, sql } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { events, outbox } from '../db/schema.ts';

export type EventRow = typeof events.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;

export async function insertEvent(db: Executor, values: typeof events.$inferInsert): Promise<EventRow> {
  const [row] = await db.insert(events).values(values).returning();
  return row!;
}

export async function enqueueEmails(
  db: Executor,
  rows: { eventId: string; recipient: string; subject: string; body: string; nextAttemptAt: Date }[],
): Promise<void> {
  if (rows.length > 0) await db.insert(outbox).values(rows);
}

/**
 * Takes up to `limit` messages that are due, marking them as this worker's
 * for the rest of the transaction. `SKIP LOCKED` means several workers can
 * run at once and never pick up the same message.
 */
export async function claimDueEmails(db: Executor, now: Date, limit: number): Promise<OutboxRow[]> {
  return db
    .select()
    .from(outbox)
    .where(and(eq(outbox.status, 'pending'), lte(outbox.nextAttemptAt, now)))
    .orderBy(asc(outbox.nextAttemptAt))
    .limit(limit)
    .for('update', { skipLocked: true });
}

export async function markSent(db: Executor, id: string, now: Date): Promise<void> {
  await db.update(outbox).set({ status: 'sent', sentAt: now, attempts: sql`${outbox.attempts} + 1` }).where(eq(outbox.id, id));
}

/** Schedules another attempt, or gives up and leaves the message for a human to see. */
export async function markAttemptFailed(
  db: Executor,
  id: string,
  opts: { error: string; nextAttemptAt: Date | null },
): Promise<void> {
  await db
    .update(outbox)
    .set({
      status: opts.nextAttemptAt ? 'pending' : 'failed',
      attempts: sql`${outbox.attempts} + 1`,
      lastError: opts.error.slice(0, 500),
      ...(opts.nextAttemptAt ? { nextAttemptAt: opts.nextAttemptAt } : {}),
    })
    .where(eq(outbox.id, id));
}

export async function countByStatus(db: Executor): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: outbox.status, count: sql<number>`count(*)::int` })
    .from(outbox)
    .groupBy(outbox.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}

/** Housekeeping: sent messages are kept briefly for support questions, then dropped. */
export async function purgeSentEmails(db: Executor, before: Date): Promise<number> {
  const rows = await db
    .delete(outbox)
    .where(and(eq(outbox.status, 'sent'), lt(outbox.sentAt, before)))
    .returning({ id: outbox.id });
  return rows.length;
}
