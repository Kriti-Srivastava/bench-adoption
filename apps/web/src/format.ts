import type { IsoDate } from '@bench/shared';

export const DEFAULT_PARK: string = import.meta.env.VITE_DEFAULT_PARK ?? 'van-cortlandt';

/** "Sep 21, 2027". Dates are calendar dates, so format them without a timezone shift. */
export function formatDate(iso: IsoDate): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatPeriod(start: IsoDate, end: IsoDate): string {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

export function daysLeftLabel(n: number): string {
  if (n <= 0) return 'Ended';
  if (n === 1) return 'Ends tomorrow';
  if (n < 60) return `${n} days left`;
  return `${Math.round(n / 30)} months left`;
}

