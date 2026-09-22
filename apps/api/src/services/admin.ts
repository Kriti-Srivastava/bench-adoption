/**
 * Park staff operations: the bench register with upkeep status, the
 * dashboard summary, retiring/restoring benches (and what happens to their
 * adoptions), and user management.
 */
import {
  addDays,
  benchAvailabilities,
  INSPECTION_INTERVAL_DAYS,
  todayIn,
  type AdminBench,
  type AdminSummary,
  type AdminUser,
  type BenchSummary,
  type IsoDate,
  type RetireBenchInput,
  type Role,
} from '@bench/shared';
import { adoptionEndedEmail, adoptionMovedEmail } from '../email/templates.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import * as adoptionRepo from '../repositories/adoptions.ts';
import * as benchRepo from '../repositories/benches.ts';
import * as taskRepo from '../repositories/maintenance.ts';
import * as parkRepo from '../repositories/parks.ts';
import * as userRepo from '../repositories/users.ts';
import type { UserRow } from '../repositories/users.ts';
import { withBenchesLocked } from './consistency.ts';
import type { AppContext } from './context.ts';
import { toBenchSummary } from './mappers.ts';
import { notify } from './notify.ts';

/** An active bench is due an inspection if it has never had one, or not within the interval. */
export function needsInspection(row: benchRepo.AdminBenchRow, today: IsoDate): boolean {
  if (row.bench.status !== 'active') return false;
  return !row.lastInspectedOn || row.lastInspectedOn <= addDays(today, -INSPECTION_INTERVAL_DAYS);
}

function toAdminBench(row: benchRepo.AdminBenchRow, today: IsoDate): AdminBench {
  return {
    ...toBenchSummary(row),
    openTasks: row.openTasks,
    lastInspectedOn: row.lastInspectedOn,
    lastMaintainedOn: row.lastMaintainedOn,
    needsInspection: needsInspection(row, today),
  };
}

