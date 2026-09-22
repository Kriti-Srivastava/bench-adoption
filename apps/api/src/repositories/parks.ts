import { asc, eq } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { benches, parks } from '../db/schema.ts';

export type ParkRow = typeof parks.$inferSelect;

export async function findParkBySlug(db: Executor, slug: string): Promise<ParkRow | undefined> {
  const [row] = await db.select().from(parks).where(eq(parks.slug, slug));
  return row;
}

export async function listParks(db: Executor): Promise<ParkRow[]> {
  return db.select().from(parks).orderBy(asc(parks.name));
}

export async function listZones(db: Executor, parkId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ zone: benches.zone })
    .from(benches)
    .where(eq(benches.parkId, parkId))
    .orderBy(asc(benches.zone));
  return rows.map((r) => r.zone);
}

export async function upsertPark(
  db: Executor,
  values: { slug: string; name: string; timezone: string },
): Promise<ParkRow> {
  const [row] = await db
    .insert(parks)
    .values(values)
    .onConflictDoUpdate({ target: parks.slug, set: { name: values.name, timezone: values.timezone } })
    .returning();
  return row!;
}
