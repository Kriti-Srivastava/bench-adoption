import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addMonths, termLabel, type Adoption, type Me } from '@bench/shared';
import { api } from '../api.ts';
import { SignInForm } from '../components/SignInForm.tsx';
import { StatusPill } from '../components/TaskEditor.tsx';
import { ErrorNotice, Loadable, TermPicker } from '../components/ui.tsx';
import { daysLeftLabel, formatDate, formatPeriod } from '../format.ts';
import { TYPE_LABEL } from '../maintenance.ts';
import { DEFAULT_PARK } from '../format.ts';
import { keys, useIsStaff, useMe, useMyAdoptions, usePark } from '../queries.ts';

export function MyBenchesPage() {
  const me = useMe();
  const { isStaff } = useIsStaff();
  const [params] = useSearchParams();
  const renewId = params.get('renew');
  const adoptions = useMyAdoptions(Boolean(me.data));

  return (
    <div className="stack">
      <h1>My account</h1>
      {isStaff && (
        <p className="notice">
          This is a park-staff account, which looks after benches rather than adopting them. The{' '}
          <Link to={`/parks/${DEFAULT_PARK}/admin`}>Admin area</Link> has your tools. To adopt a
          bench yourself, sign in with a personal email address.
        </p>
      )}
      <Loadable query={me}>
        {(user) =>
          user ? (
            <div className="account">
              <div className="stack">
                <h2>My benches</h2>
                <Loadable query={adoptions}>
                  {(items) => <AdoptionGroups items={items} highlight={renewId} />}
                </Loadable>
              </div>
              <div className="stack">
                <ProfileCard user={user} />
                <MyReports />
              </div>
            </div>
          ) : (
            <div className="card narrow">
              <SignInForm
                redirectTo={`/me/benches${renewId ? `?renew=${renewId}` : ''}`}
                intro="Sign in to see your benches, renew them, and follow problems you've reported."
              />
            </div>
          )
        }
      </Loadable>
    </div>
  );
}

function AdoptionGroups({ items, highlight }: { items: Adoption[]; highlight: string | null }) {
  const active = items.filter((a) => a.status === 'active' && a.daysRemaining > 0);
  const past = items.filter((a) => !active.includes(a));

  if (items.length === 0) {
    return (
      <div className="card stack">
        <p>You haven't adopted a bench yet.</p>
        <Link className="btn" to="/">
          Find a bench to adopt
        </Link>
      </div>
    );
  }

  return (
    <>
      <section className="stack">
        <h3>Current and upcoming</h3>
        {active.length === 0 && <p className="muted">None right now.</p>}
        {active.map((a) => (
          <AdoptionCard key={a.id} adoption={a} startOpen={a.id === highlight} />
        ))}
      </section>
      {past.length > 0 && (
        <section className="stack">
          <h3>Past</h3>
          {past.map((a) => (
            <AdoptionCard key={a.id} adoption={a} startOpen={false} />
          ))}
        </section>
      )}
    </>
  );
}

function AdoptionCard({ adoption: a, startOpen }: { adoption: Adoption; startOpen: boolean }) {
  // The API decides this: it knows the whole rule, including retired benches.
  const canRenew = a.canRenew;
  const [renewing, setRenewing] = useState(startOpen && canRenew);

  return (
    <article className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ margin: 0 }}>
            <Link to={`/parks/${a.parkSlug}/benches/${a.benchCode}`}>Bench {a.benchCode}</Link>
          </h3>
          <p className="muted small" style={{ margin: 0 }}>
            {a.benchName}
          </p>
        </div>
        <span className={a.daysRemaining > 0 && a.status === 'active' ? 'badge available' : 'badge neutral'}>
          {a.status === 'cancelled' ? 'Cancelled' : daysLeftLabel(a.daysRemaining)}
        </span>
      </div>
      <dl className="dl">
        <dt>Period</dt>
        <dd>{formatPeriod(a.startDate, a.endDate)}</dd>
        <dt>Shown as</dt>
        <dd>{a.isAnonymous ? 'Anonymous donor' : a.displayName}</dd>
        {a.dedication && (
          <>
            <dt>Dedication</dt>
            <dd>“{a.dedication}”</dd>
          </>
        )}
      </dl>
      {a.isRenewed && <p className="notice small">Renewed. The next period is listed below.</p>}
      {canRenew &&
        (renewing ? (
          <RenewForm adoption={a} onDone={() => setRenewing(false)} />
        ) : (
          <div>
            <button className="btn secondary" onClick={() => setRenewing(true)}>
              Renew
            </button>
          </div>
        ))}
    </article>
  );
}

