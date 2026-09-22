import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AdminBench } from '@bench/shared';
import { api } from '../../api.ts';
import { RetirePanel } from '../../components/RetirePanel.tsx';
import { NewTaskForm, TaskItem } from '../../components/TaskEditor.tsx';
import { ErrorNotice, Loadable, StatusBadge } from '../../components/ui.tsx';
import { formatDate } from '../../format.ts';
import { isOpen } from '../../maintenance.ts';
import { keys, useIsStaff } from '../../queries.ts';
import { useStaffList } from './AdminPage.tsx';

/** Everything staff can do with one bench: its condition, upkeep history and lifecycle. */
export function BenchAdminPage() {
  const { slug = '', code = '' } = useParams();
  const { isStaff } = useIsStaff();
  const benches = useQuery({
    queryKey: keys.adminBenches(slug),
    queryFn: () => api.staff.benches(slug),
    enabled: isStaff,
  });

  if (!isStaff) return <p className="notice">This area is for park staff.</p>;
  return (
    <Loadable query={benches}>
      {(all) => {
        const bench = all.find((b) => b.code === code);
        if (!bench) return <p className="notice">No bench {code}.</p>;
        const available = all.filter((b) => b.availability === 'available').map((b) => b.code);
        return <BenchAdmin slug={slug} bench={bench} availableCodes={available} />;
      }}
    </Loadable>
  );
}

function BenchAdmin({
  slug,
  bench,
  availableCodes,
}: {
  slug: string;
  bench: AdminBench;
  availableCodes: string[];
}) {
  const tasks = useQuery({ queryKey: keys.benchTasks(bench.id), queryFn: () => api.staff.benchTasks(bench.id) });
  const staff = useStaffList();
  const [retiring, setRetiring] = useState(false);
  const queryClient = useQueryClient();
  const restore = useMutation({
    mutationFn: () => api.staff.restore(bench.id),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const a = bench.currentAdoption;

  return (
    <div className="stack">
      <nav className="breadcrumbs small" aria-label="Breadcrumb">
        <Link to={`/parks/${slug}/admin`}>Admin</Link>
        <span aria-hidden>›</span>
        <Link to={`/parks/${slug}/admin?tab=benches`}>Benches</Link>
        <span aria-hidden>›</span>
        <span aria-current="page">{bench.code}</span>
      </nav>
      <div className="row">
        <h1 style={{ margin: 0 }}>Bench {bench.code}</h1>
        <StatusBadge availability={bench.availability} />
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {bench.name} · {bench.zone} ·{' '}
        <Link to={`/parks/${slug}/benches/${bench.code}`}>public page</Link>
      </p>

      <div className="bench-layout">
        <div className="bench-layout-map stack">
          <section className="card stack">
            <h2>Upkeep</h2>
            <dl className="dl">
              <dt>Last inspected</dt>
              <dd>
                {bench.lastInspectedOn ? formatDate(bench.lastInspectedOn) : 'Never'}
                {bench.needsInspection && <span className="badge task-open" style={{ marginLeft: 6 }}>Due</span>}
              </dd>
              <dt>Last work done</dt>
              <dd>{bench.lastMaintainedOn ? formatDate(bench.lastMaintainedOn) : 'None recorded'}</dd>
              <dt>Open tasks</dt>
              <dd>{bench.openTasks}</dd>
            </dl>
          </section>

          <section className="card stack">
            <h2>Maintenance</h2>
            <Loadable query={tasks}>
              {(items) => {
                const open = items.filter((t) => isOpen(t.status));
                const history = items.filter((t) => !isOpen(t.status));
                return (
                  <>
                    {open.length === 0 && <p className="muted">No open tasks.</p>}
                    {open.length > 0 && (
                      <ul className="task-list">
                        {open.map((t) => (
                          <TaskItem key={t.id} task={t} staff={staff} parkSlug={slug} />
                        ))}
                      </ul>
                    )}
                    {history.length > 0 && (
                      <details>
                        <summary>History ({history.length})</summary>
                        <ul className="task-list">
                          {history.map((t) => (
                            <TaskItem key={t.id} task={t} staff={staff} parkSlug={slug} />
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                );
              }}
            </Loadable>
            <details>
              <summary>Add a task</summary>
              <NewTaskForm benchId={bench.id} />
            </details>
          </section>
        </div>

        <div className="bench-layout-side stack">
          <section className="card stack">
            <h2>Adoption</h2>
            {a ? (
              <dl className="dl">
                <dt>Shown as</dt>
                <dd>{a.displayName}</dd>
                <dt>Period</dt>
                <dd>
                  {formatDate(a.startDate)} – {formatDate(a.endDate)}
                </dd>
                {a.dedication && (
                  <>
                    <dt>Dedication</dt>
                    <dd>“{a.dedication}”</dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="muted">Not currently adopted.</p>
            )}
            <Link className="small" to={`/parks/${slug}/admin?tab=adoptions`}>
              Manage adoptions →
            </Link>
          </section>

          <section className="card stack">
            <h2>In the program?</h2>
            {bench.status === 'retired' ? (
              <>
                <p className="muted">This bench is retired: shown grey on the map and not adoptable.</p>
                <ErrorNotice error={restore.error} />
                <div>
                  <button className="btn secondary" disabled={restore.isPending} onClick={() => restore.mutate()}>
                    Return to the program
                  </button>
                </div>
              </>
            ) : retiring ? (
              <RetirePanel bench={bench} availableCodes={availableCodes} onDone={() => setRetiring(false)} />
            ) : (
              <>
                <p className="muted">
                  Retire a bench that has been removed or is beyond repair. You'll choose what happens to its
                  adoption.
                </p>
                <div>
                  <button className="btn danger" onClick={() => setRetiring(true)}>
                    Retire this bench…
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
