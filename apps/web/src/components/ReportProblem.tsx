import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { problemKinds } from '@bench/shared';
import { api } from '../api.ts';
import { keys, useMe } from '../queries.ts';
import { ErrorNotice } from './ui.tsx';

const KIND_LABEL: Record<(typeof problemKinds)[number], string> = {
  damaged: 'Broken or damaged',
  graffiti: 'Graffiti',
  dirty: 'Needs cleaning',
  plaque: 'Problem with the plaque',
  other: 'Something else',
};

/** Lets visitors tell the park crew about a problem with a bench. */
export function ReportProblem({ benchId }: { benchId: string }) {
  const me = useMe();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof problemKinds)[number]>('damaged');
  const [details, setDetails] = useState('');
  const queryClient = useQueryClient();
  const send = useMutation({
    mutationFn: () => api.reportProblem(benchId, { kind, details }),
    onSuccess: () => {
      setDetails('');
      queryClient.invalidateQueries({ queryKey: keys.myReports });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send.mutate();
  };

  if (!open) {
    return (
      <button type="button" className="link-btn small" onClick={() => setOpen(true)}>
        Report a problem with this bench
      </button>
    );
  }

  return (
    <section className="card stack">
      <h2>Report a problem</h2>
      {!me.data ? (
        <p>
          Please <Link to={`/sign-in?redirectTo=${encodeURIComponent(location.pathname)}`}>sign in</Link> so
          the crew can follow up with you.
        </p>
      ) : send.isSuccess ? (
        <p className="notice success" role="status">
          Thanks! The park crew has been notified. You can follow it on your{' '}
          <Link to="/me">account page</Link>.
        </p>
      ) : (
        <form className="stack" onSubmit={submit}>
          <div>
            <label htmlFor="problem-kind">What's wrong?</label>
            <select id="problem-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {problemKinds.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="problem-details">Details</label>
            <textarea
              id="problem-details"
              required
              maxLength={1000}
              placeholder="e.g. The second slat from the front is cracked."
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </div>
          <ErrorNotice error={send.error} />
          <div className="row">
            <button className="btn" disabled={send.isPending}>
              Send report
            </button>
            <button type="button" className="btn secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
