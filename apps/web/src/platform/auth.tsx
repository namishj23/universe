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
import { useQueryClient } from '@tanstack/react-query';
import { SessionResponse, type PublicUser } from '@universe/contracts';
import { api, request, setCsrfToken, setUnauthorizedHandler } from './api';

type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: PublicUser; mustChangePassword: boolean };

interface AuthContextValue {
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** After a successful forced change: the rest of the app opens. */
  passwordChanged: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const signIn = useCallback((session: SessionResponse) => {
    setCsrfToken(session.csrfToken);
    setState({
      status: 'signed-in',
      user: session.user,
      mustChangePassword: session.mustChangePassword,
    });
  }, []);
  // Nothing of the previous user may remain in memory for the next one.
  const signOut = useCallback(() => {
    setCsrfToken(null);
    queryClient.clear();
    setState({ status: 'signed-out' });
  }, [queryClient]);

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
      passwordChanged: () =>
        setState((s) => (s.status === 'signed-in' ? { ...s, mustChangePassword: false } : s)),
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

/** The signed-in user; only for components rendered inside the signed-in shell. */
export function useUser() {
  const { state } = useAuth();
  if (state.status !== 'signed-in') throw new Error('useUser needs a signed-in session');
  return state.user;
}
