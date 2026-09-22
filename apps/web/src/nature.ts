import type { Area, BenchSummary, Park, Trail } from '@bench/shared';

/** Stable small hash so a bench always shows the same fact. */
function hash(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function areaOf(park: Park, bench: BenchSummary): Area | undefined {
  return park.areas.find((a) => a.name === bench.zone);
}

export function trailsOf(park: Park, bench: BenchSummary): Trail[] {
  return park.trails.filter((t) => bench.trails.includes(t.slug));
}

/**
 * One nature or history note for a bench, drawn from its area's facts.
 * Neighbouring benches get different facts, so exploring the map stays interesting.
 */
export function natureNoteFor(park: Park, bench: BenchSummary): string | null {
  const facts = areaOf(park, bench)?.facts ?? [];
  return facts.length ? facts[hash(bench.code) % facts.length]! : null;
}
