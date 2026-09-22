import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { Link } from 'react-router-dom';
import type { BenchSummary, Park, Trail } from '@bench/shared';
import { AVAILABILITY } from '../availability.ts';
import { formatDate } from '../format.ts';
import { natureNoteFor, trailsOf } from '../nature.ts';
import { StatusBadge } from './ui.tsx';

/** Zoom level used when focusing on a single bench. */
const BENCH_ZOOM = 18;
const PADDING: L.PointTuple = [24, 24];

type Bounds = [[number, number], [number, number]];

function boundsOf(points: [number, number][]): Bounds {
  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
}

/**
 * Interactive bench map. Pins are colored by availability and trails are
 * drawn as lines. Clicking a pin zooms in and opens its details; clicking a
 * trail selects it. `selectedId` / `selectedTrail` do the same from outside.
 */
export function BenchMap({
  park,
  benches,
  selectedId = null,
  onSelect,
  selectedTrail = null,
  onSelectTrail,
  height,
}: {
  park: Park;
  benches: BenchSummary[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  selectedTrail?: string | null;
  onSelectTrail?: (slug: string) => void;
  height?: number;
}) {
  const markers = useRef(new Map<string, L.CircleMarker>());
  const bounds = useMemo(
    () => (benches.length ? boundsOf(benches.map((b) => [b.lat, b.lng])) : null),
    [benches],
  );
  const single = benches.length === 1;
  const trail = park.trails.find((t) => t.slug === selectedTrail);

  if (!bounds) return <div className="map notice">No benches match these filters.</div>;

  return (
    <MapContainer
      className="map"
      style={height ? { height } : undefined}
      bounds={trail ? boundsOf(trail.path) : bounds}
      boundsOptions={{ padding: PADDING, maxZoom: single ? BENCH_ZOOM : 17 }}
      maxZoom={19}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      {park.trails.map((t) => (
        <TrailLine key={t.slug} trail={t} selected={t.slug === selectedTrail} onSelect={onSelectTrail} />
      ))}
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
            <Popup minWidth={240} maxWidth={300}>
              <BenchPopup park={park} bench={b} />
            </Popup>
          </CircleMarker>
        );
      })}
      <FocusSelected benches={benches} selectedId={selectedId} markers={markers.current} />
      <FitTrail trail={trail} />
      {!single && <ShowAllControl bounds={bounds} />}
    </MapContainer>
  );
}

function TrailLine({
  trail,
  selected,
  onSelect,
}: {
  trail: Trail;
  selected: boolean;
  onSelect?: (slug: string) => void;
}) {
  return (
    <Polyline
      positions={trail.path}
      pathOptions={
        selected
          ? { color: '#1d4ed8', weight: 6, opacity: 0.9 }
          : { color: '#6b5a3a', weight: 3, opacity: 0.55, dashArray: '6 6' }
      }
      eventHandlers={{ click: () => onSelect?.(trail.slug) }}
    >
      <Tooltip sticky>{trail.name}</Tooltip>
    </Polyline>
  );
}

/** Zooms to a trail whenever a different one is selected. */
function FitTrail({ trail }: { trail: Trail | undefined }) {
  const map = useMap();
  const slug = trail?.slug;
  const latestTrail = useRef(trail);
  latestTrail.current = trail;
  useEffect(() => {
    if (latestTrail.current) map.flyToBounds(boundsOf(latestTrail.current.path), { padding: PADDING, duration: 0.6 });
  }, [slug, map]);
  return null;
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
          onClick={() => map.flyToBounds(bounds, { padding: PADDING, duration: 0.6 })}
        >
          ⤢
        </button>
      </div>
    </div>
  );
}

function BenchPopup({ park, bench: b }: { park: Park; bench: BenchSummary }) {
  const a = b.currentAdoption;
  const benchUrl = `/parks/${park.slug}/benches/${b.code}`;
  const note = natureNoteFor(park, b);
  const trails = trailsOf(park, b);
  return (
    <div className="bench-popup">
      <div className="bench-popup-head">
        <strong>{b.code}</strong>
        <StatusBadge availability={b.availability} />
      </div>
      <div className="muted small">
        {b.name} · {b.zone}
        {trails.length > 0 && <> · on {trails.map((t) => t.name).join(', ')}</>}
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

      {note && (
        <p className="nature-note small">
          <span aria-hidden>🌿 </span>
          <strong>Nature note:</strong> {note}
        </p>
      )}

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
