import { Route, Routes, Navigate } from 'react-router';
import { AuthProvider, useAuth } from './platform/auth';
import { FeedPage } from './platform/FeedPage';
import { LoginPage } from './platform/LoginPage';

function Home() {
  const { state } = useAuth();
  if (state.status === 'loading') return <p>Loading…</p>;
  if (state.status === 'signed-out') return <Navigate to="/login" replace />;
  return <FeedPage user={state.user} />;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Home />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
