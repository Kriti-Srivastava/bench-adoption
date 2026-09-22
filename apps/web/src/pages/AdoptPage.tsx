import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  addMonths,
  termLabel,
  todayIn,
  type Adoption,
  type BenchDetail,
  type Me,
  type Park,
} from '@bench/shared';
import { api } from '../api.ts';
import { SignInForm } from '../components/SignInForm.tsx';
import { ErrorNotice, Loadable, TermPicker } from '../components/ui.tsx';
import { formatDate } from '../format.ts';
import { keys, useBench, useMe, usePark } from '../queries.ts';

export function AdoptPage() {
  const { slug = '', code = '' } = useParams();
  const location = useLocation();
  const bench = useBench(slug, code);
  const park = usePark(slug);
  const me = useMe();

  return (
    <div className="narrow stack">
      <p className="small">
        <Link to={`/parks/${slug}/benches/${code}`}>← Back to bench {code}</Link>
      </p>
      <h1>Adopt bench {code}</h1>
      <Loadable query={me}>
        {(user) =>
          user ? (
            <Loadable query={bench}>
              {(b) =>
                park.data && <AdoptFlow slug={slug} bench={b} user={user} park={park.data} />
              }
            </Loadable>
          ) : (
            <div className="card">
              <SignInForm
                redirectTo={location.pathname}
                intro="First, tell us your email. We'll send a link that brings you right back here. No password needed."
              />
            </div>
          )
        }
      </Loadable>
    </div>
  );
}

interface Details {
  months: number;
  fullName: string;
  displayName: string;
  dedication: string;
  isAnonymous: boolean;
}

function AdoptFlow({
  slug,
  bench,
  user,
  park,
}: {
  slug: string;
  bench: BenchDetail;
  user: Me;
  park: Park;
}) {
  const [step, setStep] = useState<'details' | 'review' | 'done'>('details');
  const [details, setDetails] = useState<Details>({
    months: park.adoptionTermsMonths[0]!,
    fullName: user.fullName ?? '',
    displayName: user.fullName ?? '',
    dedication: '',
    isAnonymous: false,
  });
  const [result, setResult] = useState<Adoption>();
  const queryClient = useQueryClient();

  const adopt = useMutation({
    mutationFn: async () => {
      if (!user.fullName) await api.updateMe(details.fullName.trim());
      return api.adopt({
        benchId: bench.id,
        months: details.months,
        displayName: details.displayName.trim(),
        dedication: details.dedication.trim() || null,
        isAnonymous: details.isAnonymous,
      });
    },
    onSuccess: (adoption) => {
      setResult(adoption);
      setStep('done');
      for (const key of [keys.bench(slug, bench.code), keys.benches(slug), keys.myAdoptions, keys.me]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });

  if (bench.currentAdoption && step !== 'done') {
    return (
      <p className="notice">
        This bench is already adopted until {formatDate(bench.currentAdoption.endDate)}.{' '}
        <Link to={`/parks/${slug}`}>Find an available bench</Link>.
      </p>
    );
  }

  const today = todayIn(park.timezone);
  const steps = ['Details', 'Review', 'Done'];
  const current = { details: 0, review: 1, done: 2 }[step];

  return (
    <>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s} aria-current={i === current ? 'step' : undefined}>
            {s}
          </li>
        ))}
      </ol>

      {step === 'details' && (
        <DetailsForm
          details={details}
          askFullName={!user.fullName}
          terms={park.adoptionTermsMonths}
          onChange={setDetails}
          onNext={() => setStep('review')}
        />
      )}

      {step === 'review' && (
        <section className="card stack">
          <h2>Review your adoption</h2>
          <dl className="dl">
            <dt>Bench</dt>
            <dd>
              {bench.code} · {bench.name}
            </dd>
            <dt>Length</dt>
            <dd>{termLabel(details.months)}</dd>
            <dt>Period</dt>
            <dd>
              {formatDate(today)} until {formatDate(addMonths(today, details.months))}
            </dd>
            <dt>Shown as</dt>
            <dd>{details.isAnonymous ? 'Anonymous donor' : details.displayName}</dd>
            {details.dedication && (
              <>
                <dt>Dedication</dt>
                <dd>“{details.dedication}”</dd>
              </>
            )}
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </dl>
          <ErrorNotice error={adopt.error} />
          <div className="row">
            <button className="btn" disabled={adopt.isPending} onClick={() => adopt.mutate()}>
              {adopt.isPending ? 'Adopting…' : 'Confirm adoption'}
            </button>
            <button className="btn secondary" onClick={() => setStep('details')}>
              Edit
            </button>
          </div>
        </section>
      )}

      {step === 'done' && result && (
        <section className="card stack">
          <h2>Thank you! 🎉</h2>
          <p>
            You've adopted bench <strong>{result.benchCode}</strong> until{' '}
            <strong>{formatDate(result.endDate)}</strong>. We've emailed you a confirmation, and
            we'll remind you before it ends so you can renew.
          </p>
          <div className="row">
            <Link className="btn" to="/me/benches">
              See my benches
            </Link>
            <Link className="btn secondary" to={`/parks/${slug}/benches/${result.benchCode}`}>
              View the bench
            </Link>
          </div>
        </section>
      )}
    </>
  );
}

function DetailsForm({
  details,
  askFullName,
  terms,
  onChange,
  onNext,
}: {
  details: Details;
  askFullName: boolean;
  terms: number[];
  onChange: (d: Details) => void;
  onNext: () => void;
}) {
  const set = <K extends keyof Details>(key: K, value: Details[K]) =>
    onChange({ ...details, [key]: value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onNext();
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <div>
        <span className="label" style={{ fontWeight: 600 }}>
          Adoption length
        </span>
        <TermPicker value={details.months} onChange={(m) => set('months', m)} options={terms} />
      </div>

      {askFullName && (
        <div>
          <label htmlFor="fullName">
            Your full name <span className="hint">(kept private, for park records)</span>
          </label>
          <input
            id="fullName"
            type="text"
            required
            maxLength={120}
            autoComplete="name"
            value={details.fullName}
            onChange={(e) => set('fullName', e.target.value)}
          />
        </div>
      )}

      <div>
        <label htmlFor="displayName">
          Name shown on the bench page <span className="hint">(e.g. “The Rivera Family”)</span>
        </label>
        <input
          id="displayName"
          type="text"
          required
          maxLength={80}
          value={details.displayName}
          onChange={(e) => set('displayName', e.target.value)}
        />
      </div>

      <div>
        <label htmlFor="dedication">
          Dedication <span className="hint">(optional, up to 280 characters)</span>
        </label>
        <textarea
          id="dedication"
          maxLength={280}
          value={details.dedication}
          onChange={(e) => set('dedication', e.target.value)}
        />
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={details.isAnonymous}
          onChange={(e) => set('isAnonymous', e.target.checked)}
        />
        <span>Show me as “Anonymous donor” instead of my name</span>
      </label>

      <button className="btn">Continue</button>
    </form>
  );
}
