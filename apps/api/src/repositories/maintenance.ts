import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { MaintenancePriority, MaintenanceStatus, MaintenanceType } from '@bench/shared';
import type { Executor } from '../db/client.ts';
import { benches, maintenanceTasks, parks, users } from '../db/schema.ts';

export type TaskRow = typeof maintenanceTasks.$inferSelect;
export type NewTask = typeof maintenanceTasks.$inferInsert;

/** Statuses of work that still needs doing. */
export const OPEN_STATUSES = ['open', 'scheduled', 'in_progress'] as const;

const reporter = alias(users, 'reporter');
const assignee = alias(users, 'assignee');

/** A task with the bench and people it refers to. */
function selectTaskViews(db: Executor) {
  return db
    .select({
      task: maintenanceTasks,
      benchCode: benches.code,
      benchName: benches.name,
      parkSlug: parks.slug,
      reporter: { id: reporter.id, name: reporter.fullName, email: reporter.email },
      assignee: { id: assignee.id, name: assignee.fullName, email: assignee.email },
    })
    .from(maintenanceTasks)
    .innerJoin(benches, eq(benches.id, maintenanceTasks.benchId))
    .innerJoin(parks, eq(parks.id, benches.parkId))
    .leftJoin(reporter, eq(reporter.id, maintenanceTasks.reportedById))
    .leftJoin(assignee, eq(assignee.id, maintenanceTasks.assigneeId));
}

export type TaskView = Awaited<ReturnType<ReturnType<typeof selectTaskViews>['execute']>>[number];

export async function insertTask(db: Executor, values: NewTask): Promise<TaskRow> {
  const [row] = await db.insert(maintenanceTasks).values(values).returning();
  return row!;
}

export async function updateTask(
  db: Executor,
  id: string,
  values: Partial<NewTask>,
): Promise<TaskRow | undefined> {
  const [row] = await db
    .update(maintenanceTasks)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(maintenanceTasks.id, id))
    .returning();
  return row;
}

export async function findTaskView(db: Executor, id: string): Promise<TaskView | undefined> {
  const [row] = await selectTaskViews(db).where(eq(maintenanceTasks.id, id));
  return row;
}

export interface TaskFilter {
  parkId?: string;
  benchId?: string;
  reportedById?: string;
  status?: MaintenanceStatus;
  type?: MaintenanceType;
  priority?: MaintenancePriority;
  openOnly?: boolean;
}

/** Tasks newest first, urgent work ahead of the rest. */
export async function listTaskViews(db: Executor, f: TaskFilter): Promise<TaskView[]> {
  return selectTaskViews(db)
    .where(
      and(
        f.parkId ? eq(benches.parkId, f.parkId) : undefined,
        f.benchId ? eq(maintenanceTasks.benchId, f.benchId) : undefined,
        f.reportedById ? eq(maintenanceTasks.reportedById, f.reportedById) : undefined,
        f.status ? eq(maintenanceTasks.status, f.status) : undefined,
        f.type ? eq(maintenanceTasks.type, f.type) : undefined,
        f.priority ? eq(maintenanceTasks.priority, f.priority) : undefined,
        f.openOnly ? inArray(maintenanceTasks.status, [...OPEN_STATUSES]) : undefined,
      ),
    )
    .orderBy(
      sql`case ${maintenanceTasks.priority} when 'urgent' then 0 when 'normal' then 1 else 2 end`,
      desc(maintenanceTasks.createdAt),
    )
    .limit(1000);
}

/** Closes unfinished tasks tied to adoptions that no longer exist (e.g. plaque installs). */
export async function cancelOpenTasksForAdoptions(db: Executor, adoptionIds: string[]): Promise<void> {
  if (adoptionIds.length === 0) return;
  await db
    .update(maintenanceTasks)
    .set({ status: 'cancelled', updatedAt: new Date(), resolution: 'Adoption was cancelled.' })
    .where(
      and(
        inArray(maintenanceTasks.adoptionId, adoptionIds),
        notInArray(maintenanceTasks.status, ['done', 'cancelled']),
      ),
    );
}

/** Per-bench maintenance facts, as correlated subqueries for bench selects. */
export const lastDoneOn = (benchId: AnyPgColumn, timezone: string, type?: MaintenanceType) => sql<
  string | null
>`(
  select (max(m.completed_at) at time zone ${timezone})::date::text from maintenance_tasks m
  where m.bench_id = ${benchId} and m.status = 'done'
  ${type ? sql`and m.type = ${type}` : sql``}
)`;

export const openTaskCount = (benchId: AnyPgColumn) => sql<number>`(
  select count(*)::int from maintenance_tasks m
  where m.bench_id = ${benchId} and m.status in ('open', 'scheduled', 'in_progress')
)`;
