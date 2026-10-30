import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { ApiRequestError } from '../../platform/api';
import { useAuth } from '../../platform/auth';
import { longNow } from '../format';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { usePageTitle } from '../ui/Page';
import s from './Login.module.css';

const INDEX = [
  ['A', 'Student Hub', 'students · mentors'],
  ['B', 'Rides', 'students · mentors'],
  ['D', 'Wellbeing', 'only you'],
  ['E', 'Exam Review', 'invigilators'],
] as const;

/** Seeded demo accounts. Only in a demo build; fills the email, never a password. */
const DEMO = import.meta.env.VITE_DEMO_MODE === 'true';
const DEMO_ACCOUNTS = [
  ['student@universe.test', 'student'],
  ['mentor@universe.test', 'mentor'],
  ['invigilator@universe.test', 'invigilator'],
  ['admin@universe.test', 'admin'],
] as const;

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** The inverted left half of the login and forced-change screens. */
export function BrandPanel() {
  const now = useNow();
  return (
    <aside className={s.brand} aria-label="About UniVerse">
      <div className={s.top}>
        <span className={s.institute}>SARDAR PATEL INSTITUTE OF TECHNOLOGY</span>
        <span className={s.now}>{longNow(now)}</span>
      </div>
      <div className={s.hero}>
        <span className={s.wordmark}>UniVerse</span>
        <span className={s.tagline}>
          One sign-in for the hub, rides, wellbeing and exam review.
        </span>
      </div>
      <ul className={s.index} aria-label="Modules">
        {INDEX.map(([code, label, who]) => (
          <li key={code} className={s.indexRow}>
            <span className={s.code}>{code}</span>
            <span className={s.label}>{label}</span>
            <span className={s.who}>{who}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** The server answers 401 for a wrong email and a wrong password alike; we say the same. */
function loginMessage(err: unknown) {
  if (err instanceof ApiRequestError) {
    if (err.status === 429) return err.message;
    if (err.status === 400 || err.status === 401) return 'Email or password is incorrect.';
  }
  return "Couldn't reach UniVerse. Try again.";
}

export function LoginPage() {
  const { state, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const alert = useRef<HTMLDivElement>(null);
  usePageTitle('Sign in');

  useEffect(() => {
    if (error) alert.current?.focus();
  }, [error]);

  if (state.status === 'signed-in') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from?.startsWith('/') && !from.startsWith('//') ? from : '/'} replace />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      setPassword('');
    } catch (err) {
      setError(loginMessage(err));
      setBusy(false);
      return;
    }
    void navigate('/', { replace: true });
  };

  return (
    <div className={s.page}>
      <BrandPanel />
      <main className={s.side}>
        <form className={s.form} onSubmit={(e) => void submit(e)} noValidate>
          <div className={s.head}>
            <h1 className={s.title}>Sign in</h1>
            <span className={s.sub}>Use your campus email and password.</span>
          </div>
          {error && (
            <div ref={alert} role="alert" tabIndex={-1} className={s.alert}>
              {error}
            </div>
          )}
          <Field label="EMAIL">
            <Input
              large
              type="email"
              name="email"
              autoComplete="username"
              placeholder="name@spit.ac.in"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError('');
              }}
            />
          </Field>
          <Field label="PASSWORD">
            <Input
              large
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
            />
          </Field>
          <Button type="submit" size="block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          {DEMO && (
            <div className={s.demo}>
              <span className={s.demoLabel}>DEMO ACCOUNTS · CLICK TO FILL</span>
              {DEMO_ACCOUNTS.map(([address, role]) => (
                <button
                  key={address}
                  type="button"
                  className={s.demoAccount}
                  onClick={() => {
                    setEmail(address);
                    setError('');
                  }}
                >
                  <span className={s.demoEmail}>{address}</span>
                  <span className={s.demoRole}>{role}</span>
                </button>
              ))}
              <span className={s.demoNote} data-demo-note="">
                Fills the email only. The demo password is in your setup notes.
              </span>
            </div>
          )}
        </form>
      </main>
    </div>
  );
}

export const loginStyles = s;
