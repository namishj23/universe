import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { DropdownMenu } from 'radix-ui';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ModuleInfo } from '@universe/contracts';
import { z } from 'zod';
import { api } from '../../platform/api';
import { useAuth, useUser } from '../../platform/auth';
import { ActivityProvider, useActivity } from '../activity/ActivityProvider';
import { AREA } from '../modules';
import { ChangePasswordModal } from '../pages/ChangePassword';
import { NewVersion, isChunkError, SomethingWrong } from '../pages/Errors';
import { useTheme } from '../theme/theme';
import { cx } from '../ui/cx';
import { Drawer } from '../ui/Overlay';
import { Loading } from '../ui/States';
import s from './AppShell.module.css';

export const MODULES_KEY = ['modules'] as const;
const ModuleList = z.array(ModuleInfo);

/** `GET /api/modules`: the modules this role may use, in navigation order. */
export function useModules() {
  return useQuery({
    queryKey: MODULES_KEY,
    queryFn: ({ signal }) => api('/api/modules', ModuleList, { signal }),
    staleTime: Infinity,
  });
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const user = useUser();
  const { unread } = useActivity();
  const modules = useModules();
  const item = ({ isActive }: { isActive: boolean }) => cx(s.item, isActive && s.active);
  const mod = ({ isActive }: { isActive: boolean }) => cx(s.item, s.mod, isActive && s.active);
  const entries = [
    ...(modules.data ?? []).map((m) => ({ id: m.id, label: m.label, to: `/${m.id}` })),
    ...(user.role === 'admin' ? [{ id: 'admin' as const, label: 'Admin', to: '/admin' }] : []),
  ];
  return (
    <>
      <nav aria-label="Main" className={s.nav}>
        <NavLink to="/" end className={item} onClick={onNavigate}>
          Dashboard
          <span className={s.topBadge} />
        </NavLink>
        <NavLink to="/inbox" className={item} onClick={onNavigate}>
          Inbox
          <span className={s.topBadge}>
            {unread > 0 && (
              <>
                {unread}
                <span className="uv-visually-hidden"> unread</span>
              </>
            )}
          </span>
        </NavLink>
      </nav>
      <nav aria-label="Modules" className={s.nav}>
        {entries.map((m) => (
          <NavLink key={m.id} to={m.to} className={mod} data-mod={m.id} onClick={onNavigate}>
            <span className={s.code} aria-hidden="true">
              {AREA[m.id].code}
            </span>
            {m.label}
            <span className={s.badge} />
          </NavLink>
        ))}
      </nav>
    </>
  );
}

function AccountMenu() {
  const { state, logout } = useAuth();
  const [changing, setChanging] = useState(false);
  if (state.status !== 'signed-in') return null;
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className={s.account} aria-label={`Account: ${state.user.name}`}>
          <span className={s.accountName}>{state.user.name}</span>
          <span className={s.accountLine}>{state.user.role} · account ▾</span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={s.menu} side="top" align="start" sideOffset={6}>
            <DropdownMenu.Label className={s.menuLabel}>{state.user.email}</DropdownMenu.Label>
            <DropdownMenu.Item className={s.menuItem} onSelect={() => setChanging(true)}>
              Change password
            </DropdownMenu.Item>
            <DropdownMenu.Separator className={s.separator} />
            <DropdownMenu.Item className={cx(s.menuItem, s.signOut)} onSelect={() => void logout()}>
              Sign out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <ChangePasswordModal open={changing} onOpenChange={setChanging} />
    </>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { theme, toggle } = useTheme();
  return (
    <>
      <div className={s.wordmark}>
        <span className={s.wordmarkName}>UniVerse</span>
        <span className={s.wordmarkLine}>campus platform</span>
      </div>
      <Nav {...(onNavigate && { onNavigate })} />
      <div className={s.bottom}>
        <button type="button" className={s.theme} onClick={toggle}>
          Theme<span className={s.themeLabel}>{theme === 'dark' ? 'DARK' : 'LIGHT'}</span>
        </button>
        <AccountMenu />
      </div>
    </>
  );
}

/** Catches a page that throws: a failed lazy chunk asks for a reload, anything else apologises. */
class PageBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return isChunkError(error) ? <NewVersion /> : <SomethingWrong error={error} inline />;
  }
}

/** After a navigation (not the first load), focus moves to the new page's h1. */
function useFocusHeading(main: React.RefObject<HTMLElement | null>) {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => {
      const h1 = main.current?.querySelector<HTMLElement>('[data-page-heading]');
      (h1 ?? main.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, main]);
}

/** The signed-in layout: sidebar (or top bar under 1024px), main, live activity. */
export function AppShell() {
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useFocusHeading(main);
  return (
    <ActivityProvider>
      <div className={s.shell}>
        <a className={s.skip} href="#main">
          Skip to content
        </a>
        <header className={s.topbar}>
          <div className={s.wordmark}>
            <span className={s.wordmarkName}>UniVerse</span>
          </div>
          <button type="button" className={s.menuButton} onClick={() => setMenuOpen(true)}>
            Menu
          </button>
        </header>
        <aside className={s.aside}>
          <SidebarContent />
        </aside>
        <Drawer open={menuOpen} onOpenChange={setMenuOpen} title="Menu" side="left" hideHead>
          <div className={cx(s.aside, s.drawerNav)}>
            <SidebarContent onNavigate={() => setMenuOpen(false)} />
          </div>
        </Drawer>
        <main id="main" ref={main} tabIndex={-1} className={s.main}>
          <PageBoundary key={pathname}>
            <Suspense fallback={<Loading what="this page" />}>
              <Outlet />
            </Suspense>
          </PageBoundary>
        </main>
      </div>
    </ActivityProvider>
  );
}
