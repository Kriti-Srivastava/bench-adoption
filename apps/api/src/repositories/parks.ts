import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Executor } from '../db/client.ts';
import { areas, benchTrails, parks, trails } from '../db/schema.ts';

export type ParkRow = typeof parks.$inferSelect;
export type AreaRow = typeof areas.$inferSelect;
export type TrailRow = typeof trails.$inferSelect;

export async function findParkBySlug(db: Executor, slug: string): Promise<ParkRow | undefined> {
  const [row] = await db.select().from(parks).where(eq(parks.slug, slug));
  return row;
}

export async function findParkById(db: Executor, id: string): Promise<ParkRow | undefined> {
  const [row] = await db.select().from(parks).where(eq(parks.id, id));
  return row;
}

export async function listParks(db: Executor): Promise<ParkRow[]> {
  return db.select().from(parks).orderBy(asc(parks.name));
}

export async function upsertPark(
  db: Executor,
  values: { slug: string; name: string; timezone: string; adoptionTermsMonths?: number[] },
): Promise<ParkRow> {
  const { slug: _slug, ...changes } = values;
  const [row] = await db
    .insert(parks)
    .values(values)
    .onConflictDoUpdate({ target: parks.slug, set: changes })
    .returning();
  return row!;
}

// ---------------------------------------------------------------- areas

export async function listAreas(db: Executor, parkId: string): Promise<AreaRow[]> {
  return db.select().from(areas).where(eq(areas.parkId, parkId)).orderBy(asc(areas.name));
}

/** Area ids by name, creating any areas that don't exist yet. */
export async function ensureAreas(
  db: Executor,
  parkId: string,
  names: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(names)];
  if (unique.length === 0) return new Map();
  await db
    .insert(areas)
    .values(unique.map((name) => ({ parkId, name })))
    .onConflictDoNothing();
  const rows = await db
    .select({ id: areas.id, name: areas.name })
    .from(areas)
    .where(and(eq(areas.parkId, parkId), inArray(areas.name, unique)));
  return new Map(rows.map((r) => [r.name, r.id]));
}

export async function upsertArea(
  db: Executor,
  values: { parkId: string; name: string; description: string | null; facts: string[] },
): Promise<void> {
  await db
    .insert(areas)
    .values(values)
    .onConflictDoUpdate({
      target: [areas.parkId, areas.name],
      set: { description: values.description, facts: values.facts },
    });
}

// ---------------------------------------------------------------- trails

export async function listTrails(db: Executor, parkId: string): Promise<TrailRow[]> {
  return db.select().from(trails).where(eq(trails.parkId, parkId)).orderBy(asc(trails.name));
}

export async function upsertTrail(
  db: Executor,
  values: Omit<typeof trails.$inferInsert, 'id' | 'createdAt'>,
): Promise<TrailRow> {
  const { parkId: _parkId, slug: _slug, ...rest } = values;
  const [row] = await db
    .insert(trails)
    .values(values)
    .onConflictDoUpdate({ target: [trails.parkId, trails.slug], set: rest })
    .returning();
  return row!;
}

/** Trail ids by slug for the given park; unknown slugs are simply absent. */
export async function trailIdsBySlug(
  db: Executor,
  parkId: string,
  slugs: string[],
): Promise<Map<string, string>> {
  if (slugs.length === 0) return new Map();
  const rows = await db
    .select({ id: trails.id, slug: trails.slug })
    .from(trails)
    .where(and(eq(trails.parkId, parkId), inArray(trails.slug, slugs)));
  return new Map(rows.map((r) => [r.slug, r.id]));
}

/** Replaces the trail links of each given bench (all in one park). */
export async function setBenchTrails(
  db: Executor,
  parkId: string,
  links: { benchId: string; trailIds: string[] }[],
): Promise<void> {
  if (links.length === 0) return;
  await db.delete(benchTrails).where(
    inArray(
      benchTrails.benchId,
      links.map((l) => l.benchId),
    ),
  );
  const rows = links.flatMap((l) => l.trailIds.map((trailId) => ({ benchId: l.benchId, trailId, parkId })));
  if (rows.length > 0) await db.insert(benchTrails).values(rows);
}

/** Trail slugs per bench, as a correlated subquery for bench selects. */
export const trailSlugsOf = (benchId: AnyPgColumn) => sql<string[]>`coalesce((
  select array_agg(t.slug order by t.slug)
  from bench_trails bt join trails t on t.id = bt.trail_id
  where bt.bench_id = ${benchId}
), '{}')`;
