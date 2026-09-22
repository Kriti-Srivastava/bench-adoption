import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import { Link } from 'react-router-dom';
import type { BenchSummary } from '@bench/shared';
import { AVAILABILITY } from '../availability.ts';
import { formatDate } from '../format.ts';
import { StatusBadge } from './ui.tsx';

/** Zoom level used when focusing on a single bench. */
const BENCH_ZOOM = 18;

type Bounds = [[number, number], [number, number]];

function boundsOf(benches: BenchSummary[]): Bounds {
  const lats = benches.map((b) => b.lat);
  const lngs = benches.map((b) => b.lng);
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
}

/**
 * Interactive bench map. Pins are colored by availability; clicking one zooms
 * in and opens its details. Passing `selectedId` (e.g. from a list) does the
 * same from outside the map.
 */
export function BenchMap({
  parkSlug,
  benches,
  selectedId = null,
  onSelect,
  height,
}: {
  parkSlug: string;
  benches: BenchSummary[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  height?: number;
}) {
  const markers = useRef(new Map<string, L.CircleMarker>());
  const bounds = useMemo(() => (benches.length ? boundsOf(benches) : null), [benches]);
  const single = benches.length === 1;

  if (!bounds) return <div className="map notice">No benches match these filters.</div>;

  return (
    <MapContainer
      className="map"
      style={height ? { height } : undefined}
      bounds={bounds}
      boundsOptions={{ padding: [24, 24], maxZoom: single ? BENCH_ZOOM : 17 }}
      maxZoom={19}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      {benches.map((b) => {
        const selected = b.id === selectedId;
        return (
          <CircleMarker
            key={b.id}
            ref={(m) => {
              if (m) markers.current.set(b.id, m);
              else markers.current.delete(b.id);
            }}
            center={[b.lat, b.lng]}
            radius={selected ? 11 : b.availability === 'retired' ? 5 : 7}
            pathOptions={{
              color: selected ? '#1f2a22' : '#ffffff',
              weight: selected ? 3 : 1.5,
              fillColor: AVAILABILITY[b.availability].color,
              fillOpacity: 0.95,
            }}
            eventHandlers={{ click: () => onSelect?.(b.id) }}
          >
            <Popup minWidth={220} maxWidth={280}>
              <BenchPopup parkSlug={parkSlug} bench={b} />
            </Popup>
          </CircleMarker>
        );
      })}
      <FocusSelected benches={benches} selectedId={selectedId} markers={markers.current} />
      {!single && <ShowAllControl bounds={bounds} />}
    </MapContainer>
  );
}

/** Flies to the selected bench and opens its popup. */
function FocusSelected({
  benches,
  selectedId,
  markers,
}: {
  benches: BenchSummary[];
  selectedId: string | null;
  markers: Map<string, L.CircleMarker>;
}) {
  const map = useMap();
  // Read the current benches without re-flying every time the list refreshes.
  const latestBenches = useRef(benches);
  latestBenches.current = benches;

  useEffect(() => {
    const bench = latestBenches.current.find((b) => b.id === selectedId);
    if (!bench) return;
    const openPopup = () => markers.get(bench.id)?.openPopup();
    map.once('moveend', openPopup);
    map.flyTo([bench.lat, bench.lng], Math.max(map.getZoom(), BENCH_ZOOM), { duration: 0.6 });
    return () => {
      map.off('moveend', openPopup);
    };
  }, [selectedId, map, markers]);
  return null;
}

/** A map button that zooms back out to every visible bench. */
function ShowAllControl({ bounds }: { bounds: Bounds }) {
  const map = useMap();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Keep clicks on the button from also clicking the map underneath.
    if (ref.current) L.DomEvent.disableClickPropagation(ref.current);
  }, []);
  return (
    <div className="leaflet-top leaflet-right">
      <div ref={ref} className="leaflet-control leaflet-bar">
        <button
          type="button"
          className="map-control"
          title="Show all benches"
          aria-label="Show all benches"
          onClick={() => map.flyToBounds(bounds, { padding: [24, 24], duration: 0.6 })}
        >
          ⤢
        </button>
      </div>
    </div>
  );
}

function BenchPopup({ parkSlug, bench: b }: { parkSlug: string; bench: BenchSummary }) {
  const a = b.currentAdoption;
  const benchUrl = `/parks/${parkSlug}/benches/${b.code}`;
  return (
    <div className="bench-popup">
      <div className="bench-popup-head">
        <strong>{b.code}</strong>
        <StatusBadge availability={b.availability} />
      </div>
      <div className="muted small">
        {b.name} · {b.zone}
      </div>

      {a && (
        <dl className="dl small">
          <dt>Adopted by</dt>
          <dd>{a.displayName}</dd>
          <dt>Since</dt>
          <dd>{formatDate(a.startDate)}</dd>
          <dt>Until</dt>
          <dd>{formatDate(a.endDate)}</dd>
        </dl>
      )}
      {a?.dedication && <p className="dedication small">“{a.dedication}”</p>}

      <p className="small">
        {b.availability === 'available' && 'Free to adopt today.'}
        {b.availability === 'ending_soon' && a && `Becomes available on ${formatDate(a.endDate)}.`}
        {b.availability === 'retired' && 'No longer part of the adoption program.'}
      </p>

      <div className="row">
        {b.availability === 'available' && (
          <Link className="btn small" to={`${benchUrl}/adopt`}>
            Adopt this bench
          </Link>
        )}
        <Link className="small" to={benchUrl}>
          Full details →
        </Link>
      </div>
    </div>
  );
}
