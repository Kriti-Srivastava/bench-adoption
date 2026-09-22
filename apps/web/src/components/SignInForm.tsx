import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { ErrorNotice } from './ui.tsx';

/**
 * Passwordless sign in: we email a one-time link that brings the person back
 * to `redirectTo`. First-time adopters get an account automatically.
 */
export function SignInForm({ redirectTo, intro }: { redirectTo: string; intro?: string }) {
  const [email, setEmail] = useState('');
  const send = useMutation({ mutationFn: () => api.requestMagicLink(email, redirectTo) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send.mutate();
  };

  if (send.isSuccess) {
    return (
      <div className="notice success" role="status">
        <strong>Check your email.</strong> We sent a sign-in link to {email}. It works once and
        expires in 15 minutes.{' '}
        <button className="link-btn" onClick={() => send.reset()}>
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={submit}>
      {intro && <p className="muted">{intro}</p>}
      <div>
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <ErrorNotice error={send.error} />
      <button className="btn" disabled={send.isPending}>
        {send.isPending ? 'Sending…' : 'Email me a sign-in link'}
      </button>
    </form>
  );
}
