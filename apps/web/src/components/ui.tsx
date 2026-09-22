import type { ReactNode } from 'react';
import { termLabel, type BenchAvailability } from '@bench/shared';
import { ApiError } from '../api.ts';
import { AVAILABILITY } from '../availability.ts';

export function StatusBadge({ availability }: { availability: BenchAvailability }) {
  return <span className={`badge ${availability}`}>{AVAILABILITY[availability].label}</span>;
}

/** A colored dot matching the bench's map pin. */
export function StatusDot({ availability }: { availability: BenchAvailability }) {
  return <span className="dot" style={{ background: AVAILABILITY[availability].color }} aria-hidden />;
}

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof ApiError || error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <p className="notice error" role="alert">
      {message}
    </p>
  );
}

/** Renders loading and error states so pages only handle the data case. */
export function Loadable<T>({
  query,
  children,
}: {
  query: { data: T | undefined; error: unknown; isPending: boolean };
  children: (data: T) => ReactNode;
}) {
  if (query.error) return <ErrorNotice error={query.error} />;
  if (query.isPending || query.data === undefined) return <p className="muted">Loading…</p>;
  return <>{children(query.data)}</>;
}

/** Choose among a park's adoption terms; a park with a single term just states it. */
export function TermPicker({
  value,
  onChange,
  options,
}: {
  value: number;
  onChange: (months: number) => void;
  options: readonly number[];
}) {
  if (options.length === 1) {
    return (
      <p className="term-fixed">
        Adoptions last <strong>{termLabel(options[0]!)}</strong>.
      </p>
    );
  }
  return (
    <div className="chips" role="group" aria-label="Adoption length">
      {options.map((m) => (
        <button
          key={m}
          type="button"
          className="chip"
          aria-pressed={value === m}
          onClick={() => onChange(m)}
        >
          {termLabel(m)}
        </button>
      ))}
    </div>
  );
}
