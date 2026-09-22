import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addMonths, SUGGESTED_TERMS_MONTHS, type Adoption } from '@bench/shared';
import { api } from '../api.ts';
import { SignInForm } from '../components/SignInForm.tsx';
import { ErrorNotice, Loadable, TermPicker } from '../components/ui.tsx';
import { daysLeftLabel, formatDate, formatPeriod, pluralMonths } from '../format.ts';
import { keys, useMe, useMyAdoptions } from '../queries.ts';

export function MyBenchesPage() {
  const me = useMe();
  const [params] = useSearchParams();
  const renewId = params.get('renew');
  const adoptions = useMyAdoptions(Boolean(me.data));

  return (
    <div className="stack">
      <h1>My benches</h1>
      <Loadable query={me}>
        {(user) =>
          user ? (
            <Loadable query={adoptions}>
              {(items) => <AdoptionGroups items={items} highlight={renewId} />}
            </Loadable>
          ) : (
            <div className="card narrow">
              <SignInForm
                redirectTo={`/me/benches${renewId ? `?renew=${renewId}` : ''}`}
                intro="Sign in to see and renew your benches."
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
        <h2>Current and upcoming</h2>
        {active.length === 0 && <p className="muted">None right now.</p>}
        {active.map((a) => (
          <AdoptionCard key={a.id} adoption={a} startOpen={a.id === highlight} />
        ))}
      </section>
      {past.length > 0 && (
        <section className="stack">
          <h2>Past</h2>
          {past.map((a) => (
            <AdoptionCard key={a.id} adoption={a} startOpen={false} />
          ))}
        </section>
      )}
    </>
  );
}

function AdoptionCard({ adoption: a, startOpen }: { adoption: Adoption; startOpen: boolean }) {
  const canRenew = a.status === 'active' && a.daysRemaining > 0 && !a.isRenewed;
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
  const [months, setMonths] = useState(12);
  const queryClient = useQueryClient();
  const renew = useMutation({
    mutationFn: () => api.renew(adoption.id, months),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.myAdoptions });
      queryClient.invalidateQueries({ queryKey: keys.bench(adoption.parkSlug, adoption.benchCode) });
      onDone();
    },
  });

  return (
    <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
      <strong>Renew for how long?</strong>
      <TermPicker value={months} onChange={setMonths} options={SUGGESTED_TERMS_MONTHS} />
      <p className="muted small">
        Your renewal continues right after the current period: {formatDate(adoption.endDate)} until{' '}
        {formatDate(addMonths(adoption.endDate, months))} ({pluralMonths(months)}).
      </p>
      <ErrorNotice error={renew.error} />
      <div className="row">
        <button className="btn" disabled={renew.isPending} onClick={() => renew.mutate()}>
          {renew.isPending ? 'Renewing…' : 'Confirm renewal'}
        </button>
        <button className="btn secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
