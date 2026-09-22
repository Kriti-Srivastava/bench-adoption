/**
 * Loads Van Cortlandt Park with its areas, trails and ~520 sample benches,
 * plus a handful of demo adoptions (some ending soon, so renewal reminders
 * can be tried). Re-running is safe: everything is upserted, and demo
 * adoptions are only added to a park that has none.
 *
 * Real bench data should be loaded with `npm run import-benches` instead.
 */
import { count, eq } from 'drizzle-orm';
import { addDays, addMonths, todayIn } from '@bench/shared';
import { adoptions, benches, maintenanceTasks } from '../db/schema.ts';
import * as adoptionRepo from '../repositories/adoptions.ts';
import * as benchRepo from '../repositories/benches.ts';
import * as taskRepo from '../repositories/maintenance.ts';
import * as parkRepo from '../repositories/parks.ts';
import { findOrCreateUser, updateUser } from '../repositories/users.ts';
import { distanceToPath, nearest, pointsAlong } from './geo.ts';
import { runScript } from './run.ts';
import { AREAS, TRAILS } from './seed-data.ts';

/** A bench this close to a trail's route counts as "along" it. */
const ON_TRAIL_METRES = 40;

const DEMO_DONORS = [
  { email: 'maria.gonzalez@example.org', name: 'Maria Gonzalez', display: 'The Gonzalez Family' },
  { email: 'james.oconnor@example.org', name: "James O'Connor", display: "In memory of Eileen O'Connor" },
  { email: 'riverdale.runners@example.org', name: 'Riverdale Runners Club', display: 'Riverdale Runners Club' },
  { email: 'aisha.bello@example.org', name: 'Aisha Bello', display: 'Aisha & Tunde' },
  { email: 'kenji.watanabe@example.org', name: 'Kenji Watanabe', display: 'Kenji Watanabe' },
];

