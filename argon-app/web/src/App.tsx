// Top-level routing: public entry, normal dashboard, and explicit world entry.
// Hosted dashboard and world deep links require a verified provider session.
//   /view           -> world/WorldHost.tsx            (mahin)
//   /view/capture   -> world/capture/CapturePage.tsx  (mahin; dev-only, used by worldgen capture)
//   /*              -> dashboard/routes.tsx           (tanush)
import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

const Landing = lazy(() => import('./entry/Landing'));
import AuthProvider from './auth/AuthProvider';
import { AuthGuard, AuthEntry, AuthCallback, AccountPage, SignOutPage, DemoEntry } from './auth/AuthPages';

const WorldHost = lazy(() => import('./world/WorldHost'));
const CapturePage = lazy(() => import('./world/capture/CapturePage'));
const DashboardRoutes = lazy(() => import('./dashboard/routes'));

export default function App() {
  return (
    <AuthProvider><Suspense fallback={<div className="app-loading">Loading…</div>}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/welcome" element={<Landing />} />
        <Route path="/signin/*" element={<AuthEntry />} />
        <Route path="/signup/*" element={<AuthEntry signup />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/account/*" element={<AccountPage />} />
        <Route path="/signout" element={<SignOutPage />} />
        <Route path="/demo" element={<DemoEntry />} />
        <Route path="/view/capture" element={<AuthGuard><CapturePage /></AuthGuard>} />
        <Route path="/view" element={<AuthGuard><WorldHost /></AuthGuard>} />
        <Route path="/*" element={<AuthGuard><DashboardRoutes /></AuthGuard>} />
      </Routes>
    </Suspense></AuthProvider>
  );
}
