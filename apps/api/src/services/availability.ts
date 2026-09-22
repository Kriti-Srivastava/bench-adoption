import type { IsoDate } from '@bench/shared';

interface Period {
  startDate: IsoDate;
  endDate: IsoDate;
}

/**
 * The first date on or after `today` not covered by any of `periods`.
 * Periods are end-exclusive, so a renewal that starts exactly when the
 * previous adoption ends continues the chain without a gap.
 */
export function firstFreeDate(today: IsoDate, periods: Period[]): IsoDate {
  const sorted = [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
  let free = today;
  for (const p of sorted) {
    if (p.startDate > free) break;
    if (p.endDate > free) free = p.endDate;
  }
  return free;
}
