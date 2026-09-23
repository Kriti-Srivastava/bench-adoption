/**
 * When an adoption can be renewed.
 *
 * One rule, consulted everywhere it matters: the renew command turns a reason
 * into its error, the adoption the API hands clients carries the answer as
 * `canRenew` (so a button is only offered when pressing it would work), and
 * the reminder job asks the same questions in SQL before chasing anyone.
 */
import type { IsoDate } from '@bench/shared';
import type { AdoptionView } from '../repositories/adoptions.ts';

export interface RenewalBlock {
  code: 'bench_retired' | 'adoption_cancelled' | 'adoption_ended' | 'already_renewed';
  message: string;
}

/** Said in one place, so the bench page, the renew command and email agree. */
export const BENCH_RETIRED: RenewalBlock = {
  code: 'bench_retired',
  message: 'This bench is no longer part of the program.',
};

/** The reason this adoption can't be renewed today, or null if it can be. */
export function renewalBlockedBy(v: AdoptionView, today: IsoDate): RenewalBlock | null {
  if (v.benchStatus !== 'active') return BENCH_RETIRED;
  if (v.adoption.status !== 'active') {
    return { code: 'adoption_cancelled', message: 'This adoption was cancelled.' };
  }
  if (v.adoption.endDate <= today) {
    return { code: 'adoption_ended', message: 'This adoption has ended. Please adopt the bench again.' };
  }
  // Renewals are added one at a time: the next one can be arranged once this
  // one is the adoption running on the bench.
  if (v.isRenewed) return { code: 'already_renewed', message: 'This adoption has already been renewed.' };
  return null;
}
