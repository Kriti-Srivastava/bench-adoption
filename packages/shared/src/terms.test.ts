import { describe, expect, it } from 'vitest';
import { termLabel, termsLabel } from './terms.ts';

describe('term labels', () => {
  it('uses years for whole years and months otherwise', () => {
    expect(termLabel(1)).toBe('1 month');
    expect(termLabel(18)).toBe('18 months');
    expect(termLabel(12)).toBe('1 year');
    expect(termLabel(120)).toBe('10 years');
  });

  it('lists choices naturally', () => {
    expect(termsLabel([120])).toBe('10 years');
    expect(termsLabel([12, 24])).toBe('1 year or 2 years');
    expect(termsLabel([1, 12, 24])).toBe('1 month, 1 year or 2 years');
  });
});
