// Top-level routing: public entry, normal dashboard, and explicit world entry.
// Existing dashboard deep links remain available without a client-side auth gate.
//   /view           -> world/WorldHost.tsx            (mahin)
//   /view/capture   -> world/capture/CapturePage.tsx  (mahin; dev-only, used by worldgen capture)
//   /*              -> dashboard/routes.tsx           (tanush)
import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

const Landing = lazy(() => import('./entry/Landing'));
const LocalSignIn = lazy(() => import('./entry/LocalSignIn'));

const WorldHost = lazy(() => import('./world/WorldHost'));
const CapturePage = lazy(() => import('./world/capture/CapturePage'));
const DashboardRoutes = lazy(() => import('./dashboard/routes'));

export default function App() {
  return (
    <Suspense fallback={<div className="app-loading">Loading…</div>}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/welcome" element={<Landing />} />
        <Route path="/signin" element={<LocalSignIn />} />
        <Route path="/view/capture" element={<CapturePage />} />
        <Route path="/view" element={<WorldHost />} />
        <Route path="/*" element={<DashboardRoutes />} />
      </Routes>
    </Suspense>
  );
}
