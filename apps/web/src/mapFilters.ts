/**
 * Map filters live in the URL (?trail=john-muir&show=available), so a
 * filtered map can be linked to, bookmarked, and restored with Back.
 */
import { useSearchParams } from 'react-router-dom';
import type { BenchAvailability } from '@bench/shared';
import { ALL_AVAILABILITIES } from './availability.ts';

export interface MapFilters {
  show: Set<BenchAvailability>;
  trail: string | null;
  area: string | null;
  q: string;
}

const isAvailability = (s: string): s is BenchAvailability =>
  (ALL_AVAILABILITIES as readonly string[]).includes(s);

function toParams(f: Partial<MapFilters>): URLSearchParams {
  const p = new URLSearchParams();
  if (f.show && f.show.size < ALL_AVAILABILITIES.length) {
    p.set('show', ALL_AVAILABILITIES.filter((a) => f.show!.has(a)).join(','));
  }
  if (f.trail) p.set('trail', f.trail);
  if (f.area) p.set('area', f.area);
  if (f.q) p.set('q', f.q);
  return p;
}

/** Link to the park map with the given filters applied. */
export function mapUrl(parkSlug: string, f: Partial<MapFilters> = {}): string {
  const q = toParams(f).toString();
  return `/parks/${parkSlug}${q ? `?${q}` : ''}`;
}

export function useMapFilters() {
  const [params, setParams] = useSearchParams();
  const show = params.get('show');
  const filters: MapFilters = {
    show: new Set(show === null ? ALL_AVAILABILITIES : show.split(',').filter(isAvailability)),
    trail: params.get('trail'),
    area: params.get('area'),
    q: params.get('q') ?? '',
  };

  const update = (patch: Partial<MapFilters>) =>
    setParams(toParams({ ...filters, ...patch }), { replace: true });

  const isFiltered =
    filters.show.size < ALL_AVAILABILITIES.length || Boolean(filters.trail || filters.area || filters.q);

  return { filters, update, isFiltered, clear: () => setParams(new URLSearchParams(), { replace: true }) };
}
