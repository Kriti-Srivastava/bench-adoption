import { and, asc, eq, gt, ilike, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { IsoDate } from '@bench/shared';
import type { Executor } from '../db/client.ts';
import { adoptions, benches, parks } from '../db/schema.ts';

export type BenchRow = typeof benches.$inferSelect;
export type NewBench = typeof benches.$inferInsert;
export type AdoptionRow = typeof adoptions.$inferSelect;

export interface BenchWithCurrentAdoption {
  bench: BenchRow;
  current: AdoptionRow | null;
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

/** LIKE pattern matching `text` literally anywhere in the value. */
const contains = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

export interface ListBenchesFilter {
  parkId: string;
  today: IsoDate;
  availability?: 'available' | 'adopted';
  zone?: string;
  q?: string;
  /** Code of the last bench on the previous page. */
  afterCode?: string;
  limit: number;
}

export async function listBenches(
  db: Executor,
  f: ListBenchesFilter,
): Promise<BenchWithCurrentAdoption[]> {
  const rows = await db
    .select({ bench: benches, current: adoptions })
    .from(benches)
    .leftJoin(adoptions, currentAdoptionJoin(f.today))
    .where(
      and(
        eq(benches.parkId, f.parkId),
        eq(benches.status, 'active'),
        f.availability === 'available' ? isNull(adoptions.id) : undefined,
        f.availability === 'adopted' ? isNotNull(adoptions.id) : undefined,
        f.zone ? eq(benches.zone, f.zone) : undefined,
        f.q ? or(ilike(benches.code, contains(f.q)), ilike(benches.name, contains(f.q))) : undefined,
        f.afterCode ? gt(benches.code, f.afterCode) : undefined,
      ),
    )
    .orderBy(asc(benches.code))
    .limit(f.limit);
  return rows;
}

export async function findBench(
  db: Executor,
  where: { id: string } | { parkId: string; code: string },
  today: IsoDate,
): Promise<BenchWithCurrentAdoption | undefined> {
  const [row] = await db
    .select({ bench: benches, current: adoptions })
    .from(benches)
    .leftJoin(adoptions, currentAdoptionJoin(today))
    .where(
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
): Promise<{ created: number; updated: number }> {
  if (rows.length === 0) return { created: 0, updated: 0 };
  const existing = await db
    .select({ code: benches.code })
    .from(benches)
    .where(and(eq(benches.parkId, parkId), inArray(benches.code, rows.map((r) => r.code))));

  await db
    .insert(benches)
    .values(rows.map((r) => ({ ...r, parkId })))
    .onConflictDoUpdate({
      target: [benches.parkId, benches.code],
      set: {
        name: sql`excluded.name`,
        zone: sql`excluded.zone`,
        description: sql`excluded.description`,
        lat: sql`excluded.lat`,
        lng: sql`excluded.lng`,
      },
    });

  return { created: rows.length - existing.length, updated: existing.length };
}
