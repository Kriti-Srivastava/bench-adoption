import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { BenchSummary } from '@bench/shared';
import { BenchMap } from '../components/BenchMap.tsx';
import { Loadable, StatusBadge } from '../components/ui.tsx';
import { formatDate } from '../format.ts';
import { useBenches, usePark } from '../queries.ts';

type Filter = 'all' | 'available' | 'adopted';

export function ExplorePage() {
  const { slug = '' } = useParams();
  const park = usePark(slug);
  const benches = useBenches(slug);

  return (
    <Loadable query={park}>
      {(p) => (
        <div className="stack">
          <div>
            <h1>{p.name} benches</h1>
            <p className="muted">
              Adopt a bench to support the park and add your own dedication. Tap any bench to see
              who has adopted it, or adopt one that's available.
            </p>
          </div>
          <Loadable query={benches}>
            {(all) => <BenchExplorer slug={slug} zones={p.zones} benches={all} />}
          </Loadable>
        </div>
      )}
    </Loadable>
  );
}

function BenchExplorer({
  slug,
  zones,
  benches,
}: {
  slug: string;
  zones: string[];
  benches: BenchSummary[];
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [zone, setZone] = useState('');
  const [search, setSearch] = useState('');

  // ~500 benches: filtering in the browser is instant and avoids a round trip.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return benches.filter(
      (b) =>
        (filter === 'all' || (filter === 'adopted') === (b.currentAdoption !== null)) &&
        (!zone || b.zone === zone) &&
        (!q || b.code.toLowerCase().includes(q) || b.name.toLowerCase().includes(q)),
    );
  }, [benches, filter, zone, search]);

  const adopted = benches.filter((b) => b.currentAdoption).length;

  return (
    <>
      <div className="stats">
        <div className="card stat">
          <div className="value">{benches.length}</div>
          <div className="label">Benches</div>
        </div>
        <div className="card stat">
          <div className="value">{benches.length - adopted}</div>
          <div className="label">Available</div>
        </div>
        <div className="card stat">
          <div className="value">{adopted}</div>
          <div className="label">Adopted</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Show">
          {(['all', 'available', 'adopted'] as const).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f[0]!.toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <label className="visually-hidden" htmlFor="zone">
          Area
        </label>
        <select id="zone" value={zone} onChange={(e) => setZone(e.target.value)}>
          <option value="">All areas</option>
          {zones.map((z) => (
            <option key={z}>{z}</option>
          ))}
        </select>
        <label className="visually-hidden" htmlFor="search">
          Search
        </label>
        <input
          id="search"
          type="search"
          placeholder="Search by plaque number or name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="explore">
        <div className="stack">
          <BenchMap parkSlug={slug} benches={visible} />
          <div className="legend">
            <span>
              <span className="dot available" />
              Available
            </span>
            <span>
              <span className="dot adopted" />
              Adopted
            </span>
          </div>
        </div>
        <section className="card" aria-label="Bench list">
          <p className="muted small">
            Showing {visible.length} of {benches.length}
          </p>
          <ul className="bench-list">
            {visible.map((b) => (
              <li key={b.id}>
                <Link to={`/parks/${slug}/benches/${b.code}`}>
                  <span>
                    <span className="code">{b.code}</span> <span>{b.name}</span>
                    {b.currentAdoption && (
                      <span className="muted small">
                        <br />
                        {b.currentAdoption.displayName} · until {formatDate(b.currentAdoption.endDate)}
                      </span>
                    )}
                  </span>
                  <StatusBadge adopted={b.currentAdoption !== null} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
