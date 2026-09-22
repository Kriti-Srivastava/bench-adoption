import { Link, useParams } from 'react-router-dom';
import type { BenchDetail, Park } from '@bench/shared';
import { BenchMap } from '../components/BenchMap.tsx';
import { ReportProblem } from '../components/ReportProblem.tsx';
import { Loadable, StatusBadge } from '../components/ui.tsx';
import { formatDate } from '../format.ts';
import { mapUrl } from '../mapFilters.ts';
import { areaOf, trailsOf } from '../nature.ts';
import { useBench, useIsStaff, usePark } from '../queries.ts';

export function BenchPage() {
  const { slug = '', code = '' } = useParams();
  const bench = useBench(slug, code);
  const park = usePark(slug);

  return (
    <Loadable query={bench}>
      {(b) => (
        <div className="stack">
          <nav className="breadcrumbs small" aria-label="Breadcrumb">
            <Link to="/">Home</Link>
            <span aria-hidden>›</span>
            <Link to={mapUrl(slug)}>Map</Link>
            <span aria-hidden>›</span>
            <Link to={mapUrl(slug, { area: b.zone })}>{b.zone}</Link>
            <span aria-hidden>›</span>
            <span aria-current="page">{b.code}</span>
          </nav>
          <div className="row">
            <h1 style={{ margin: 0 }}>Bench {b.code}</h1>
            <StatusBadge availability={b.availability} />
          </div>
          <p className="muted">
            {b.name} · {b.zone}
          </p>

          {/* On phones the adopt panel follows the map; on desktop it sits alongside. */}
          <div className="bench-layout">
            <div className="bench-layout-map">
              {park.data && <BenchMap park={park.data} benches={[b]} height={320} />}
            </div>
            <div className="bench-layout-side stack">
              <AdoptionPanel slug={slug} bench={b} />
              <ReportProblem benchId={b.id} />
              <StaffBenchTools slug={slug} bench={b} />
            </div>
            <div className="bench-layout-about">
              {park.data && <AboutThisSpot park={park.data} bench={b} />}
            </div>
          </div>
        </div>
      )}
    </Loadable>
  );
}

/** The bench's area and trails, with their nature and history notes. */
function AboutThisSpot({ park, bench }: { park: Park; bench: BenchDetail }) {
  const area = areaOf(park, bench);
  const trails = trailsOf(park, bench);
  if (!area?.description && !area?.facts.length && trails.length === 0) return null;
  return (
    <section className="card stack">
      <h2>About this spot</h2>
      {area?.description && <p style={{ margin: 0 }}>{area.description}</p>}
      {area && area.facts.length > 0 && (
        <ul className="facts">
          {area.facts.map((f) => (
            <li key={f}>🌿 {f}</li>
          ))}
        </ul>
      )}
      {trails.length > 0 && (
        <p className="small" style={{ margin: 0 }}>
          Along{' '}
          {trails.map((t, i) => (
            <span key={t.slug}>
              {i > 0 && ', '}
              <Link to={mapUrl(park.slug, { trail: t.slug })}>{t.name}</Link>
            </span>
          ))}
          . See every bench on {trails.length === 1 ? 'this trail' : 'these trails'}.
        </p>
      )}
    </section>
  );
}

function AdoptionPanel({ slug, bench }: { slug: string; bench: BenchDetail }) {
  const current = bench.currentAdoption;

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
          {bench.availability === 'ending_soon' && (
            <p className="notice small">
              This adoption ends soon and hasn't been renewed yet.
            </p>
          )}
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

      {bench.availability === 'available' ? (
        <Link className="btn" to={`/parks/${slug}/benches/${bench.code}/adopt`}>
          Adopt this bench
        </Link>
      ) : (
        <p className="notice small">
          This bench becomes available on <strong>{formatDate(bench.availableFrom)}</strong>.
          Browse <Link to={mapUrl(slug, { show: new Set(['available']) })}>available benches</Link> to adopt one today.
        </p>
      )}
    </section>
  );
}

/** A shortcut for park staff to this bench's admin page. */
function StaffBenchTools({ slug, bench }: { slug: string; bench: BenchDetail }) {
  const { isStaff } = useIsStaff();
  if (!isStaff) return null;
  return (
    <Link className="btn secondary small" to={`/parks/${slug}/admin/benches/${bench.code}`}>
      Manage this bench (staff)
    </Link>
  );
}
