// OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)

// Top-level routing only. The dashboard owns every route except /view and /view/capture.
//   /view           -> world/WorldHost.tsx            (mahin)
//   /view/capture   -> world/capture/CapturePage.tsx  (mahin; dev-only, used by worldgen capture)
//   /*              -> dashboard/routes.tsx           (tanush)
import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

const WorldHost = lazy(() => import('./world/WorldHost'));
const CapturePage = lazy(() => import('./world/capture/CapturePage'));
const DashboardRoutes = lazy(() => import('./dashboard/routes'));

export default function App() {
  return (
    <Suspense fallback={<div className="app-loading">Loading…</div>}>
      <Routes>
        <Route path="/view/capture" element={<CapturePage />} />
        <Route path="/view" element={<WorldHost />} />
        <Route path="/*" element={<DashboardRoutes />} />
      </Routes>
    </Suspense>
  );
}
