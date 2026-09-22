import 'leaflet/dist/leaflet.css';
import { useMemo } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import { Link } from 'react-router-dom';
import type { BenchSummary } from '@bench/shared';
import { formatDate } from '../format.ts';

const COLORS = { available: '#2f7d4a', adopted: '#c0692a' };

export function BenchMap({
  parkSlug,
  benches,
  height,
}: {
  parkSlug: string;
  benches: BenchSummary[];
  height?: number;
}) {
  const bounds = useMemo(() => {
    const lats = benches.map((b) => b.lat);
    const lngs = benches.map((b) => b.lng);
    return [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ] as [[number, number], [number, number]];
  }, [benches]);

  if (benches.length === 0) return <div className="map notice">No benches match these filters.</div>;

  return (
    <MapContainer
      className="map"
      style={height ? { height } : undefined}
      bounds={bounds}
      boundsOptions={{ padding: [24, 24], maxZoom: 17 }}
      scrollWheelZoom={false}
      // Re-fit when the filtered set changes.
      key={`${bounds.flat().join(',')}`}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {benches.map((b) => {
        const color = b.currentAdoption ? COLORS.adopted : COLORS.available;
        return (
          <CircleMarker
            key={b.id}
            center={[b.lat, b.lng]}
            radius={6}
            pathOptions={{ color: '#ffffff', weight: 1.5, fillColor: color, fillOpacity: 0.95 }}
          >
            <Popup>
              <strong>{b.code}</strong> · {b.name}
              <br />
              {b.currentAdoption
                ? `Adopted by ${b.currentAdoption.displayName} until ${formatDate(b.currentAdoption.endDate)}`
                : 'Available to adopt'}
              <br />
              <Link to={`/parks/${parkSlug}/benches/${b.code}`}>View bench →</Link>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
