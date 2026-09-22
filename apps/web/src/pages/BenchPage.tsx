import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { todayIn, type BenchDetail } from '@bench/shared';
import { api } from '../api.ts';
import { BenchMap } from '../components/BenchMap.tsx';
import { ErrorNotice, Loadable, StatusBadge } from '../components/ui.tsx';
import { formatDate } from '../format.ts';
import { keys, useBench, useMe, usePark } from '../queries.ts';

export function BenchPage() {
  const { slug = '', code = '' } = useParams();
  const bench = useBench(slug, code);
  const park = usePark(slug);

  return (
    <Loadable query={bench}>
      {(b) => (
        <div className="stack">
          <p className="small">
            <Link to={`/parks/${slug}`}>← All benches</Link>
          </p>
          <div className="row">
            <h1 style={{ margin: 0 }}>
              Bench {b.code}
            </h1>
            {b.status === 'retired' ? (
              <span className="badge neutral">Retired</span>
            ) : (
              <StatusBadge adopted={b.currentAdoption !== null} />
            )}
          </div>
          <p className="muted">
            {b.name} · {b.zone}
          </p>

          <div className="two-col">
            <BenchMap parkSlug={slug} benches={[b]} height={320} />
            <div className="stack">
              <AdoptionPanel slug={slug} bench={b} timezone={park.data?.timezone} />
              <StaffBenchTools slug={slug} bench={b} />
            </div>
          </div>
        </div>
      )}
    </Loadable>
  );
}

function AdoptionPanel({
  slug,
  bench,
  timezone,
}: {
  slug: string;
  bench: BenchDetail;
  timezone?: string;
}) {
  const current = bench.currentAdoption;
  const today = timezone ? todayIn(timezone) : undefined;
  const freeNow = today !== undefined && bench.availableFrom <= today;

  if (bench.status === 'retired') {
    return <p className="notice">This bench is no longer part of the adoption program.</p>;
  }

  return (
    <section className="card stack">
      {current ? (
        <>
          <h2>Adopted</h2>
          <dl className="dl">
            <dt>By</dt>
            <dd>{current.displayName}</dd>
            <dt>Since</dt>
            <dd>{formatDate(current.startDate)}</dd>
            <dt>Until</dt>
            <dd>{formatDate(current.endDate)}</dd>
          </dl>
          {current.dedication && <p className="dedication">“{current.dedication}”</p>}
        </>
      ) : (
        <>
          <h2>Available to adopt</h2>
          <p className="muted">
            Adopt this bench for as long as you like, from 1 month to 5 years. Your name or
            dedication will be shown here.
          </p>
        </>
      )}

      {freeNow ? (
        <Link className="btn" to={`/parks/${slug}/benches/${bench.code}/adopt`}>
          Adopt this bench
        </Link>
      ) : (
        <p className="notice small">
          This bench becomes available on <strong>{formatDate(bench.availableFrom)}</strong>.
          Browse <Link to={`/parks/${slug}`}>available benches</Link> to adopt one today.
        </p>
      )}
    </section>
  );
}

/** Retire or restore a bench; only shown to park staff. */
function StaffBenchTools({ slug, bench }: { slug: string; bench: BenchDetail }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const retired = bench.status === 'retired';
  const update = useMutation({
    mutationFn: () => api.staff.updateBench(bench.id, { status: retired ? 'active' : 'retired' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.bench(slug, bench.code) });
      queryClient.invalidateQueries({ queryKey: keys.benches(slug) });
    },
  });

  if (me.data?.role !== 'staff' && me.data?.role !== 'admin') return null;
  return (
    <section className="card stack">
      <h2>Staff</h2>
      <p className="muted small">
        Retired benches are hidden from the public list and can't be adopted.
      </p>
      <ErrorNotice error={update.error} />
      <button
        className={retired ? 'btn secondary' : 'btn danger'}
        disabled={update.isPending}
        onClick={() => update.mutate()}
      >
        {retired ? 'Return bench to the program' : 'Retire this bench'}
      </button>
    </section>
  );
}
