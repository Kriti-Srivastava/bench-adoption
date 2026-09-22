import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import { neutralize, toCsv } from './csv.ts';

describe('CSV export', () => {
  it.each(['=HYPERLINK("http://evil","x")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1'])(
    'neutralises formula-like text: %j',
    (text) => {
      expect(neutralize(text)).toBe(`'${text}`);
    },
  );

  it('leaves ordinary text, numbers and empties alone', () => {
    expect(neutralize('For Nana')).toBe('For Nana');
    expect(neutralize('Ana-Maria')).toBe('Ana-Maria');
    expect(neutralize(-5)).toBe('-5');
    expect(neutralize(null)).toBe('');
  });

  it('produces valid CSV that round-trips, with quotes and commas intact', () => {
    const csv = toCsv([{ name: 'The "Smith", family', dedication: '=cmd' }]);
    expect(parse(csv, { columns: true })).toEqual([{ name: 'The "Smith", family', dedication: "'=cmd" }]);
  });
});