export function createAdminService(ctx: AppContext) {
  const { db, config } = ctx;
  const manageUrl = `${config.webUrl}/me/benches`;

  async function requirePark(slug: string) {
    const park = await parkRepo.findParkBySlug(db, slug);
    if (!park) throw notFound('Park');
    return { park, today: todayIn(park.timezone, ctx.clock.now()) };
  }

  async function summary(benchId: string, today: IsoDate): Promise<BenchSummary> {
    return toBenchSummary((await benchRepo.findBench(db, { id: benchId }, today))!);
  }

  /** Records a lifecycle event in the bench's maintenance history. */
  function logEvent(
    tx: Parameters<typeof taskRepo.insertTask>[0],
    benchId: string,
    actor: UserRow,
    title: string,
    details: string | null,
    /** The adoption the event concerns, e.g. the one a retirement kept. */
    adoptionId: string | null = null,
  ) {
    return taskRepo.insertTask(tx, {
      benchId,
      type: 'other',
      status: 'done',
      completedAt: ctx.clock.now(),
      title,
      details,
      reportedById: actor.id,
      adoptionId,
    });
  }

  return {
    async listBenches(slug: string): Promise<AdminBench[]> {
      const { park, today } = await requirePark(slug);
      const rows = await benchRepo.listAdminBenches(db, { parkId: park.id, today, timezone: park.timezone });
      return rows.map((r) => toAdminBench(r, today));
    },

    async summary(slug: string): Promise<AdminSummary> {
      const { park, today } = await requirePark(slug);
      const [rows, open] = await Promise.all([
        benchRepo.listAdminBenches(db, { parkId: park.id, today, timezone: park.timezone }),
        taskRepo.listTaskViews(db, { parkId: park.id, openOnly: true }),
      ]);
      const benches = Object.fromEntries(benchAvailabilities.map((a) => [a, 0])) as AdminSummary['benches'];
      for (const r of rows) benches[r.availability]++;
      return {
        benches,
        needsInspection: rows.filter((r) => needsInspection(r, today)).length,
        openTasks: open.length,
        urgentTasks: open.filter((t) => t.task.priority === 'urgent').length,
        plaquesToInstall: open.filter((t) => t.task.type === 'plaque' || t.task.type === 'relocation').length,
        endingSoon: benches.ending_soon,
      };
    },

    /**
     * Takes a bench out of the program. Its current adoption (and any
     * renewal) is kept until it ends, ended now, or moved to another bench
     * along with a task to move the plaque. Everything is decided and written
     * with the bench (and any relocation target) locked, so a donor adopting
     * or renewing at the same moment can't slip in between. The donor is
     * emailed when their adoption changes.
     */
    async retire(actor: UserRow, benchId: string, input: RetireBenchInput): Promise<BenchSummary> {
      const reason = input.reason?.trim() || null;
      // Resolve the relocation target's id so it can be locked alongside; it is re-checked under the lock.
      const found = await benchRepo.findBenchWithParkRules(db, benchId);
      if (!found) throw notFound('Bench');
      const targetId =
        input.adoption === 'relocate' ? (await benchRepo.findBenchIdByCode(db, found.bench.parkId, input.relocateTo!)) : undefined;
      if (input.adoption === 'relocate' && !targetId) {
        throw badRequest('invalid_target', `There is no bench ${input.relocateTo}.`);
      }

      const result = await withBenchesLocked(db, [benchId, ...(targetId ? [targetId] : [])], async (tx) => {
        const today = todayIn(found.timezone, ctx.clock.now());
        const { bench, current } = (await benchRepo.findBench(tx, { id: benchId }, today))!;
        if (bench.status === 'retired') throw conflict('already_retired', 'This bench is already retired.');
        const donor = current ? await adoptionRepo.findAdoptionView(tx, current.id) : undefined;

        let target: benchRepo.BenchRow | undefined;
        if (current && targetId) {
          if (targetId === bench.id) throw badRequest('invalid_target', 'Choose a different bench.');
          const t = (await benchRepo.findBench(tx, { id: targetId }, today))!;
          if (t.availability !== 'available') {
            throw conflict('relocation_target_unavailable', `Bench ${t.bench.code} is not available.`);
          }
          target = t.bench;
        }

        await benchRepo.updateBench(tx, benchId, { status: 'retired' });
        let outcome = 'No active adoption.';
        if (current && input.adoption === 'end') {
          const cancelled = await adoptionRepo.cancelAdoptionChain(tx, current.id);
          await taskRepo.cancelOpenTasksForAdoptions(tx, cancelled);
          outcome = 'Adoption ended early.';
        } else if (current && target) {
          await benchRepo.moveAdoptions(tx, { fromBenchId: benchId, toBenchId: target.id, today });
          await taskRepo.insertTask(tx, {
            benchId: target.id,
            type: 'relocation',
            title: `Move plaque from ${bench.code}`,
            details: `Adoption by ${current.displayName} moved from retired bench ${bench.code}.`,
            adoptionId: current.id,
            reportedById: actor.id,
          });
          outcome = `Adoption moved to ${target.code}.`;
        } else if (current) {
          outcome = `Adoption kept until it ends on ${current.endDate}.`;
        }
        // Record which adoption (if any) the retirement kept running on this bench.
        const kept = current && input.adoption === 'keep' ? current.id : null;
        await logEvent(tx, benchId, actor, 'Bench retired', [reason, outcome].filter(Boolean).join(' '), kept);
        return { bench, donor, target, today };
      });

      const { bench, donor, target, today } = result;
      if (donor && input.adoption === 'end') {
        await notify(ctx, adoptionEndedEmail(donor.adopterEmail, { benchCode: bench.code, reason, manageUrl }));
      } else if (donor && target) {
        await notify(
          ctx,
          adoptionMovedEmail(donor.adopterEmail, {
            fromCode: bench.code,
            toCode: target.code,
            toName: target.name,
            endDate: donor.adoption.endDate,
            reason,
            manageUrl,
          }),
        );
      }
      return summary(benchId, today);
    },

    async restore(actor: UserRow, benchId: string): Promise<BenchSummary> {
      const found = await benchRepo.findBenchWithParkRules(db, benchId);
      if (!found) throw notFound('Bench');
      await withBenchesLocked(db, [benchId], async (tx, [bench]) => {
        if (bench!.status === 'active') throw conflict('not_retired', 'This bench is already in the program.');
        await benchRepo.updateBench(tx, benchId, { status: 'active' });
        await logEvent(tx, benchId, actor, 'Bench returned to the program', null);
      });
      return summary(benchId, todayIn(found.timezone, ctx.clock.now()));
    },

    async listUsers(q: { q?: string; role?: Role }): Promise<AdminUser[]> {
      const rows = await userRepo.listUsers(db, { ...q, now: ctx.clock.now() });
      return rows.map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        createdAt: u.createdAt.toISOString(),
        activeAdoptions: u.activeAdoptions,
      }));
    },
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
