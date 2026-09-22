import { Link } from 'react-router-dom';
import type { BenchSummary, Park } from '@bench/shared';
import { Loadable } from '../components/ui.tsx';
import { DEFAULT_PARK } from '../format.ts';
import { mapUrl } from '../mapFilters.ts';
import { useBenches, useMe, usePark } from '../queries.ts';

/** Landing page: what the program is, how it works, and ways into the map. */
export function HomePage() {
  const park = usePark(DEFAULT_PARK);
  const benches = useBenches(DEFAULT_PARK);
  const me = useMe();

  return (
    <Loadable query={park}>
      {(p) => (
        <div className="home">
          <section className="hero">
            <p className="eyebrow">{p.name} · Bench Adoption Program</p>
            <h1>Leave your mark on the park you love.</h1>
            <p className="lead">
              Adopt one of {p.name}'s benches for yourself, your family, or someone you want to
              remember. Your dedication is shown to everyone who stops to rest.
            </p>
            <div className="row">
              <Link className="btn" to={mapUrl(p.slug)}>
                Explore the bench map
              </Link>
              <Link className="btn secondary" to={mapUrl(p.slug, { show: new Set(['available']) })}>
                See available benches
              </Link>
            </div>
            {benches.data && <Stats benches={benches.data} park={p} />}
          </section>

          <section className="stack" aria-labelledby="how">
            <h2 id="how">How it works</h2>
            <ol className="steps-grid">
              <li className="card">
                <span className="step-num">1</span>
                <h3>Find a bench</h3>
                <p className="muted">
                  Browse the map, follow a trail, or scan the QR code on any bench plaque.
                </p>
              </li>
              <li className="card">
                <span className="step-num">2</span>
                <h3>Adopt it</h3>
                <p className="muted">
                  Choose how long (1 month to 5 years), add a name and an optional dedication.
                  Just an email, no password needed.
                </p>
              </li>
              <li className="card">
                <span className="step-num">3</span>
                <h3>Renew anytime</h3>
                <p className="muted">
                  We'll remind you before it ends. Renewing keeps your dedication in place.
                </p>
              </li>
            </ol>
          </section>

          <TrailsSection park={p} benches={benches.data ?? []} />

          <section className="stack" aria-labelledby="areas">
            <h2 id="areas">Explore by area</h2>
            <div className="chips">
              {p.areas.map((a) => (
                <Link key={a.name} className="chip" to={mapUrl(p.slug, { area: a.name })} title={a.description ?? undefined}>
                  {a.name}
                </Link>
              ))}
            </div>
          </section>

          <section className="card cta">
            {me.data ? (
              <>
                <h2>Welcome back{me.data.fullName ? `, ${me.data.fullName.split(' ')[0]}` : ''}</h2>
                <p className="muted">See your benches, check when they end, and renew in one click.</p>
                <Link className="btn" to="/me/benches">
                  Go to my benches
                </Link>
              </>
            ) : (
              <>
                <h2>Already a donor?</h2>
                <p className="muted">Sign in to see your benches and renew them.</p>
                <Link className="btn secondary" to="/sign-in?redirectTo=%2Fme%2Fbenches">
                  Sign in
                </Link>
              </>
            )}
          </section>
        </div>
      )}
    </Loadable>
  );
}

function Stats({ benches, park }: { benches: BenchSummary[]; park: Park }) {
  const available = benches.filter((b) => b.availability === 'available').length;
  const adopted = benches.filter((b) => b.availability === 'adopted' || b.availability === 'ending_soon').length;
  return (
    <dl className="hero-stats">
      <div>
        <dt>Benches</dt>
        <dd>{benches.filter((b) => b.availability !== 'retired').length}</dd>
      </div>
      <div>
        <dt>Available now</dt>
        <dd>{available}</dd>
      </div>
      <div>
        <dt>Adopted</dt>
        <dd>{adopted}</dd>
      </div>
      <div>
        <dt>Trails</dt>
        <dd>{park.trails.length}</dd>
      </div>
    </dl>
  );
}

function TrailsSection({ park, benches }: { park: Park; benches: BenchSummary[] }) {
  if (park.trails.length === 0) return null;
  return (
    <section className="stack" aria-labelledby="trails">
      <h2 id="trails">Benches along the trails</h2>
      <div className="trail-grid">
        {park.trails.map((t) => {
          const onTrail = benches.filter((b) => b.trails.includes(t.slug));
          const available = onTrail.filter((b) => b.availability === 'available').length;
          return (
            <Link key={t.slug} to={mapUrl(park.slug, { trail: t.slug })} className="card trail-tile">
              <h3>{t.name}</h3>
              <p className="muted small">
                {t.lengthMiles && `${t.lengthMiles} mi · `}
                {onTrail.length} benches · {available} available
              </p>
              {t.description && <p className="small">{t.description}</p>}
              <span className="small tile-link">View on map →</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
