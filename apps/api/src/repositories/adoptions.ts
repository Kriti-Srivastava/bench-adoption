import { and, asc, eq, gt, lte, not, sql } from 'drizzle-orm';
import type { IsoDate } from '@bench/shared';
import type { Executor } from '../db/client.ts';
import { adoptions, benches, parks, remindersSent, users } from '../db/schema.ts';

export type AdoptionRow = typeof adoptions.$inferSelect;
export type NewAdoption = typeof adoptions.$inferInsert;

/** True when an active adoption continues this one. */
export const isRenewed = sql<boolean>`exists (
  select 1 from adoptions r
  where r.renewed_from_id = ${adoptions.id} and r.status = 'active'
)`;

/** An adoption with the bench and adopter details every view needs. */
const adoptionView = {
  adoption: adoptions,
  benchCode: benches.code,
  benchName: benches.name,
  benchStatus: benches.status,
  parkId: benches.parkId,
  parkSlug: parks.slug,
  parkTimezone: parks.timezone,
  adopterEmail: users.email,
  adopterName: users.fullName,
  isRenewed: isRenewed.as('is_renewed'),
};

export type AdoptionView = {
  adoption: AdoptionRow;
  benchCode: string;
  benchName: string;
  benchStatus: 'active' | 'retired';
  parkId: string;
  parkSlug: string;
  parkTimezone: string;
  adopterEmail: string;
  adopterName: string | null;
  isRenewed: boolean;
};

function selectAdoptionViews(db: Executor) {
  return db
    .select(adoptionView)
    .from(adoptions)
    .innerJoin(benches, eq(benches.id, adoptions.benchId))
    .innerJoin(parks, eq(parks.id, benches.parkId))
    .innerJoin(users, eq(users.id, adoptions.adopterId));
}

export async function insertAdoption(db: Executor, values: NewAdoption): Promise<AdoptionRow> {
  const [row] = await db.insert(adoptions).values(values).returning();
  return row!;
}

export async function findAdoptionView(
  db: Executor,
  id: string,
): Promise<AdoptionView | undefined> {
  const [row] = await selectAdoptionViews(db).where(eq(adoptions.id, id));
  return row;
}

export async function listAdoptionViewsByAdopter(
  db: Executor,
  adopterId: string,
): Promise<AdoptionView[]> {
  return selectAdoptionViews(db)
    .where(eq(adoptions.adopterId, adopterId))
    .orderBy(asc(adoptions.endDate));
}

/**
 * How many benches this person still holds, each judged by today's date in
 * its own park, so the answer is right across parks in different timezones.
 */
export async function countRunningAdoptions(db: Executor, adopterId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(adoptions)
    .innerJoin(benches, eq(benches.id, adoptions.benchId))
    .innerJoin(parks, eq(parks.id, benches.parkId))
    .where(
      and(
        eq(adoptions.adopterId, adopterId),
        eq(adoptions.status, 'active'),
        sql`${adoptions.endDate} > (${now.toISOString()}::timestamptz at time zone ${parks.timezone})::date`,
      ),
    );
  return row?.count ?? 0;
}

export interface ParkAdoptionsFilter {
  parkId: string;
  today: IsoDate;
  includeEnded: boolean;
  endingOnOrBefore?: IsoDate;
  /** Skip adoptions that already have a renewal lined up. */
  onlyUnrenewed?: boolean;
  /** Skip benches that have been retired from the program. */
  onlyActiveBenches?: boolean;
}

/** Active adoptions in a park, soonest-ending first. */
export async function listAdoptionViewsForPark(
  db: Executor,
  f: ParkAdoptionsFilter,
): Promise<AdoptionView[]> {
  return selectAdoptionViews(db)
    .where(
      and(
        eq(benches.parkId, f.parkId),
        eq(adoptions.status, 'active'),
        f.includeEnded ? undefined : gt(adoptions.endDate, f.today),
        f.endingOnOrBefore ? lte(adoptions.endDate, f.endingOnOrBefore) : undefined,
        f.onlyUnrenewed ? not(isRenewed) : undefined,
        f.onlyActiveBenches ? eq(benches.status, 'active') : undefined,
      ),
    )
    .orderBy(asc(adoptions.endDate), asc(benches.code));
}

/**
 * Cancels an adoption together with any renewals that follow it, so a
 * cancelled adoption never leaves a future renewal holding the bench.
 * Returns the ids cancelled (empty if the adoption doesn't exist).
 */
export async function cancelAdoptionChain(db: Executor, id: string): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    with recursive chain as (
      select id from adoptions where id = ${id}
      union all
      select a.id from adoptions a join chain c on a.renewed_from_id = c.id
    )
    update adoptions set status = 'cancelled'
    where id in (select id from chain)
    returning id
  `);
  return result.rows.map((r) => r.id);
}

/**
 * Records that a reminder is being sent. Returns false if it was already
 * recorded, which makes the reminder job safe to run more than once.
 */
export async function claimReminder(
  db: Executor,
  adoptionId: string,
  daysBefore: number,
): Promise<boolean> {
  const rows = await db
    .insert(remindersSent)
    .values({ adoptionId, daysBefore })
    .onConflictDoNothing()
    .returning();
  return rows.length > 0;
}

export async function releaseReminder(
  db: Executor,
  adoptionId: string,
  daysBefore: number,
): Promise<void> {
  await db
    .delete(remindersSent)
    .where(and(eq(remindersSent.adoptionId, adoptionId), eq(remindersSent.daysBefore, daysBefore)));
}
