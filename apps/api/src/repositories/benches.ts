import { and, asc, eq, gt, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { addDays, ENDING_SOON_DAYS, type BenchAvailability, type IsoDate } from '@bench/shared';
import type { Executor } from '../db/client.ts';
import { adoptions, areas, benchTrails, benches, parks, trails } from '../db/schema.ts';
import { isRenewed } from './adoptions.ts';
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

function selectBenches(db: Executor, today: IsoDate) {
  return db
    .select({
      bench: benches,
      current: adoptions,
      availability: availabilitySql(today),
      areaName: areas.name,
      trailSlugs: trailSlugsOf(benches.id),
    })
    .from(benches)
    .innerJoin(areas, eq(areas.id, benches.areaId))
    .leftJoin(adoptions, currentAdoptionJoin(today));
}

/** LIKE pattern matching `text` literally anywhere in the value. */
const contains = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

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
        f.q ? or(ilike(benches.code, contains(f.q)), ilike(benches.name, contains(f.q))) : undefined,
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

/** A bench together with its park's timezone, which defines "today" for it. */
export async function findBenchWithTimezone(
  db: Executor,
  benchId: string,
): Promise<{ bench: BenchRow; timezone: string } | undefined> {
  const [row] = await db
    .select({ bench: benches, timezone: parks.timezone })
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
