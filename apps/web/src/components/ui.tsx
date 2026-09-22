import type { ReactNode } from 'react';
import { ApiError } from '../api.ts';

export function StatusBadge({ adopted }: { adopted: boolean }) {
  return adopted ? (
    <span className="badge adopted">Adopted</span>
  ) : (
    <span className="badge available">Available</span>
  );
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

export function TermPicker({
  value,
  onChange,
  options,
}: {
  value: number;
  onChange: (months: number) => void;
  options: readonly number[];
}) {
  const label = (m: number) => (m % 12 === 0 ? `${m / 12} yr` : `${m} mo`);
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
          {label(m)}
        </button>
      ))}
    </div>
  );
}
