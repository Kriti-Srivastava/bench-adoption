import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api.ts';
import { ErrorNotice } from '../components/ui.tsx';
import { keys } from '../queries.ts';

/** Landing page for the emailed magic link. */
export function VerifyPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>();
  // Links are single-use, so make sure StrictMode's double effect only redeems once.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api
      .verifyMagicLink(params.get('token') ?? '')
      .then(({ user, redirectTo }) => {
        queryClient.setQueryData(keys.me, user);
        navigate(redirectTo ?? '/me/benches', { replace: true });
      })
      .catch(setError);
  }, [params, navigate, queryClient]);

  // A link used at the wrong entrance is sent to the right one.
  const entrance =
    error instanceof ApiError && error.code === 'use_staff_entrance'
      ? { to: '/staff', label: 'Go to the park staff sign-in' }
      : { to: '/sign-in', label: 'Request a new link' };

  return (
    <div className="narrow stack">
      <h1>Signing you in…</h1>
      {error !== undefined && (
        <>
          <ErrorNotice error={error} />
          <p>
            <Link to={entrance.to}>{entrance.label}</Link>
          </p>
        </>
      )}
    </div>
  );
}
