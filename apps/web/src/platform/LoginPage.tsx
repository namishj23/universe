import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { ApiRequestError, formText } from './api';
import { useAuth } from './auth';

export function LoginPage() {
  const { state, login } = useAuth();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  if (state.status === 'loading') return <p>Loading…</p>;
  if (state.status === 'signed-in') return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSending(true);
    setError(null);
    try {
      await login(formText(form, 'email'), formText(form, 'password'));
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : 'Could not reach the server. Try again.',
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <main>
      <h1>Sign in to UniVerse</h1>
      <form onSubmit={(e) => void onSubmit(e)}>
        {error && (
          <p role="alert" tabIndex={-1} ref={errorRef}>
            {error}
          </p>
        )}
        <label>
          Email <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password{' '}
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit" disabled={sending}>
          {sending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
