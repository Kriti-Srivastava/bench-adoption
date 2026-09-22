/**
 * The consistency boundary for adoption state is the bench.
 *
 * Every command that changes who holds a bench (adopt, renew, cancel,
 * retire, relocate, restore) runs through `withBenchesLocked`: one
 * transaction that first locks the bench rows, then reads what the decision
 * depends on, then writes everything that follows from it. Two commands on
 * the same bench therefore run one after the other, never interleaved, and
 * a command's writes (an adoption and its plaque job, say) land together or
 * not at all.
 *
 * Postgres triggers back this up (migration `0007_adoption_guards`), so even
 * code that bypasses these helpers can't create an adoption on a retired
 * bench or a renewal of an inactive adoption.
 */
import { conflict, notFound } from '../errors.ts';
import { pgError, PG, retryOnContention, type Db, type Tx } from '../db/client.ts';
import * as adoptionRepo from '../repositories/adoptions.ts';
import * as benchRepo from '../repositories/benches.ts';

/** Maps database-enforced rule violations to the API's domain errors. */
function translate(err: unknown): unknown {
  const { code, constraint } = pgError(err);
  switch (code) {
    case PG.exclusionViolation:
      return conflict('bench_unavailable', 'This bench is already adopted for some of those dates.');
    case PG.uniqueViolation:
      return constraint === 'adoptions_renewed_once'
        ? conflict('already_renewed', 'This adoption has already been renewed.')
        : err;
    case PG.benchRetired:
      return conflict('bench_retired', 'This bench is no longer part of the program.');
    case PG.adoptionNotActive:
      return conflict('adoption_not_active', 'This adoption is no longer active.');
    default:
      return err;
  }
}

/**
 * Runs `work` in a transaction holding row locks on the given benches.
 * Locks are taken in id order so two commands touching the same pair of
 * benches can't deadlock; contention the database still reports is retried.
 */
export async function withBenchesLocked<T>(
  db: Db,
  benchIds: string[],
  work: (tx: Tx, benches: benchRepo.BenchRow[]) => Promise<T>,
): Promise<T> {
  const ids = [...new Set(benchIds)].sort();
  try {
    return await retryOnContention(() =>
      db.transaction(async (tx) => {
        const locked = await benchRepo.lockBenches(tx, ids);
        if (locked.length !== ids.length) throw notFound('Bench');
        return work(tx, ids.map((id) => locked.find((b) => b.id === id)!));
      }),
    );
  } catch (err) {
    throw translate(err);
  }
}

/**
 * Runs `work` with the bench of the given adoption locked, handing it the
 * adoption and bench as read under that lock. If the adoption was moved to
 * another bench in between (a relocation), it follows it and tries again.
 */
export async function withAdoptionLocked<T>(
  db: Db,
  adoptionId: string,
  work: (tx: Tx, adoption: adoptionRepo.AdoptionView, bench: benchRepo.BenchRow) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const seen = await adoptionRepo.findAdoptionView(db, adoptionId);
    if (!seen) throw notFound('Adoption');
    const outcome = await withBenchesLocked(db, [seen.adoption.benchId], async (tx, [bench]) => {
      const current = (await adoptionRepo.findAdoptionView(tx, adoptionId))!;
      if (current.adoption.benchId !== bench!.id) return { moved: true as const };
      return { moved: false as const, value: await work(tx, current, bench!) };
    });
    if (!outcome.moved) return outcome.value;
  }
  throw conflict('try_again', 'This adoption is being changed right now. Please try again.');
}
