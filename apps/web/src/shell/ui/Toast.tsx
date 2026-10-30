import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import s from './Toast.module.css';

export const TOAST_MS = 2600;
type Toast = { message: string; label: string; key: number };
const ToastContext = createContext<((message: string, label?: string) => void) | null>(null);

/** One toast at a time, bottom center, gone after 2.6 s. `role="status"` announces it. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((message: string, label = 'DONE') => {
    clearTimeout(timer.current);
    setToast({ message, label, key: Date.now() });
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite">
        {toast && (
          <div key={toast.key} role="status" className={s.toast}>
            <span className={s.label}>{toast.label}</span>
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

/** `toast(message)` shows DONE; `toast(message, 'ERROR')` for a failure. */
export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside <ToastProvider>');
  return value;
}
