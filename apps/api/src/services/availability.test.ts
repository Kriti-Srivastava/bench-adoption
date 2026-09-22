import { describe, expect, it } from 'vitest';
import { firstFreeDate } from './availability.ts';

describe('firstFreeDate', () => {
  it('is today when nothing is booked', () => {
    expect(firstFreeDate('2026-09-21', [])).toBe('2026-09-21');
  });

  it('is the end of the current adoption', () => {
    expect(
      firstFreeDate('2026-09-21', [{ startDate: '2026-01-01', endDate: '2027-01-01' }]),
    ).toBe('2027-01-01');
  });

  it('follows a chain of renewals', () => {
    expect(
      firstFreeDate('2026-09-21', [
        { startDate: '2027-01-01', endDate: '2028-01-01' },
        { startDate: '2026-01-01', endDate: '2027-01-01' },
      ]),
    ).toBe('2028-01-01');
  });

  it('stops at a gap', () => {
    expect(
      firstFreeDate('2026-09-21', [
        { startDate: '2026-01-01', endDate: '2027-01-01' },
        { startDate: '2027-03-01', endDate: '2028-01-01' },
      ]),
    ).toBe('2027-01-01');
  });
});
