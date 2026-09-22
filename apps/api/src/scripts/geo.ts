/**
 * Small-scale geometry for seeding. Over a park-sized area the earth is
 * flat enough to project lat/lng onto metres directly.
 */
type LatLng = [number, number];

const M_PER_DEG_LAT = 110_540;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

function toMetres([lat, lng]: LatLng, origin: LatLng): [number, number] {
  return [(lng - origin[1]) * mPerDegLng(origin[0]), (lat - origin[0]) * M_PER_DEG_LAT];
}

function segmentLength(a: LatLng, b: LatLng): number {
  const [x, y] = toMetres(b, a);
  return Math.hypot(x, y);
}

/** Distance in metres from a point to the nearest part of a path. */
export function distanceToPath(point: LatLng, path: LatLng[]): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const [bx, by] = toMetres(path[i]!, a);
    const [px, py] = toMetres(point, a);
    const len2 = bx * bx + by * by;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
    best = Math.min(best, Math.hypot(px - t * bx, py - t * by));
  }
  return best;
}

/** `count` points spaced evenly along a path, starting and ending inside it. */
export function pointsAlong(path: LatLng[], count: number): LatLng[] {
  const lengths = path.slice(1).map((p, i) => segmentLength(path[i]!, p));
  const total = lengths.reduce((s, l) => s + l, 0);
  const points: LatLng[] = [];
  for (let k = 0; k < count; k++) {
    let target = ((k + 0.5) / count) * total;
    let i = 0;
    while (i < lengths.length - 1 && target > lengths[i]!) target -= lengths[i++]!;
    const t = lengths[i]! === 0 ? 0 : target / lengths[i]!;
    const a = path[i]!;
    const b = path[i + 1]!;
    points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return points;
}

/** Index of the nearest of `centres` to `point`. */
export function nearest(point: LatLng, centres: LatLng[]): number {
  let best = 0;
  let bestDistance = Infinity;
  centres.forEach((c, i) => {
    const d = segmentLength(point, c);
    if (d < bestDistance) [best, bestDistance] = [i, d];
  });
  return best;
}
