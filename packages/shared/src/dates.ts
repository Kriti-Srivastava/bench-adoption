/**
 * Calendar-date helpers. Adoptions are measured in whole days, so dates are
 * plain ISO strings ("2026-09-21") rather than timestamps; this sidesteps
 * timezone drift between the server, the database and the browser.
 */
export type IsoDate = string;

const MS_PER_DAY = 86_400_000;

/** Today's calendar date as seen in the given IANA timezone. */
export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}

function toUtc(date: IsoDate): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

/**
 * Adds calendar months, clamping to the last day of the target month
 * (Jan 31 + 1 month = Feb 28/29, not Mar 3).
 */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const start = toUtc(date);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(start.getUTCDate(), lastDayOfTarget);
  return fromUtc(new Date(Date.UTC(year, month, day)));
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtc(new Date(toUtc(date).getTime() + days * MS_PER_DAY));
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / MS_PER_DAY);
}
