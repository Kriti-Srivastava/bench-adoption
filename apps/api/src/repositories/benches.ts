import { and, asc, eq, gt, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { addDays, ENDING_SOON_DAYS, type BenchAvailability, type IsoDate } from '@bench/shared';
import { likeContains, type Executor } from '../db/client.ts';
import { adoptions, areas, benchTrails, benches, parks, trails } from '../db/schema.ts';
import { isRenewed } from './adoptions.ts';
import { lastDoneOn, openTaskCount } from './maintenance.ts';
import { trailSlugsOf } from './parks.ts';

export type BenchRow = typeof benches.$inferSelect;
export type NewBench = typeof benches.$inferInsert;
export type AdoptionRow = typeof adoptions.$inferSelect;

export interface BenchWithCurrentAdoption {
  bench: BenchRow;
  current: AdoptionRow | null;
  availability: BenchAvailability;
  areaName: string;
  trailSlugs: string[];
}

/** Joins the (at most one, by constraint) active adoption covering `today`. */
function currentAdoptionJoin(today: IsoDate) {
  return and(
    eq(adoptions.benchId, benches.id),
    eq(adoptions.status, 'active'),
    lte(adoptions.startDate, today),
    gt(adoptions.endDate, today),
  );
}

/**
 * The single definition of a bench's availability, used both to report it
 * and to filter by it, so the two can never disagree.
 */
function availabilitySql(today: IsoDate) {
  const soon = addDays(today, ENDING_SOON_DAYS);
  return sql<BenchAvailability>`case
    when ${benches.status} = 'retired' then 'retired'
    when ${adoptions.id} is null then 'available'
    when ${adoptions.endDate} <= ${soon}::date and not ${isRenewed} then 'ending_soon'
    else 'adopted'
  end`;
}

const benchFields = (today: IsoDate) => ({
  bench: benches,
  current: adoptions,
  availability: availabilitySql(today),
  areaName: areas.name,
  trailSlugs: trailSlugsOf(benches.id),
});

function selectBenches(db: Executor, today: IsoDate) {
  return db
    .select(benchFields(today))
    .from(benches)
    .innerJoin(areas, eq(areas.id, benches.areaId))
    .leftJoin(adoptions, currentAdoptionJoin(today));
}

export interface ListBenchesFilter {
  parkId: string;
  today: IsoDate;
  availability?: BenchAvailability;
  /** Area name. */
  zone?: string;
  /** Trail slug. */
  trail?: string;
  q?: string;
  /** Code of the last bench on the previous page. */
  afterCode?: string;
  limit: number;
}

export async function listBenches(
  db: Executor,
  f: ListBenchesFilter,
): Promise<BenchWithCurrentAdoption[]> {
  return selectBenches(db, f.today)
    .where(
      and(
        eq(benches.parkId, f.parkId),
        f.availability ? sql`${availabilitySql(f.today)} = ${f.availability}` : undefined,
        f.zone ? eq(areas.name, f.zone) : undefined,
        f.trail
          ? sql`exists (select 1 from ${benchTrails} bt join ${trails} t on t.id = bt.trail_id
                        where bt.bench_id = ${benches.id} and t.slug = ${f.trail})`
          : undefined,
        f.q ? or(ilike(benches.code, likeContains(f.q)), ilike(benches.name, likeContains(f.q))) : undefined,
        f.afterCode ? gt(benches.code, f.afterCode) : undefined,
      ),
    )
    .orderBy(asc(benches.code))
    .limit(f.limit);
}

export async function findBench(
  db: Executor,
  where: { id: string } | { parkId: string; code: string },
  today: IsoDate,
): Promise<BenchWithCurrentAdoption | undefined> {
  const [row] = await selectBenches(db, today).where(
    'id' in where
      ? eq(benches.id, where.id)
      : and(eq(benches.parkId, where.parkId), eq(benches.code, where.code)),
  );
  return row;
}

/**
 * A bench with the park rules that govern it: the timezone that defines
 * "today" there, and the adoption terms the park offers.
 */
export async function findBenchWithParkRules(
  db: Executor,
  benchId: string,
): Promise<{ bench: BenchRow; timezone: string; adoptionTermsMonths: number[] } | undefined> {
  const [row] = await db
    .select({ bench: benches, timezone: parks.timezone, adoptionTermsMonths: parks.adoptionTermsMonths })
    .from(benches)
    .innerJoin(parks, eq(parks.id, benches.parkId))
    .where(eq(benches.id, benchId));
  return row;
}

/** Active adoptions that haven't ended by `from`, earliest first. */
export async function listUpcomingAdoptions(
  db: Executor,
  benchId: string,
  from: IsoDate,
): Promise<AdoptionRow[]> {
  return db
    .select()
    .from(adoptions)
    .where(
      and(
        eq(adoptions.benchId, benchId),
        eq(adoptions.status, 'active'),
        gt(adoptions.endDate, from),
      ),
    )
    .orderBy(asc(adoptions.startDate));
}

export async function findBenchIdByCode(db: Executor, parkId: string, code: string): Promise<string | undefined> {
  const [row] = await db
    .select({ id: benches.id })
    .from(benches)
    .where(and(eq(benches.parkId, parkId), eq(benches.code, code)));
  return row?.id;
}

/** Locks bench rows for the rest of the transaction (SELECT ... FOR UPDATE), in id order. */
export async function lockBenches(db: Executor, ids: string[]): Promise<BenchRow[]> {
  return db.select().from(benches).where(inArray(benches.id, ids)).orderBy(asc(benches.id)).for('update');
}

export async function insertBench(db: Executor, values: NewBench): Promise<BenchRow> {
  const [row] = await db.insert(benches).values(values).returning();
  return row!;
}

export async function updateBench(
  db: Executor,
  id: string,
  values: Partial<NewBench>,
): Promise<BenchRow | undefined> {
  const [row] = await db.update(benches).set(values).where(eq(benches.id, id)).returning();
  return row;
}

/** Inserts benches, updating any whose plaque code already exists in the park. */
export async function upsertBenches(
  db: Executor,
  parkId: string,
  rows: Omit<NewBench, 'parkId'>[],
): Promise<{ created: number; updated: number; ids: Map<string, string> }> {
  if (rows.length === 0) return { created: 0, updated: 0, ids: new Map() };
  const existing = await db
    .select({ code: benches.code })
    .from(benches)
    .where(and(eq(benches.parkId, parkId), inArray(benches.code, rows.map((r) => r.code))));

  const saved = await db
    .insert(benches)
    .values(rows.map((r) => ({ ...r, parkId })))
    .onConflictDoUpdate({
      target: [benches.parkId, benches.code],
      set: {
        name: sql`excluded.name`,
        areaId: sql`excluded.area_id`,
        description: sql`excluded.description`,
        lat: sql`excluded.lat`,
        lng: sql`excluded.lng`,
      },
    })
    .returning({ id: benches.id, code: benches.code });

  return {
    created: rows.length - existing.length,
    updated: existing.length,
    ids: new Map(saved.map((r) => [r.code, r.id])),
  };
}

export interface AdminBenchRow extends BenchWithCurrentAdoption {
  openTasks: number;
  lastInspectedOn: string | null;
  lastMaintainedOn: string | null;
}

/** Every bench in a park (retired included) with its upkeep status, for staff. */
export async function listAdminBenches(
  db: Executor,
  f: { parkId: string; today: IsoDate; timezone: string },
): Promise<AdminBenchRow[]> {
  return db
    .select({
      ...benchFields(f.today),
      openTasks: openTaskCount(benches.id),
      lastInspectedOn: lastDoneOn(benches.id, f.timezone, 'inspection'),
      lastMaintainedOn: lastDoneOn(benches.id, f.timezone),
    })
    .from(benches)
    .innerJoin(areas, eq(areas.id, benches.areaId))
    .leftJoin(adoptions, currentAdoptionJoin(f.today))
    .where(eq(benches.parkId, f.parkId))
    .orderBy(asc(benches.code));
}

/**
 * Moves a bench's current and upcoming adoptions to another bench, keeping
 * the donor's end date. Returns their ids.
 *
 * The move starts today: the new bench was someone else's (or nobody's)
 * before that, so claiming an earlier start would misread its record, and
 * would overlap any adoption it had in that period.
 */
export async function moveAdoptions(
  db: Executor,
  f: { fromBenchId: string; toBenchId: string; today: IsoDate },
): Promise<string[]> {
  const rows = await db
    .update(adoptions)
    .set({ benchId: f.toBenchId, startDate: sql`greatest(${adoptions.startDate}, ${f.today}::date)` })
    .where(
      and(
        eq(adoptions.benchId, f.fromBenchId),
        eq(adoptions.status, 'active'),
        gt(adoptions.endDate, f.today),
      ),
    )
    .returning({ id: adoptions.id });
  return rows.map((r) => r.id);
}
