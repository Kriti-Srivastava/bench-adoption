import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  maintenancePriorities,
  maintenanceStatuses,
  maintenanceTypes,
  plaqueTaskTypes,
  roles,
  type AdminBench,
  type MaintenanceQuery,
  type Role,
} from '@bench/shared';
import { api, type Page } from '../../api.ts';
import { NewTaskForm, TaskItem } from '../../components/TaskEditor.tsx';
import { ErrorNotice, Loadable, StatusBadge } from '../../components/ui.tsx';
import { formatDate } from '../../format.ts';
import { PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL } from '../../maintenance.ts';
import { keys, useIsStaff, useMe } from '../../queries.ts';
import { AddBenchTab, AdoptionsTab, ImportTab } from './StaffTools.tsx';

const TABS = [
  ['overview', 'Overview'],
  ['benches', 'Benches'],
  ['maintenance', 'Maintenance'],
  ['adoptions', 'Adoptions'],
  ['users', 'Users'],
  ['add', 'Add & import'],
] as const;
type Tab = (typeof TABS)[number][0];

/** The park staff workspace. The open tab lives in the URL (?tab=), so it survives reloads and can be linked. */
export function AdminPage() {
  const { slug = '' } = useParams();
  const me = useMe();
  const { isStaff } = useIsStaff();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find(([id]) => id === params.get('tab'))?.[0] ?? 'overview') as Tab;
  const go = (t: Tab, extra: Record<string, string> = {}) => setParams({ tab: t, ...extra });

  if (me.isPending) return <p className="muted">Loading…</p>;
  if (!isStaff) return <p className="notice">This area is for park staff.</p>;

  return (
    <div className="stack">
      <h1>Park admin</h1>
      <div className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => go(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab slug={slug} go={go} />}
      {tab === 'benches' && <BenchesTab slug={slug} />}
      {tab === 'maintenance' && <MaintenanceTab slug={slug} />}
      {tab === 'adoptions' && <AdoptionsTab slug={slug} />}
      {tab === 'users' && <UsersTab />}
      {tab === 'add' && (
        <div className="stack">
          <h2>Import benches</h2>
          <ImportTab slug={slug} />
          <h2>Add a single bench</h2>
          <AddBenchTab slug={slug} />
        </div>
      )}
    </div>
  );
}

/**
 * Long lists are cut off rather than paginated, so say so plainly instead of
 * letting a search quietly miss what it didn't show.
 */
function ShowingSome({ page, noun }: { page: Page<unknown>; noun: string }) {
  if (page.items.length >= page.total) return null;
  return (
    <p className="muted small">
      Showing the first {page.items.length} of {page.total} {noun}. Narrow the filters to see the rest.
    </p>
  );
}

/** Staff members, for assigning tasks. */
export function useStaffList() {
  const users = useQuery({ queryKey: keys.users({}), queryFn: () => api.staff.users() });
  return (users.data?.items ?? []).filter((u) => u.role !== 'adopter');
}

// ---------------------------------------------------------------- overview

function OverviewTab({ slug, go }: { slug: string; go: (t: Tab, extra?: Record<string, string>) => void }) {
  const summary = useQuery({ queryKey: keys.adminSummary(slug), queryFn: () => api.staff.summary(slug) });
  const urgent = useQuery({
    queryKey: keys.tasks(slug, { priority: 'urgent', openOnly: true }),
    queryFn: () => api.staff.tasks(slug, { priority: 'urgent', openOnly: true }),
  });
  const staff = useStaffList();

  return (
    <Loadable query={summary}>
      {(s) => (
        <div className="stack">
          <div className="tile-grid">
            <Tile label="Open maintenance tasks" value={s.openTasks} onClick={() => go('maintenance')} />
            <Tile
              label="Urgent"
              value={s.urgentTasks}
              tone={s.urgentTasks ? 'alert' : undefined}
              onClick={() => go('maintenance', { priority: 'urgent' })}
            />
            <Tile
              label="Due for inspection"
              value={s.needsInspection}
              hint="Not inspected in the last year"
              onClick={() => go('benches', { filter: 'inspection' })}
            />
            <Tile
              label="Plaques to install or move"
              value={s.plaquesToInstall}
              onClick={() => go('maintenance', { type: plaqueTaskTypes.join(',') })}
            />
            <Tile
              label="Adoptions ending soon"
              value={s.endingSoon}
              hint="Within 60 days, not renewed"
              onClick={() => go('adoptions')}
            />
            <Tile
              label="Benches"
              value={s.benches.available + s.benches.adopted + s.benches.ending_soon}
              hint={`${s.benches.available} available · ${s.benches.retired} retired`}
              onClick={() => go('benches')}
            />
          </div>

          <section className="card stack">
            <h2>Urgent work</h2>
            <Loadable query={urgent}>
              {({ items: tasks }) =>
                tasks.length === 0 ? (
                  <p className="muted">Nothing urgent. 🎉</p>
                ) : (
                  <ul className="task-list">
                    {tasks.map((t) => (
                      <TaskItem key={t.id} task={t} staff={staff} parkSlug={slug} showBench />
                    ))}
                  </ul>
                )
              }
            </Loadable>
          </section>
        </div>
      )}
    </Loadable>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: 'alert';
  onClick: () => void;
}) {
  return (
    <button type="button" className={`card tile ${tone ?? ''}`} onClick={onClick}>
      <span className="tile-value">{value}</span>
      <span className="tile-label">{label}</span>
      {hint && <span className="muted small">{hint}</span>}
    </button>
  );
}

