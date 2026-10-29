import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';
import { SessionResponse, type PublicUser } from '@universe/contracts';
import { api, request, setCsrfToken, setUnauthorizedHandler } from './api';

type AuthState =
  { status: 'loading' } | { status: 'signed-out' } | { status: 'signed-in'; user: PublicUser };

interface AuthContextValue {
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const navigate = useNavigate();

  const signIn = useCallback((session: SessionResponse) => {
    setCsrfToken(session.csrfToken);
    setState({ status: 'signed-in', user: session.user });
  }, []);
  const signOut = useCallback(() => {
    setCsrfToken(null);
    setState({ status: 'signed-out' });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      signOut();
      void navigate('/login', { replace: true });
    });
  }, [navigate, signOut]);

  useEffect(() => {
    const controller = new AbortController();
    api('/api/auth/me', SessionResponse, { signal: controller.signal }).then(signIn, () => {
      if (!controller.signal.aborted) signOut();
    });
    return () => controller.abort();
  }, [signIn, signOut]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      login: async (email, password) =>
        signIn(
          await api('/api/auth/login', SessionResponse, {
            method: 'POST',
            body: { email, password },
          }),
        ),
      logout: async () => {
        try {
          await request('/api/auth/logout', { method: 'POST' });
        } finally {
          signOut();
        }
      },
    }),
    [state, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
