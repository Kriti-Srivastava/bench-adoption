import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { AdminBench, RetireBenchInput } from '@bench/shared';
import { api } from '../api.ts';
import { formatDate } from '../format.ts';
import { ErrorNotice } from './ui.tsx';

type Choice = RetireBenchInput['adoption'];

/**
 * Retiring a bench, with an explicit decision about its adoption. The three
 * choices mirror real park practice: honour the term, end it, or move the
 * plaque to another bench.
 */
export function RetirePanel({
  bench,
  availableCodes,
  onDone,
}: {
  bench: AdminBench;
  availableCodes: string[];
  onDone: () => void;
}) {
  const adoption = bench.currentAdoption;
  const [choice, setChoice] = useState<Choice>('keep');
  const [relocateTo, setRelocateTo] = useState('');
  const [reason, setReason] = useState('');
  const queryClient = useQueryClient();

  const retire = useMutation({
    mutationFn: () =>
      api.staff.retire(bench.id, {
        adoption: adoption ? choice : 'keep',
        relocateTo: choice === 'relocate' ? relocateTo.trim().toUpperCase() : undefined,
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      // Public pages show retirements too, so refresh everything.
      queryClient.invalidateQueries();
      onDone();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    retire.mutate();
  };

  return (
    <form className="stack retire-panel" onSubmit={submit}>
      <div>
        <label htmlFor="retire-reason">Reason (optional, shared with the donor)</label>
        <input
          id="retire-reason"
          type="text"
          maxLength={500}
          placeholder="e.g. damaged beyond repair, path reconstruction"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      {adoption ? (
        <fieldset className="stack">
          <legend>
            This bench is adopted by <strong>{adoption.displayName}</strong> until{' '}
            {formatDate(adoption.endDate)}. What should happen to the adoption?
          </legend>
          <label className="checkbox">
            <input type="radio" name="choice" checked={choice === 'keep'} onChange={() => setChoice('keep')} />
            <span>
              <strong>Keep it until it ends.</strong> The dedication stays; it can't be renewed.
            </span>
          </label>
          <label className="checkbox">
            <input type="radio" name="choice" checked={choice === 'relocate'} onChange={() => setChoice('relocate')} />
            <span>
              <strong>Move it to another bench.</strong> The adoption and its end date carry over, and a task
              is created to move the plaque. The donor is emailed.
            </span>
          </label>
          {choice === 'relocate' && (
            <div className="indent">
              <label htmlFor="relocate-to">Move to bench (must be available)</label>
              <input
                id="relocate-to"
                type="text"
                list="available-benches"
                required
                placeholder="e.g. VC-042"
                value={relocateTo}
                onChange={(e) => setRelocateTo(e.target.value)}
              />
              <datalist id="available-benches">
                {availableCodes.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          )}
          <label className="checkbox">
            <input type="radio" name="choice" checked={choice === 'end'} onChange={() => setChoice('end')} />
            <span>
              <strong>End it now.</strong> The adoption (and any renewal) is cancelled and the donor is emailed.
            </span>
          </label>
        </fieldset>
      ) : (
        <p className="muted small">This bench has no current adoption.</p>
      )}

      <ErrorNotice error={retire.error} />
      <div className="row">
        <button className="btn danger" disabled={retire.isPending}>
          {retire.isPending ? 'Retiring…' : 'Retire bench'}
        </button>
        <button type="button" className="btn secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