function RenewForm({ adoption, onDone }: { adoption: Adoption; onDone: () => void }) {
  const park = usePark(adoption.parkSlug);
  const terms = park.data?.adoptionTermsMonths ?? [];
  const [chosen, setMonths] = useState<number>();
  const months = chosen ?? terms[0];
  const queryClient = useQueryClient();
  const renew = useMutation({
    mutationFn: () => api.renew(adoption.id, months!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.myAdoptions });
      queryClient.invalidateQueries({ queryKey: keys.bench(adoption.parkSlug, adoption.benchCode) });
      onDone();
    },
  });

  return (
    <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
      <strong>Renew your adoption</strong>
      {months === undefined ? (
        <p className="muted small">Loading…</p>
      ) : (
        <>
          <TermPicker value={months} onChange={setMonths} options={terms} />
          <p className="muted small">
            Your renewal continues right after the current period: {formatDate(adoption.endDate)} until{' '}
            {formatDate(addMonths(adoption.endDate, months))} ({termLabel(months)}).
          </p>
        </>
      )}
      <ErrorNotice error={renew.error} />
      <div className="row">
        <button className="btn" disabled={renew.isPending || months === undefined} onClick={() => renew.mutate()}>
          {renew.isPending ? 'Renewing…' : 'Confirm renewal'}
        </button>
        <button className="btn secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ProfileCard({ user }: { user: Me }) {
  const [name, setName] = useState(user.fullName ?? '');
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => api.updateMe(name.trim()),
    onSuccess: (me) => queryClient.setQueryData(keys.me, me),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <section className="card stack">
      <h2>Profile</h2>
      <form className="stack" onSubmit={submit}>
        <div>
          <label htmlFor="profile-name">Full name</label>
          <input
            id="profile-name"
            type="text"
            required
            maxLength={120}
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Signed in as {user.email}
          {user.role !== 'adopter' && ` · ${user.role}`}
        </p>
        <ErrorNotice error={save.error} />
        {save.isSuccess && <p className="notice success small">Saved.</p>}
        <div>
          <button className="btn small" disabled={save.isPending || name.trim() === (user.fullName ?? '')}>
            Save
          </button>
        </div>
      </form>
    </section>
  );
}

function MyReports() {
  const reports = useQuery({ queryKey: keys.myReports, queryFn: api.myReports });
  return (
    <section className="card stack">
      <h2>Problems I've reported</h2>
      <Loadable query={reports}>
        {(items) =>
          items.length === 0 ? (
            <p className="muted small">
              None yet. Spot a broken or dirty bench? Use "Report a problem" on its page.
            </p>
          ) : (
            <ul className="report-list">
              {items.map((r) => (
                <li key={r.id}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <Link to={`/parks/${r.parkSlug}/benches/${r.benchCode}`}>Bench {r.benchCode}</Link>
                    <StatusPill status={r.status} />
                  </div>
                  <span className="muted small">
                    {TYPE_LABEL[r.type]} · {formatDate(r.createdAt.slice(0, 10))}
                  </span>
                  {r.details && <p className="small" style={{ margin: '0.25rem 0 0' }}>{r.details}</p>}
                  {r.resolution && (
                    <p className="small nature-note" style={{ margin: '0.4rem 0 0' }}>
                      <strong>Crew:</strong> {r.resolution}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </Loadable>
    </section>
  );
}