/** Small deterministic PRNG so every seed produces the same park. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

await runScript(async (_services, { db, clock }) => {
  const random = mulberry32(1888); // the year the park opened
  const jitter = (spread: number) => (random() - 0.5) * spread;

  const park = await parkRepo.upsertPark(db, {
    slug: 'van-cortlandt',
    name: 'Van Cortlandt Park',
    timezone: 'America/New_York',
  });

  await db.transaction(async (tx) => {
    for (const a of AREAS) {
      await parkRepo.upsertArea(tx, {
        parkId: park.id,
        name: a.name,
        description: a.description,
        facts: a.facts,
      });
    }
    const trailIds = new Map<string, string>();
    for (const t of TRAILS) {
      const row = await parkRepo.upsertTrail(tx, {
        parkId: park.id,
        slug: t.slug,
        name: t.name,
        description: t.description,
        lengthMiles: t.lengthMiles,
        facts: t.facts,
        path: t.path,
      });
      trailIds.set(t.slug, row.id);
    }
    const areaIds = await parkRepo.ensureAreas(tx, park.id, AREAS.map((a) => a.name));

    // Benches scattered around each area, then benches spaced along each trail.
    const centres = AREAS.map((a) => a.center);
    const planned = [
      ...AREAS.flatMap((area) =>
        Array.from({ length: area.benches }, (_, i) => ({
          name: `${area.name} bench ${i + 1}`,
          area: area.name,
          lat: area.center[0] + jitter(0.004),
          lng: area.center[1] + jitter(0.005),
        })),
      ),
      ...TRAILS.flatMap((trail) =>
        pointsAlong(trail.path, trail.benches).map(([lat, lng], i) => ({
          name: `${trail.name} bench ${i + 1}`,
          area: AREAS[nearest([lat, lng], centres)]!.name,
          // A few metres off the path, as real benches are.
          lat: lat + jitter(0.0002),
          lng: lng + jitter(0.0002),
        })),
      ),
    ];

    const rows = planned.map((b, i) => ({
      code: `VC-${String(i + 1).padStart(3, '0')}`,
      name: b.name,
      areaId: areaIds.get(b.area)!,
      description: null,
      lat: b.lat,
      lng: b.lng,
    }));
    const result = await benchRepo.upsertBenches(tx, park.id, rows);
    console.log(`Benches: ${result.created} created, ${result.updated} updated.`);

    await parkRepo.setBenchTrails(
      tx,
      park.id,
      rows.map((r) => ({
        benchId: result.ids.get(r.code)!,
        trailIds: TRAILS.filter((t) => distanceToPath([r.lat, r.lng], t.path) <= ON_TRAIL_METRES).map(
          (t) => trailIds.get(t.slug)!,
        ),
      })),
    );
    console.log(`Areas: ${AREAS.length}. Trails: ${TRAILS.length}.`);
  });

  const today = todayIn(park.timezone, clock.now());
  await seedMaintenance(park.id, today);

  const [{ existing } = { existing: 0 }] = await db
    .select({ existing: count() })
    .from(adoptions)
    .innerJoin(benches, eq(benches.id, adoptions.benchId))
    .where(eq(benches.parkId, park.id));
  if (existing > 0) {
    console.log('Park already has adoptions; skipping demo adoptions.');
    return;
  }

  const parkBenches = await benchRepo.listBenches(db, { parkId: park.id, today, limit: 1000 });
  const donors = [];
  for (const d of DEMO_DONORS) {
    const user = await findOrCreateUser(db, d.email);
    await updateUser(db, user.id, { fullName: d.name });
    donors.push({ ...d, id: user.id });
  }

  // Adopt roughly every 7th bench, with start dates spread over the past two
  // years so some adoptions end soon and a few already ended.
  let adopted = 0;
  for (const [i, { bench }] of parkBenches.entries()) {
    if (i % 7 !== 0) continue;
    const donor = donors[adopted % donors.length]!;
    const months = [12, 24, 6, 36][adopted % 4]!;
    const startDate = addDays(today, -Math.floor(random() * 700));
    await adoptionRepo.insertAdoption(db, {
      benchId: bench.id,
      adopterId: donor.id,
      startDate,
      endDate: addMonths(startDate, months),
      displayName: donor.display,
      dedication: adopted % 3 === 0 ? 'For everyone who loves this park.' : null,
      isAnonymous: adopted % 11 === 5,
    });
    adopted++;
  }
  console.log(`Demo adoptions: ${adopted} created (some already ended).`);

  /**
   * A believable upkeep history: most benches inspected in the last year
   * (the annual survey), plus a few open jobs of each kind for the crew.
   */
  async function seedMaintenance(parkId: string, today: string) {
    const [{ tasks } = { tasks: 0 }] = await db
      .select({ tasks: count() })
      .from(maintenanceTasks)
      .innerJoin(benches, eq(benches.id, maintenanceTasks.benchId))
      .where(eq(benches.parkId, parkId));
    if (tasks > 0) return console.log('Park already has maintenance history; skipping.');

    const all = await benchRepo.listBenches(db, { parkId, today, limit: 1000 });
    const active = all.filter((b) => b.bench.status === 'active').map((b) => b.bench);
    let inspected = 0;
    for (const bench of active) {
      if (random() > 0.7) continue; // ~30% are due their survey
      const daysAgo = Math.floor(random() * 330);
      await taskRepo.insertTask(db, {
        benchId: bench.id,
        type: 'inspection',
        title: 'Annual bench survey',
        status: 'done',
        completedAt: new Date(`${addDays(today, -daysAgo)}T15:00:00Z`),
        resolution: random() > 0.85 ? 'Slats weathered; flagged for repainting.' : 'Good condition.',
      });
      inspected++;
    }

    const pick = () => active[Math.floor(random() * active.length)]!;
    const open: Omit<taskRepo.NewTask, 'benchId'>[] = [
      { type: 'repair', priority: 'urgent', title: 'Broken slat on seat', details: 'Reported by a runner; sharp edge.' },
      { type: 'repair', priority: 'urgent', title: 'Bench wobbles: loose anchor bolt' },
      { type: 'repair', title: 'Armrest cracked' },
      { type: 'graffiti', title: 'Graffiti on back rest' },
      { type: 'graffiti', priority: 'low', title: 'Marker tags on plaque side' },
      { type: 'cleaning', title: 'Bird droppings and sap' },
      { type: 'painting', status: 'scheduled', scheduledFor: addDays(today, 10), title: 'Repaint (volunteer day)' },
      { type: 'painting', status: 'scheduled', scheduledFor: addDays(today, 10), title: 'Repaint (volunteer day)' },
      { type: 'painting', status: 'scheduled', scheduledFor: addDays(today, 24), title: 'Repaint (volunteer day)' },
      { type: 'plaque', priority: 'normal', title: 'Plaque loose: re-fix screws' },
    ];
    for (const task of open) await taskRepo.insertTask(db, { ...task, benchId: pick().id });
    console.log(`Maintenance: ${inspected} past inspections, ${open.length} open jobs.`);
  }
});
