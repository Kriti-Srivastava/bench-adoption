/**
 * Loads Van Cortlandt Park with ~520 sample benches spread over the park's
 * main areas, plus a handful of demo adoptions (some ending soon, so renewal
 * reminders can be tried). Re-running is safe: benches are upserted by code
 * and demo adoptions are only added to a park that has none.
 *
 * Real bench data should be loaded with `npm run import-benches` instead.
 */
import { count, eq } from 'drizzle-orm';
import { addDays, addMonths, todayIn } from '@bench/shared';
import { adoptions, benches } from '../db/schema.ts';
import * as adoptionRepo from '../repositories/adoptions.ts';
import * as benchRepo from '../repositories/benches.ts';
import * as parkRepo from '../repositories/parks.ts';
import { findOrCreateUser, updateUser } from '../repositories/users.ts';
import { runScript } from './run.ts';

// Approximate centres of the park's areas, with how many benches each gets.
const ZONES = [
  { name: 'Parade Ground', lat: 40.8923, lng: -73.8893, count: 90 },
  { name: 'Van Cortlandt Lake', lat: 40.8977, lng: -73.8909, count: 80 },
  { name: 'Van Cortlandt House', lat: 40.8906, lng: -73.8957, count: 50 },
  { name: 'Golf Course Paths', lat: 40.8995, lng: -73.8838, count: 60 },
  { name: 'Northwest Forest', lat: 40.9048, lng: -73.8935, count: 70 },
  { name: 'Northeast Forest', lat: 40.9015, lng: -73.8768, count: 60 },
  { name: 'Croton Aqueduct Trail', lat: 40.9030, lng: -73.8862, count: 50 },
  { name: 'Southwest Fields', lat: 40.8885, lng: -73.8985, count: 60 },
];

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
  const park = await parkRepo.upsertPark(db, {
    slug: 'van-cortlandt',
    name: 'Van Cortlandt Park',
    timezone: 'America/New_York',
  });

  const random = mulberry32(1888); // the year the park opened
  let n = 0;
  const rows = ZONES.flatMap((zone) =>
    Array.from({ length: zone.count }, (_, i) => {
      n++;
      return {
        code: `VC-${String(n).padStart(3, '0')}`,
        name: `${zone.name} bench ${i + 1}`,
        zone: zone.name,
        description: null,
        lat: zone.lat + (random() - 0.5) * 0.004,
        lng: zone.lng + (random() - 0.5) * 0.005,
      };
    }),
  );
  const result = await db.transaction((tx) => benchRepo.upsertBenches(tx, park.id, rows));
  console.log(`Benches: ${result.created} created, ${result.updated} updated.`);

  const [{ existing } = { existing: 0 }] = await db
    .select({ existing: count() })
    .from(adoptions)
    .innerJoin(benches, eq(benches.id, adoptions.benchId))
    .where(eq(benches.parkId, park.id));
  if (existing > 0) {
    console.log('Park already has adoptions; skipping demo adoptions.');
    return;
  }

  const today = todayIn(park.timezone, clock.now());
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
    const endDate = addMonths(startDate, months);
    await adoptionRepo.insertAdoption(db, {
      benchId: bench.id,
      adopterId: donor.id,
      startDate,
      endDate,
      displayName: donor.display,
      dedication: adopted % 3 === 0 ? 'For everyone who loves this park.' : null,
      isAnonymous: adopted % 11 === 5,
    });
    adopted++;
  }
  console.log(`Demo adoptions: ${adopted} created (some already ended).`);
});
