import { describe, expect, it } from 'vitest';
import { addDays, addMonths, daysBetween, todayIn } from './dates.ts';

describe('addMonths', () => {
  it('adds whole months', () => {
    expect(addMonths('2026-03-15', 12)).toBe('2027-03-15');
    expect(addMonths('2026-11-01', 3)).toBe('2027-02-01');
  });

  it('clamps to the end of shorter months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2027-12-31', 2)).toBe('2028-02-29');
    expect(addMonths('2026-08-31', 1)).toBe('2026-09-30');
  });
});

describe('addDays / daysBetween', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(daysBetween('2027-01-02', '2026-12-30')).toBe(-3);
  });

  it('is unaffected by daylight saving changes', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
  });
});

describe('todayIn', () => {
  it('uses the park timezone, not UTC', () => {
    // 02:00 UTC on Sep 22 is still the evening of Sep 21 in New York.
    const now = new Date('2026-09-22T02:00:00Z');
    expect(todayIn('America/New_York', now)).toBe('2026-09-21');
    expect(todayIn('UTC', now)).toBe('2026-09-22');
  });
});
