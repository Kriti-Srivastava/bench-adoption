/**
 * The rules that must hold no matter what failed along the way. Each check
 * is a SQL query returning offending rows; an empty result means it holds.
 * Some are also enforced by constraints (listed so a dropped constraint would
 * be caught); the others are only upheld by application logic, which is
 * exactly what chaos is meant to stress.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../src/db/client.ts';

const CHECKS: Record<string, ReturnType<typeof sql>> = {
  // Enforced by the exclusion constraint.
  'no two active adoptions of a bench overlap': sql`
    select a1.id from adoptions a1 join adoptions a2
      on a1.bench_id = a2.bench_id and a1.id < a2.id
     and a1.status = 'active' and a2.status = 'active'
     and daterange(a1.start_date, a1.end_date) && daterange(a2.start_date, a2.end_date)`,

  // Application logic: renewals continue their predecessor exactly.
  'a renewal starts the day its predecessor ends, on the same bench': sql`
    select r.id from adoptions r join adoptions p on p.id = r.renewed_from_id
     where r.status = 'active' and (r.start_date <> p.end_date or r.bench_id <> p.bench_id)`,

  // Application logic: cancelling cancels the chain.
  'no active renewal of a cancelled adoption': sql`
    select r.id from adoptions r join adoptions p on p.id = r.renewed_from_id
     where r.status = 'active' and p.status = 'cancelled'`,

  // Application logic: nothing can be adopted once a bench is retired.
  'no adoption was created on a bench after it was retired': sql`
    select a.id from adoptions a join benches b on b.id = a.bench_id
     where b.status = 'retired' and a.status = 'active'
       and a.created_at > (
         select max(m.completed_at) from maintenance_tasks m
          where m.bench_id = b.id and m.title = 'Bench retired')`,

  // Application logic: a cancelled adoption leaves no plaque work behind.
  'no open plaque work for cancelled adoptions': sql`
    select m.id from maintenance_tasks m join adoptions a on a.id = m.adoption_id
     where a.status = 'cancelled' and m.status in ('open', 'scheduled', 'in_progress')`,

  // Application logic: an adoption and its plaque job are created together.
  // (Renewals and seeded history have none; every other adoption must.)
  'every new adoption has its plaque job': sql`
    select a.id from adoptions a
     where a.renewed_from_id is null
       and not exists (select 1 from maintenance_tasks m where m.adoption_id = a.id)`,

  // Enforced by the reminders_sent primary key.
  'no reminder recorded twice': sql`
    select adoption_id from reminders_sent group by adoption_id, days_before having count(*) > 1`,

  // Enforced by composite foreign keys.
  'benches, areas and trails never cross parks': sql`
    select b.id from benches b join areas ar on ar.id = b.area_id where ar.park_id <> b.park_id
    union all
    select bt.bench_id from bench_trails bt join trails t on t.id = bt.trail_id where t.park_id <> bt.park_id`,

  // Enforced by a CHECK constraint.
  'a task is complete exactly when it is done': sql`
    select id from maintenance_tasks where (status = 'done') <> (completed_at is not null)`,
};

/** Returns every broken rule with a few offending ids; empty when all hold. */
export async function violatedInvariants(db: Db): Promise<Record<string, string[]>> {
  const broken: Record<string, string[]> = {};
  for (const [rule, query] of Object.entries(CHECKS)) {
    const { rows } = await db.execute(query);
    if (rows.length > 0) broken[rule] = rows.slice(0, 5).map((r) => String(Object.values(r)[0]));
  }
  return broken;
}
