import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { BenchAvailability, BenchSummary, Park, Trail } from '@bench/shared';
import { ALL_AVAILABILITIES, AVAILABILITY } from '../availability.ts';
import { BenchMap } from '../components/BenchMap.tsx';
import { Loadable, StatusBadge, StatusDot } from '../components/ui.tsx';
import { formatDate } from '../format.ts';
import { useMapFilters, type MapFilters } from '../mapFilters.ts';
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
            <h1>Bench map</h1>
            <p className="muted">
              Zoom in and tap any bench to see who has adopted it and discover something about the
              nature around it. Pick a trail to see the benches along it.
            </p>
          </div>
          <Loadable query={benches}>{(all) => <BenchExplorer park={p} benches={all} />}</Loadable>
        </div>
      )}
    </Loadable>
  );
}

function countBy(benches: BenchSummary[]): Record<BenchAvailability, number> {
  const c = Object.fromEntries(ALL_AVAILABILITIES.map((a) => [a, 0])) as Record<BenchAvailability, number>;
  for (const b of benches) c[b.availability]++;
  return c;
}

function BenchExplorer({ park, benches }: { park: Park; benches: BenchSummary[] }) {
  const { filters, update, isFiltered, clear } = useMapFilters();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const trail = park.trails.find((t) => t.slug === filters.trail);

  // Everything except the status filter, so the chips can show what each would add.
  const inScope = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return benches.filter(
      (b) =>
        (!filters.trail || b.trails.includes(filters.trail)) &&
        (!filters.area || b.zone === filters.area) &&
        (!q || b.code.toLowerCase().includes(q) || b.name.toLowerCase().includes(q)),
    );
  }, [benches, filters.trail, filters.area, filters.q]);
  const visible = useMemo(() => inScope.filter((b) => filters.show.has(b.availability)), [inScope, filters.show]);
  const counts = useMemo(() => countBy(inScope), [inScope]);

  // A search that narrows to one bench zooms straight to it.
  useEffect(() => {
    if (filters.q.trim() && visible.length === 1) setSelectedId(visible[0]!.id);
  }, [filters.q, visible]);

  const toggle = (a: BenchAvailability) => {
    const next = new Set(filters.show);
    if (next.has(a)) next.delete(a);
    else next.add(a);
    update({ show: next });
  };

  return (
    <>
      <FilterPanel
        park={park}
        filters={filters}
        counts={counts}
        onToggle={toggle}
        onChange={update}
        onClear={isFiltered ? clear : undefined}
      />
      {trail && <TrailCard trail={trail} counts={counts} onClose={() => update({ trail: null })} />}

      <div className="explore">
        <BenchMap
          park={park}
          benches={visible}
          selectedId={selectedId}
          onSelect={setSelectedId}
          selectedTrail={filters.trail}
          onSelectTrail={(slug) => update({ trail: slug })}
        />
        <BenchList
          parkSlug={park.slug}
          benches={visible}
          total={benches.length}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
    </>
  );
}

function FilterPanel({
  park,
  filters,
  counts,
  onToggle,
  onChange,
  onClear,
}: {
  park: Park;
  filters: MapFilters;
  counts: Record<BenchAvailability, number>;
  onToggle: (a: BenchAvailability) => void;
  onChange: (patch: Partial<MapFilters>) => void;
  onClear?: () => void;
}) {
  return (
    <section className="card filters" aria-label="Filters">
      <div className="chips" role="group" aria-label="Show benches that are">
        {ALL_AVAILABILITIES.map((a) => (
          <button
            key={a}
            type="button"
            className="chip"
            aria-pressed={filters.show.has(a)}
            onClick={() => onToggle(a)}
          >
            <StatusDot availability={a} />
            {AVAILABILITY[a].label} <span className="muted">{counts[a]}</span>
          </button>
        ))}
      </div>
      <div className="filter-row">
        <div>
          <label htmlFor="trail" className="small">
            Trail
          </label>
          <select
            id="trail"
            value={filters.trail ?? ''}
            onChange={(e) => onChange({ trail: e.target.value || null })}
          >
            <option value="">All trails</option>
            {park.trails.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="area" className="small">
            Area
          </label>
          <select
            id="area"
            value={filters.area ?? ''}
            onChange={(e) => onChange({ area: e.target.value || null })}
          >
            <option value="">All areas</option>
            {park.areas.map((a) => (
              <option key={a.name}>{a.name}</option>
            ))}
          </select>
        </div>
        <div className="grow">
          <label htmlFor="search" className="small">
            Search
          </label>
          <input
            id="search"
            type="search"
            placeholder="Plaque number (e.g. VC-042) or name"
            value={filters.q}
            onChange={(e) => onChange({ q: e.target.value })}
          />
        </div>
        {onClear && (
          <button type="button" className="btn secondary small" onClick={onClear}>
            Clear filters
          </button>
        )}
      </div>
    </section>
  );
}

function TrailCard({
  trail,
  counts,
  onClose,
}: {
  trail: Trail;
  counts: Record<BenchAvailability, number>;
  onClose: () => void;
}) {
  const total = ALL_AVAILABILITIES.reduce((s, a) => s + counts[a], 0);
  return (
    <section className="card trail-card stack" aria-label={trail.name}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0 }}>{trail.name}</h2>
          <p className="muted small" style={{ margin: 0 }}>
            {trail.lengthMiles && `${trail.lengthMiles} miles · `}
            {total} benches · {counts.available} available to adopt
          </p>
        </div>
        <button type="button" className="btn secondary small" onClick={onClose}>
          Show all trails
        </button>
      </div>
      {trail.description && <p style={{ margin: 0 }}>{trail.description}</p>}
      {trail.facts.length > 0 && (
        <ul className="facts">
          {trail.facts.map((f) => (
            <li key={f}>🌿 {f}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BenchList({
  parkSlug,
  benches,
  total,
  selectedId,
  onSelect,
}: {
  parkSlug: string;
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
                <Link className="small bench-row-link" to={`/parks/${parkSlug}/benches/${b.code}`}>
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
