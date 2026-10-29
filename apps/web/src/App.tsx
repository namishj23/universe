import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { AuthProvider, useAuth } from './platform/auth';
import { AppShell } from './shell/layout/AppShell';
import { AdminPage } from './shell/pages/Admin';
import { DashboardPage } from './shell/pages/Dashboard';
import { AppBoundary, Forbidden, NotFound } from './shell/pages/Errors';
import { ForcePasswordPage } from './shell/pages/ForcePassword';
import { InboxPage } from './shell/pages/Inbox';
import { LoginPage } from './shell/pages/Login';
import { ModuleRoute } from './shell/pages/ModulePage';
import { createQueryClient } from './shell/query';
import { ThemeProvider } from './shell/theme/theme';
import { ToastProvider } from './shell/ui/Toast';

/**
 * Signed-out users go to /login (and come back afterwards). While the password must be
 * changed, /change-password is the only page.
 */
function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return <div aria-busy="true" />;
  if (state.status === 'signed-out')
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  const forced = location.pathname === '/change-password';
  if (state.mustChangePassword && !forced) return <Navigate to="/change-password" replace />;
  if (!state.mustChangePassword && forced) return <Navigate to="/" replace />;
  return <Outlet />;
}

function AdminOnly({ tab }: { tab: 'users' | 'audit' }) {
  const { state } = useAuth();
  return state.status === 'signed-in' && state.user.role === 'admin' ? (
    <AdminPage tab={tab} />
  ) : (
    <Forbidden />
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/change-password" element={<ForcePasswordPage />} />
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="admin" element={<AdminOnly tab="users" />} />
          <Route path="admin/audit" element={<AdminOnly tab="audit" />} />
          <Route path=":moduleId/*" element={<ModuleRoute />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <AppBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </AppBoundary>
  );
}