// ---------------------------------------------------------------- benches

const BENCH_FILTERS = [
  ['all', 'All'],
  ['inspection', 'Due for inspection'],
  ['issues', 'Open issues'],
  ['adopted', 'Adopted'],
  ['retired', 'Retired'],
] as const;
type BenchFilter = (typeof BENCH_FILTERS)[number][0];

function matchesFilter(b: AdminBench, f: BenchFilter): boolean {
  switch (f) {
    case 'inspection':
      return b.needsInspection;
    case 'issues':
      return b.openTasks > 0;
    case 'adopted':
      return b.availability === 'adopted' || b.availability === 'ending_soon';
    case 'retired':
      return b.availability === 'retired';
    default:
      return true;
  }
}

function BenchesTab({ slug }: { slug: string }) {
  const [params, setParams] = useSearchParams();
  const filter = (BENCH_FILTERS.find(([id]) => id === params.get('filter'))?.[0] ?? 'all') as BenchFilter;
  const [search, setSearch] = useState('');
  const benches = useQuery({ queryKey: keys.adminBenches(slug), queryFn: () => api.staff.benches(slug) });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (benches.data ?? []).filter(
      (b) =>
        matchesFilter(b, filter) &&
        (!q || b.code.toLowerCase().includes(q) || b.name.toLowerCase().includes(q) || b.zone.toLowerCase().includes(q)),
    );
  }, [benches.data, filter, search]);

  return (
    <section className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="segmented" role="group" aria-label="Show">
          {BENCH_FILTERS.map(([id, label]) => (
            <button
              key={id}
              aria-pressed={filter === id}
              onClick={() => setParams({ tab: 'benches', filter: id })}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="search"
          aria-label="Search benches"
          placeholder="Search code, name or area"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
        />
      </div>
      <Loadable query={benches}>
        {() => (
          <>
            <p className="muted small">{visible.length} benches</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Bench</th>
                    <th>Area</th>
                    <th>Status</th>
                    <th>Last inspected</th>
                    <th>Open tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <Link to={`/parks/${slug}/admin/benches/${b.code}`}>
                          <strong>{b.code}</strong>
                        </Link>
                        <br />
                        <span className="muted small">{b.name}</span>
                      </td>
                      <td>{b.zone}</td>
                      <td>
                        <StatusBadge availability={b.availability} />
                      </td>
                      <td>
                        {b.lastInspectedOn ? formatDate(b.lastInspectedOn) : <span className="muted">Never</span>}
                        {b.needsInspection && <span className="badge task-open" style={{ marginLeft: 6 }}>Due</span>}
                      </td>
                      <td>{b.openTasks || <span className="muted">–</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Loadable>
    </section>
  );
}

// ---------------------------------------------------------------- maintenance

function MaintenanceTab({ slug }: { slug: string }) {
  const [params, setParams] = useSearchParams();
  const q: MaintenanceQuery = {
    status: (params.get('status') as MaintenanceQuery['status']) ?? undefined,
    type: (params.get('type')?.split(',') as MaintenanceQuery['type']) ?? undefined,
    priority: (params.get('priority') as MaintenanceQuery['priority']) ?? undefined,
    // With no status chosen, show the work that is still to do.
    openOnly: !params.get('status'),
  };
  const tasks = useQuery({ queryKey: keys.tasks(slug, q), queryFn: () => api.staff.tasks(slug, q) });
  const staff = useStaffList();
  const benches = useQuery({ queryKey: keys.adminBenches(slug), queryFn: () => api.staff.benches(slug) });
  const [newFor, setNewFor] = useState('');
  const newBench = benches.data?.find((b) => b.code === newFor.trim().toUpperCase());

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  return (
    <div className="stack">
      <section className="card filters">
        <div className="filter-row">
          <div>
            <label htmlFor="f-status" className="small">Status</label>
            <select id="f-status" value={params.get('status') ?? ''} onChange={(e) => set('status', e.target.value)}>
              <option value="">Still to do</option>
              {maintenanceStatuses.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-type" className="small">Type</label>
            <select id="f-type" value={params.get('type') ?? ''} onChange={(e) => set('type', e.target.value)}>
              <option value="">All types</option>
              <option value={plaqueTaskTypes.join(',')}>Plaque work (install or move)</option>
              {maintenanceTypes.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-priority" className="small">Priority</label>
            <select
              id="f-priority"
              value={params.get('priority') ?? ''}
              onChange={(e) => set('priority', e.target.value)}
            >
              <option value="">Any</option>
              {maintenancePriorities.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="card stack">
        <h2>Tasks</h2>
        <Loadable query={tasks}>
          {(page) =>
            page.items.length === 0 ? (
              <p className="muted">No tasks match.</p>
            ) : (
              <>
                <ul className="task-list">
                  {page.items.map((t) => (
                    <TaskItem key={t.id} task={t} staff={staff} parkSlug={slug} showBench />
                  ))}
                </ul>
                <ShowingSome page={page} noun="tasks" />
              </>
            )
          }
        </Loadable>
      </section>

      <section className="card stack">
        <h2>New task</h2>
        <div style={{ maxWidth: 260 }}>
          <label htmlFor="new-bench">Bench</label>
          <input
            id="new-bench"
            type="text"
            list="all-benches"
            placeholder="e.g. VC-042"
            value={newFor}
            onChange={(e) => setNewFor(e.target.value)}
          />
          <datalist id="all-benches">
            {benches.data?.map((b) => <option key={b.id} value={b.code} />)}
          </datalist>
        </div>
        {newBench ? (
          <NewTaskForm benchId={newBench.id} onCreated={() => setNewFor('')} />
        ) : (
          <p className="muted small">Enter a bench code to add a task to it.</p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- users

function UsersTab() {
  const { isAdmin } = useIsStaff();
  const me = useMe().data;
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const q = { q: search.trim() || undefined, role: role || undefined };
  const users = useQuery({ queryKey: keys.users(q), queryFn: () => api.staff.users(q) });
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: ({ email, role }: { email: string; role: Role }) => api.staff.setRole(email, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.admin }),
  });

  return (
    <section className="card stack">
      <div className="filter-row">
        <div className="grow">
          <label htmlFor="u-search" className="small">Search</label>
          <input
            id="u-search"
            type="search"
            placeholder="Name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="u-role" className="small">Role</label>
          <select id="u-role" value={role} onChange={(e) => setRole(e.target.value as Role | '')}>
            <option value="">Everyone</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r[0]!.toUpperCase() + r.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!isAdmin && <p className="muted small">Only admins can change roles.</p>}
      <ErrorNotice error={change.error} />
      <Loadable query={users}>
        {(page) => (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Joined</th>
                  <th>Active adoptions</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.fullName ?? <span className="muted">No name yet</span>}
                      <br />
                      <a className="small" href={`mailto:${u.email}`}>
                        {u.email}
                      </a>
                    </td>
                    <td>{formatDate(u.createdAt.slice(0, 10))}</td>
                    <td>{u.activeAdoptions}</td>
                    <td>
                      <select
                        aria-label={`Role for ${u.email}`}
                        value={u.role}
                        disabled={!isAdmin || u.id === me?.id || change.isPending}
                        title={u.id === me?.id ? "You can't change your own role" : undefined}
                        onChange={(e) => change.mutate({ email: u.email, role: e.target.value as Role })}
                      >
                        {roles.map((r) => (
                          <option key={r} value={r}>
                            {r[0]!.toUpperCase() + r.slice(1)}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ShowingSome page={page} noun="accounts" />
          </div>
        )}
      </Loadable>
    </section>
  );
}
