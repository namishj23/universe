import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'uv-theme';
const DARK = '(prefers-color-scheme: dark)';

// A UI preference, not a secret. Storage can throw (private mode, blocked site data).
function readOverride(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}
function writeOverride(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // The choice still applies to this tab.
  }
}
const systemTheme = (): Theme => (window.matchMedia(DARK).matches ? 'dark' : 'light');

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}
const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Follows `prefers-color-scheme` until the toggle stores an override. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [override, setOverride] = useState(readOverride);
  const [system, setSystem] = useState(systemTheme);

  useEffect(() => {
    const media = window.matchMedia(DARK);
    const onChange = () => setSystem(media.matches ? 'dark' : 'light');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const theme = override ?? system;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    writeOverride(next);
    setOverride(next);
  }, [theme]);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}
