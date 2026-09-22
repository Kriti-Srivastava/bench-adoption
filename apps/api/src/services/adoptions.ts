import {
  addDays,
  addMonths,
  termsLabel,
  todayIn,
  type AdminAdoption,
  type Adoption,
  type IsoDate,
} from '@bench/shared';
import type { Executor } from '../db/client.ts';
import { toCsv } from '../http/csv.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import * as adoptionRepo from '../repositories/adoptions.ts';
import type { BenchRow } from '../repositories/benches.ts';
import * as taskRepo from '../repositories/maintenance.ts';
import * as parkRepo from '../repositories/parks.ts';
import type { UserRow } from '../repositories/users.ts';
import { withAdoptionLocked, withBenchesLocked } from './consistency.ts';
import { recordEvent } from './events.ts';
import type { AppContext } from './context.ts';
import { toAdminAdoption, toAdoption } from './mappers.ts';

export interface AdoptInput {
  benchId: string;
  months: number;
  displayName: string;
  dedication: string | null;
  isAnonymous: boolean;
}

export function createAdoptionService(ctx: AppContext) {
  const { db } = ctx;

  /**
   * Checks a (locked) bench can take an adoption of `months`, and returns
   * today's date in its park. Read inside the lock, so it can't go stale.
   */
  async function requireAdoptable(tx: Executor, bench: BenchRow, months: number) {
    if (bench.status !== 'active') {
      throw conflict('bench_retired', 'This bench is no longer part of the program.');
    }
    const park = (await parkRepo.findParkById(tx, bench.parkId))!;
    if (!park.adoptionTermsMonths.includes(months)) {
      throw badRequest('invalid_term', `This park offers adoptions of ${termsLabel(park.adoptionTermsMonths)}.`);
    }
    return todayIn(park.timezone, ctx.clock.now());
  }

  const view = async (tx: Executor, id: string) =>
    toAdoption((await adoptionRepo.findAdoptionView(tx, id))!, ctx.clock.now());

  /** Records the adoption (and queues the donor's confirmation) in the same transaction. */
  const confirm = (tx: Executor, user: UserRow, a: Adoption, renewal: boolean) =>
    recordEvent(
      tx,
      ctx,
      {
        type: renewal ? 'adoption.renewed' : 'adoption.created',
        payload: {
          email: user.email,
          benchCode: a.benchCode,
          benchName: a.benchName,
          startDate: a.startDate,
          endDate: a.endDate,
        },
      },
      { benchId: a.benchId, adoptionId: a.id, actorId: user.id },
    );

  return {
    /** Adopts a bench starting today, and queues its plaque (typically fitted within 6-8 weeks). */
    async adopt(user: UserRow, input: AdoptInput): Promise<Adoption> {
      const adoption = await withBenchesLocked(db, [input.benchId], async (tx, [bench]) => {
        const today = await requireAdoptable(tx, bench!, input.months);
        const row = await adoptionRepo.insertAdoption(tx, {
          benchId: bench!.id,
          adopterId: user.id,
          startDate: today,
          endDate: addMonths(today, input.months),
          displayName: input.displayName,
          dedication: input.dedication,
          isAnonymous: input.isAnonymous,
        });
        await taskRepo.insertTask(tx, {
          benchId: bench!.id,
          type: 'plaque',
          title: `Install plaque: ${input.isAnonymous ? 'anonymous donor' : input.displayName}`,
          details: input.dedication,
          adoptionId: row.id,
        });
        const adoption = await view(tx, row.id);
        await confirm(tx, user, adoption, false);
        return adoption;
      });
      return adoption;
    },

    /** Extends the owner's adoption; the new period starts when the current one ends. */
    async renew(user: UserRow, adoptionId: string, months: number): Promise<Adoption> {
      const adoption = await withAdoptionLocked(db, adoptionId, async (tx, current, bench) => {
        // Someone else's adoption is reported as missing, not forbidden, to avoid leaking ids.
        if (current.adoption.adopterId !== user.id) throw notFound('Adoption');
        const prev = current.adoption;
        const today = await requireAdoptable(tx, bench, months);
        if (prev.status !== 'active') {
          throw conflict('adoption_cancelled', 'This adoption was cancelled.');
        }
        if (prev.endDate <= today) {
          throw conflict('adoption_ended', 'This adoption has ended. Please adopt the bench again.');
        }
        if (current.isRenewed) {
          throw conflict('already_renewed', 'This adoption has already been renewed.');
        }
        const row = await adoptionRepo.insertAdoption(tx, {
          benchId: prev.benchId,
          adopterId: user.id,
          startDate: prev.endDate,
          endDate: addMonths(prev.endDate, months),
          displayName: prev.displayName,
          dedication: prev.dedication,
          isAnonymous: prev.isAnonymous,
          renewedFromId: prev.id,
        });
        const renewal = await view(tx, row.id);
        await confirm(tx, user, renewal, true);
        return renewal;
      });
      return adoption;
    },

    async listMine(user: UserRow): Promise<Adoption[]> {
      const rows = await adoptionRepo.listAdoptionViewsByAdopter(db, user.id);
      return rows.map((r) => toAdoption(r, ctx.clock.now()));
    },

    async listForPark(
      slug: string,
      q: { expiringWithinDays?: number; includeEnded: boolean },
    ): Promise<AdminAdoption[]> {
      const park = await parkRepo.findParkBySlug(db, slug);
      if (!park) throw notFound('Park');
      const today: IsoDate = todayIn(park.timezone, ctx.clock.now());
      const rows = await adoptionRepo.listAdoptionViewsForPark(db, {
        parkId: park.id,
        today,
        includeEnded: q.includeEnded,
        endingOnOrBefore:
          q.expiringWithinDays === undefined ? undefined : addDays(today, q.expiringWithinDays),
      });
      return rows.map((r) => toAdminAdoption(r, ctx.clock.now()));
    },

    toCsv(items: AdminAdoption[]): string {
      return toCsv(
        items.map((a) => ({
          bench_code: a.benchCode,
          bench_name: a.benchName,
          adopter_name: a.adopterName ?? '',
          adopter_email: a.adopterEmail,
          display_name: a.displayName,
          anonymous: a.isAnonymous ? 'yes' : 'no',
          dedication: a.dedication ?? '',
          start_date: a.startDate,
          end_date: a.endDate,
          renewed: a.isRenewed ? 'yes' : 'no',
        })),
      );
    },

    /** Cancels an adoption, any renewals that follow it, and their pending plaque work. */
    async cancel(adoptionId: string): Promise<Adoption> {
      return withAdoptionLocked(db, adoptionId, async (tx, current) => {
        const cancelled = await adoptionRepo.cancelAdoptionChain(tx, adoptionId);
        await taskRepo.cancelOpenTasksForAdoptions(tx, cancelled);
        await recordEvent(
          tx,
          ctx,
          {
            type: 'adoption.cancelled',
            payload: { email: current.adopterEmail, benchCode: current.benchCode, reason: null },
          },
          { benchId: current.adoption.benchId, adoptionId },
        );
        return view(tx, adoptionId);
      });
    },
  };
}

export type AdoptionService = ReturnType<typeof createAdoptionService>;
