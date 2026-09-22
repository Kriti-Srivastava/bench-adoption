import { stringify } from 'csv-stringify/sync';
import {
  addDays,
  addMonths,
  termsLabel,
  todayIn,
  type AdminAdoption,
  type Adoption,
  type IsoDate,
} from '@bench/shared';
import { PG, pgErrorCode, retryOnContention } from '../db/client.ts';
import { adoptionConfirmedEmail } from '../email/templates.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import * as adoptionRepo from '../repositories/adoptions.ts';
import * as benchRepo from '../repositories/benches.ts';
import * as taskRepo from '../repositories/maintenance.ts';
import * as parkRepo from '../repositories/parks.ts';
import type { UserRow } from '../repositories/users.ts';
import type { AppContext } from './context.ts';
import { toAdminAdoption, toAdoption } from './mappers.ts';
import { notify } from './notify.ts';

export interface AdoptInput {
  benchId: string;
  months: number;
  displayName: string;
  dedication: string | null;
  isAnonymous: boolean;
}

export function createAdoptionService(ctx: AppContext) {
  const { db } = ctx;
  const manageUrl = `${ctx.config.webUrl}/me/benches`;

  /** An adoptable bench and today's date in its park; `months` must be a term the park offers. */
  async function requireAdoptableBench(benchId: string, months: number) {
    const found = await benchRepo.findBenchWithParkRules(db, benchId);
    if (!found) throw notFound('Bench');
    if (found.bench.status !== 'active') {
      throw conflict('bench_retired', 'This bench is no longer part of the program.');
    }
    if (!found.adoptionTermsMonths.includes(months)) {
      throw badRequest('invalid_term', `This park offers adoptions of ${termsLabel(found.adoptionTermsMonths)}.`);
    }
    return { bench: found.bench, today: todayIn(found.timezone, ctx.clock.now()) };
  }

  /**
   * Inserts an adoption, letting the database arbitrate conflicts: the
   * exclusion constraint rejects overlapping periods and the unique index
   * rejects a second renewal, even when two requests race.
   */
  async function insert(values: adoptionRepo.NewAdoption): Promise<Adoption> {
    try {
      const row = await retryOnContention(() => adoptionRepo.insertAdoption(db, values));
      return toAdoption((await adoptionRepo.findAdoptionView(db, row.id))!, ctx.clock.now());
    } catch (err) {
      switch (pgErrorCode(err)) {
        case PG.exclusionViolation:
          throw conflict('bench_unavailable', 'This bench is already adopted for some of those dates.');
        case PG.uniqueViolation:
          throw conflict('already_renewed', 'This adoption has already been renewed.');
        default:
          throw err;
      }
    }
  }

  async function confirm(user: UserRow, a: Adoption, renewal: boolean) {
    await notify(
      ctx,
      adoptionConfirmedEmail(user.email, {
        benchCode: a.benchCode,
        benchName: a.benchName,
        startDate: a.startDate,
        endDate: a.endDate,
        manageUrl,
        renewal,
      }),
    );
  }

  return {
    /** Adopts a bench starting today. */
    async adopt(user: UserRow, input: AdoptInput): Promise<Adoption> {
      const { bench, today } = await requireAdoptableBench(input.benchId, input.months);
      const adoption = await insert({
        benchId: bench.id,
        adopterId: user.id,
        startDate: today,
        endDate: addMonths(today, input.months),
        displayName: input.displayName,
        dedication: input.dedication,
        isAnonymous: input.isAnonymous,
      });
      // Every new adoption needs its plaque made and fitted (typically 6-8 weeks).
      await taskRepo.insertTask(db, {
        benchId: bench.id,
        type: 'plaque',
        title: `Install plaque: ${input.isAnonymous ? 'anonymous donor' : input.displayName}`,
        details: input.dedication,
        adoptionId: adoption.id,
      });
      await confirm(user, adoption, false);
      return adoption;
    },

    /** Extends the owner's adoption; the new period starts when the current one ends. */
    async renew(user: UserRow, adoptionId: string, months: number): Promise<Adoption> {
      const current = await adoptionRepo.findAdoptionView(db, adoptionId);
      // Someone else's adoption is reported as missing, not forbidden, to avoid leaking ids.
      if (!current || current.adoption.adopterId !== user.id) throw notFound('Adoption');

      const prev = current.adoption;
      const { today } = await requireAdoptableBench(prev.benchId, months);
      if (prev.status !== 'active') {
        throw conflict('adoption_cancelled', 'This adoption was cancelled.');
      }
      if (prev.endDate <= today) {
        throw conflict('adoption_ended', 'This adoption has ended. Please adopt the bench again.');
      }
      if (current.isRenewed) {
        throw conflict('already_renewed', 'This adoption has already been renewed.');
      }

      const adoption = await insert({
        benchId: prev.benchId,
        adopterId: user.id,
        startDate: prev.endDate,
        endDate: addMonths(prev.endDate, months),
        displayName: prev.displayName,
        dedication: prev.dedication,
        isAnonymous: prev.isAnonymous,
        renewedFromId: prev.id,
      });
      await confirm(user, adoption, true);
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
      return stringify(
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
        { header: true },
      );
    },

    /** Cancels an adoption and any renewals that follow it. */
    async cancel(adoptionId: string): Promise<Adoption> {
      const cancelled = await db.transaction(async (tx) => {
        const ids = await adoptionRepo.cancelAdoptionChain(tx, adoptionId);
        await taskRepo.cancelOpenTasksForAdoptions(tx, ids);
        return ids;
      });
      if (cancelled.length === 0) throw notFound('Adoption');
      return toAdoption((await adoptionRepo.findAdoptionView(db, adoptionId))!, ctx.clock.now());
    },
  };
}

export type AdoptionService = ReturnType<typeof createAdoptionService>;
