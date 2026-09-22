/**
 * The only way the API writes CSV. Spreadsheet apps treat a cell starting
 * with = + - @ (or a tab / carriage return) as a formula, so text a donor
 * typed (a dedication, a display name) could run as a formula on a staff
 * member's computer ("CSV injection", OWASP). Such cells are prefixed with a
 * single quote, which spreadsheets display as plain text.
 *
 * This is output encoding, like HTML escaping: stored data stays exactly as
 * entered (a name like "-Ana-" is legitimate); only the CSV rendering changes.
 */
import { stringify } from 'csv-stringify/sync';

type Cell = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

/** Makes one cell safe to open in a spreadsheet. Numbers and booleans are data, not text. */
export function neutralize(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return String(value);
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** Renders rows as CSV with a header line taken from the first row's keys. */
export function toCsv(rows: Record<string, Cell>[]): string {
  const safe = rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, neutralize(v)])));
  return stringify(safe, { header: true });
}
