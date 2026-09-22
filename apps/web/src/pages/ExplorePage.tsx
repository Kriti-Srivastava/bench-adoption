import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { BenchAvailability, BenchSummary } from '@bench/shared';
import { ALL_AVAILABILITIES, AVAILABILITY } from '../availability.ts';
import { BenchMap } from '../components/BenchMap.tsx';
import { Loadable, StatusBadge, StatusDot } from '../components/ui.tsx';
import { formatDate } from '../format.ts';
import { useBenches, usePark } from '../queries.ts';

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
              Adopt a bench to support the park and add your own dedication. Zoom into the map
              and tap any bench to see who has adopted it, or adopt one that's available.
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
  const [shown, setShown] = useState<Set<BenchAvailability>>(() => new Set(ALL_AVAILABILITIES));
  const [zone, setZone] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = Object.fromEntries(ALL_AVAILABILITIES.map((a) => [a, 0])) as Record<BenchAvailability, number>;
    for (const b of benches) c[b.availability]++;
    return c;
  }, [benches]);

  // ~500 benches: filtering in the browser is instant and avoids a round trip.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return benches.filter(
      (b) =>
        shown.has(b.availability) &&
        (!zone || b.zone === zone) &&
        (!q || b.code.toLowerCase().includes(q) || b.name.toLowerCase().includes(q)),
    );
  }, [benches, shown, zone, search]);

  // A search that narrows to one bench zooms straight to it.
  useEffect(() => {
    if (search.trim() && visible.length === 1) setSelectedId(visible[0]!.id);
  }, [search, visible]);

  const toggle = (a: BenchAvailability) =>
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return next;
    });

  return (
    <>
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Show benches that are">
          {ALL_AVAILABILITIES.map((a) => (
            <button key={a} type="button" className="chip" aria-pressed={shown.has(a)} onClick={() => toggle(a)}>
              <StatusDot availability={a} />
              {AVAILABILITY[a].label} <span className="muted">{counts[a]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="toolbar">
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
          placeholder="Search by plaque number (e.g. VC-042) or name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="explore">
        <BenchMap parkSlug={slug} benches={visible} selectedId={selectedId} onSelect={setSelectedId} />
        <BenchList slug={slug} benches={visible} total={benches.length} selectedId={selectedId} onSelect={setSelectedId} />
      </div>
    </>
  );
}

function BenchList({
  slug,
  benches,
  total,
  selectedId,
  onSelect,
}: {
  slug: string;
  benches: BenchSummary[];
  total: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const selectedRef = useRef<HTMLLIElement>(null);
  // Keep the selected bench in view when it was picked on the map.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  return (
    <section className="card" aria-label="Bench list">
      <p className="muted small">
        Showing {benches.length} of {total}. Select a bench to find it on the map.
      </p>
      <ul className="bench-list">
        {benches.map((b) => {
          const selected = b.id === selectedId;
          return (
            <li key={b.id} ref={selected ? selectedRef : undefined} aria-current={selected || undefined}>
              <button type="button" className="bench-row" onClick={() => onSelect(b.id)}>
                <span>
                  <span className="code">{b.code}</span> <span>{b.name}</span>
                  {b.currentAdoption && (
                    <span className="muted small">
                      <br />
                      {b.currentAdoption.displayName} · until {formatDate(b.currentAdoption.endDate)}
                    </span>
                  )}
                </span>
                <StatusBadge availability={b.availability} />
              </button>
              {selected && (
                <Link className="small bench-row-link" to={`/parks/${slug}/benches/${b.code}`}>
                  Full details →
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
