import type {
  CreateTaskInput,
  MaintenanceQuery,
  MaintenanceTask,
  MaintenanceType,
  UpdateTaskInput,
  UserReport,
} from '@bench/shared';
import { badRequest, notFound } from '../errors.ts';
import * as benchRepo from '../repositories/benches.ts';
import * as taskRepo from '../repositories/maintenance.ts';
import * as parkRepo from '../repositories/parks.ts';
import * as userRepo from '../repositories/users.ts';
import type { UserRow } from '../repositories/users.ts';
import type { AppContext } from './context.ts';

type ProblemKind = 'damaged' | 'graffiti' | 'dirty' | 'plaque' | 'other';

/** How a visitor's report becomes a task for the crew. */
const PROBLEM_TASKS: Record<ProblemKind, { type: MaintenanceType; title: string }> = {
  damaged: { type: 'repair', title: 'Reported: bench damaged' },
  graffiti: { type: 'graffiti', title: 'Reported: graffiti' },
  dirty: { type: 'cleaning', title: 'Reported: needs cleaning' },
  plaque: { type: 'plaque', title: 'Reported: plaque problem' },
  other: { type: 'other', title: 'Reported: other problem' },
};

const person = (p: { id: string | null; name: string | null; email: string | null } | null) =>
  p?.id ? { id: p.id, name: p.name, email: p.email! } : null;

export function toTask(v: taskRepo.TaskView): MaintenanceTask {
  const t = v.task;
  return {
    id: t.id,
    benchId: t.benchId,
    benchCode: v.benchCode,
    benchName: v.benchName,
    type: t.type,
    status: t.status,
    priority: t.priority,
    title: t.title,
    details: t.details,
    reportedBy: person(v.reporter),
    assignee: person(v.assignee),
    scheduledFor: t.scheduledFor,
    completedAt: t.completedAt?.toISOString() ?? null,
    resolution: t.resolution,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function toUserReport(v: taskRepo.TaskView): UserReport {
  return {
    id: v.task.id,
    parkSlug: v.parkSlug,
    benchCode: v.benchCode,
    benchName: v.benchName,
    type: v.task.type,
    status: v.task.status,
    details: v.task.details,
    resolution: v.task.resolution,
    createdAt: v.task.createdAt.toISOString(),
  };
}

export function createMaintenanceService(ctx: AppContext) {
  const { db } = ctx;

  async function requireBench(benchId: string) {
    const found = await benchRepo.findBenchWithParkRules(db, benchId);
    if (!found) throw notFound('Bench');
    return found.bench;
  }

  async function view(id: string): Promise<MaintenanceTask> {
    const v = await taskRepo.findTaskView(db, id);
    if (!v) throw notFound('Task');
    return toTask(v);
  }

  return {
    async listForPark(slug: string, q: MaintenanceQuery): Promise<MaintenanceTask[]> {
      const park = await parkRepo.findParkBySlug(db, slug);
      if (!park) throw notFound('Park');
      const rows = await taskRepo.listTaskViews(db, { parkId: park.id, ...q });
      return rows.map(toTask);
    },

    async listForBench(benchId: string): Promise<MaintenanceTask[]> {
      await requireBench(benchId);
      return (await taskRepo.listTaskViews(db, { benchId })).map(toTask);
    },

    /** Staff raise a task directly (inspection rounds, planned painting...). */
    async create(actor: UserRow, benchId: string, input: Required<CreateTaskInput>): Promise<MaintenanceTask> {
      await requireBench(benchId);
      const row = await taskRepo.insertTask(db, {
        benchId,
        type: input.type,
        priority: input.priority,
        title: input.title,
        details: input.details,
        scheduledFor: input.scheduledFor,
        status: input.scheduledFor ? 'scheduled' : 'open',
        reportedById: actor.id,
      });
      return view(row.id);
    },

    /** A visitor reports a problem; it lands in the crew's queue. */
    async report(user: UserRow, benchId: string, kind: ProblemKind, details: string): Promise<UserReport> {
      await requireBench(benchId);
      const { type, title } = PROBLEM_TASKS[kind];
      const row = await taskRepo.insertTask(db, { benchId, type, title, details, reportedById: user.id });
      return toUserReport((await taskRepo.findTaskView(db, row.id))!);
    },

    async myReports(user: UserRow): Promise<UserReport[]> {
      return (await taskRepo.listTaskViews(db, { reportedById: user.id })).map(toUserReport);
    },

    async update(id: string, input: UpdateTaskInput): Promise<MaintenanceTask> {
      if (input.assigneeId) {
        const assignee = await userRepo.findUserById(db, input.assigneeId);
        if (!assignee || assignee.role === 'adopter') {
          throw badRequest('invalid_assignee', 'Tasks can only be assigned to park staff.');
        }
      }
      const { status, ...rest } = input;
      const updated = await taskRepo.updateTask(db, id, {
        ...rest,
        // "done" and completedAt always change together (also enforced by the database).
        ...(status === undefined
          ? {}
          : { status, completedAt: status === 'done' ? ctx.clock.now() : null }),
      });
      if (!updated) throw notFound('Task');
      return view(id);
    },
  };
}

export type MaintenanceService = ReturnType<typeof createMaintenanceService>;
