/**
 * A realistic, randomised workload: donors adopting and renewing, staff
 * cancelling, retiring (keep / end / relocate), restoring and closing tasks,
 * visitors reporting problems. All through the real HTTP API, fired in
 * concurrent waves so operations race each other.
 */
import { and, eq, gt } from 'drizzle-orm';
import { adoptions, benches, maintenanceTasks } from '../src/db/schema.ts';
import * as benchRepo from '../src/repositories/benches.ts';
import * as parkRepo from '../src/repositories/parks.ts';
import { PARK, resetData, signIn, type TestApp } from '../test/helpers.ts';
import type { Rng } from './monkey.ts';

export interface Actors {
  donors: { email: string; cookie: string }[];
  staff: string;
}

export interface Tally {
  byOp: Record<string, Record<number, number>>;
  serverErrors: { op: string; status: number; body: string }[];
  /** Requests that threw instead of returning a response (e.g. hung connections). */
  crashes: string[];
}

/** A test park with `benchCount` benches, `donorCount` signed-in donors and a staff member. */
export async function setUpPark(t: TestApp, benchCount: number, donorCount: number): Promise<Actors> {
  const { park } = await resetData(t);
  const areaIds = await parkRepo.ensureAreas(t.db, park.id, ['Lake']);
  for (let i = 4; i <= benchCount; i++) {
    await benchRepo.insertBench(t.db, {
      parkId: park.id,
      areaId: areaIds.get('Lake')!,
      code: `T-${String(i).padStart(3, '0')}`,
      name: `Chaos bench ${i}`,
      lat: 40.9,
      lng: -73.89,
    });
  }
  const donors = [];
  for (let i = 0; i < donorCount; i++) {
    const email = `donor${i}@example.org`;
    donors.push({ email, cookie: (await signIn(t, email)).cookie });
  }
  const staff = (await signIn(t, 'staff@example.org', 'admin')).cookie;
  return { donors, staff };
}

/** What the workload needs to know to pick sensible targets. */
async function snapshot(t: TestApp) {
  const today = '2026-09-21';
  const allBenches = await t.db.select().from(benches);
  const active = await t.db
    .select({ id: adoptions.id, benchId: adoptions.benchId, adopterId: adoptions.adopterId })
    .from(adoptions)
    .where(and(eq(adoptions.status, 'active'), gt(adoptions.endDate, today)));
  const openTasks = await t.db
    .select({ id: maintenanceTasks.id })
    .from(maintenanceTasks)
    .where(eq(maintenanceTasks.status, 'open'));
  return { allBenches, active, openTasks };
}

type Op = { name: string; run: () => Promise<{ statusCode: number; body: string }> };

/** Runs `waves` rounds of `perWave` random operations fired concurrently. */
export async function runWorkload(
  t: TestApp,
  actors: Actors,
  random: Rng,
  { waves, perWave }: { waves: number; perWave: number },
): Promise<Tally> {
  const tally: Tally = { byOp: {}, serverErrors: [], crashes: [] };
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, cookie: string, payload?: object) =>
    t.app.inject({ method, url: `/api/v1${url}`, headers: { cookie }, payload });

  for (let w = 0; w < waves; w++) {
    let state;
    try {
      state = await snapshot(t);
    } catch {
      continue; // the monkey may have killed this connection; try the next wave
    }
    const { allBenches, active, openTasks } = state;
    const donor = () => random.pick(actors.donors);
    const anyBench = () => random.pick(allBenches);

    const makers: (() => Op | null)[] = [
      () => {
        const b = anyBench();
        const d = donor();
        return {
          name: 'adopt',
          run: () => call('POST', '/adoptions', d.cookie, { benchId: b.id, months: 12, displayName: d.email }),
        };
      },
      () => {
        if (active.length === 0) return null;
        const a = random.pick(active);
        // Only the owner can renew; others get a clean 404, which is also worth exercising.
        const d = donor();
        return { name: 'renew', run: () => call('POST', `/adoptions/${a.id}/renew`, d.cookie, { months: 12 }) };
      },
      () => {
        if (active.length === 0) return null;
        const a = random.pick(active);
        return { name: 'cancel', run: () => call('POST', `/adoptions/${a.id}/cancel`, actors.staff) };
      },
      () => {
        const b = anyBench();
        const choice = random.pick(['keep', 'end', 'relocate'] as const);
        const payload =
          choice === 'relocate' ? { adoption: choice, relocateTo: anyBench().code } : { adoption: choice };
        return { name: `retire-${choice}`, run: () => call('POST', `/benches/${b.id}/retire`, actors.staff, payload) };
      },
      () => {
        const b = anyBench();
        return { name: 'restore', run: () => call('POST', `/benches/${b.id}/restore`, actors.staff) };
      },
      () => {
        const b = anyBench();
        const d = donor();
        return {
          name: 'report',
          run: () => call('POST', `/benches/${b.id}/reports`, d.cookie, { kind: 'damaged', details: 'chaos' }),
        };
      },
      () => {
        if (openTasks.length === 0) return null;
        const task = random.pick(openTasks);
        return { name: 'close-task', run: () => call('PATCH', `/maintenance/${task.id}`, actors.staff, { status: 'done' }) };
      },
      () => ({ name: 'browse', run: () => call('GET', `/parks/${PARK}/benches?limit=1000`, '') }),
    ];

    const ops = Array.from({ length: perWave }, () => random.pick(makers)()).filter((o): o is Op => o !== null);
    await Promise.all(
      ops.map(async (op) => {
        try {
          const res = await op.run();
          const counts = (tally.byOp[op.name] ??= {});
          counts[res.statusCode] = (counts[res.statusCode] ?? 0) + 1;
          if (res.statusCode >= 500) tally.serverErrors.push({ op: op.name, status: res.statusCode, body: res.body.slice(0, 200) });
        } catch (err) {
          tally.crashes.push(`${op.name}: ${(err as Error).message}`);
        }
      }),
    );
  }
  return tally;
}
