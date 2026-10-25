// OWNER: tanush — seed version; replace/extend freely but keep the exported names.

import { useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { CompanyProvider, useCompany } from "./context";
import { currency } from "./types";
import { Empty, ErrorNotice, Icon, Loading, Status } from "./components/Shared";
import Overview from "./pages/Overview";
import Onboarding from "./pages/Onboarding";
import { AgentPage, Agents, DepartmentPage, Departments } from "./pages/People";
import {
  Approvals,
  ArtifactPage,
  Artifacts,
  RunPage,
  Runs,
  TicketPage,
  Tickets,
} from "./pages/Work";
import Chat from "./pages/Chat";
import {
  ComputerTask,
  Computers,
  Integrations,
  Metrics,
  Org,
  Settings,
} from "./pages/Company";
import WorldLab from "./pages/WorldLab";
import "./dashboard.css";

const navigation = [
  ["/", "Overview", "overview"],
  ["/departments", "Departments", "departments"],
  ["/agents", "Agents", "agents"],
  ["/tickets", "Tickets", "tickets"],
  ["/runs", "Runs", "runs"],
  ["/approvals", "Approvals", "approvals"],
  ["/chat", "Chat", "chat"],
  ["/org", "Org", "org"],
  ["/computers", "Computers", "computers"],
  ["/artifacts", "Artifacts", "artifacts"],
  ["/world-lab", "World Lab", "world"],
  ["/metrics", "Metrics", "metrics"],
  ["/integrations", "Integrations", "integrations"],
  ["/settings", "Settings", "settings"],
];
function Dashboard() {
  const {
      venture,
      ventureId,
      ventures,
      selectVenture,
      loading,
      error,
      refresh,
      live,
      system,
    } = useCompany(),
    location = useLocation();
  const [launched, setLaunched] = useState(() => {
    try {
      return sessionStorage.getItem("foundry.just-launched");
    } catch {
      return null;
    }
  });
  useEffect(() => {
    document.title = `${navigation.find(([path]) => (path === "/" ? location.pathname === "/" : location.pathname.startsWith(path)))?.[1] ?? "Company"} · Foundry`;
  }, [location.pathname]);
  useEffect(() => {
    try {
      setLaunched(sessionStorage.getItem("foundry.just-launched"));
    } catch {}
  }, [location.pathname, ventureId]);
  if (location.pathname === "/onboarding") return <Onboarding />;
  if (loading)
    return (
      <div className="boot-screen">
        <span className="brand-mark">f</span>
        <Loading />
      </div>
    );
  if (error && !ventures.length)
    return (
      <main className="boot-screen">
        <h1>Foundry</h1>
        <ErrorNotice error={error} retry={refresh} />
      </main>
    );
  if (!ventures.length) return <Navigate to="/onboarding" replace />;
  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <Link className="brand" to="/">
          <span className="brand-mark">f</span>
          <span>
            Foundry<span className="brand-period">.</span>
          </span>
        </Link>
        <p className="sidebar-label">YOUR COMPANY</p>
        <nav aria-label="Main navigation">
          {navigation.map(([path, label, icon]) => (
            <NavLink key={path} to={path} end={path === "/"} title={label}>
              <Icon name={icon} />
              <span>{label}</span>
              {path === "/approvals" &&
                Boolean(venture?.stats?.approvals_pending) && (
                  <span className="nav-count">
                    {venture?.stats?.approvals_pending}
                  </span>
                )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="founder-avatar">
            {venture?.founder_name?.slice(0, 1) ?? "T"}
          </div>
          <div>
            <strong>{venture?.founder_name ?? "Founder"}</strong>
            <span>You steer the company</span>
          </div>
          <Link to="/settings" aria-label="Company settings">
            <Icon name="settings" size={16} />
          </Link>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="workspace-switcher">
            <span className="workspace-glyph">
              <Icon name="departments" size={18} />
            </span>
            <label className="sr-only" htmlFor="venture-switcher">
              Select venture
            </label>
            <select
              id="venture-switcher"
              value={ventureId ?? ""}
              onChange={(event) => selectVenture(event.target.value)}
            >
              {ventures.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <Link
              to="/onboarding"
              className="icon-button"
              aria-label="New venture"
              title="New venture"
            >
              <Icon name="plus" size={16} />
            </Link>
          </div>
          <div className="topbar-right">
            <span className={`live-indicator ${live}`}>
              <span />
              {live === "live"
                ? "Live"
                : live === "connecting"
                  ? "Connecting"
                  : "Reconnecting"}
            </span>
            {system?.mode === "fake" && (
              <span className="fake-badge">Fake mode</span>
            )}
            {venture && (
              <>
                <Status value={venture.status} />
                <span className="topbar-budget">
                  {currency(venture.spent_usd)}{" "}
                  <span>/ {currency(venture.budget_usd)}</span>
                </span>
              </>
            )}
            <Link
              className="button primary enter-view"
              to={`/view?venture=${ventureId}`}
            >
              <Icon name="world" size={17} />
              Enter the view <span>↗</span>
            </Link>
          </div>
        </header>
        {system?.mode === "fake" ? (
          <div className="system-strip fake-strip">
            <span className="subtle-dot" />
            <strong>Fake mode</strong> — Company outputs are deterministic test
            fixtures. Live provider results are not being generated.
          </div>
        ) : (
          system &&
          Object.entries(system.providers).some(
            ([provider, value]) =>
              ["gemini", "antigravity"].includes(provider) && !value.configured,
          ) && (
            <div className="system-strip">
              Live providers need configuration.{" "}
              <Link to="/integrations">View integrations →</Link>
            </div>
          )
        )}
        {launched === ventureId && (
          <div className="launch-banner">
            <span>
              Your company is starting. Intake is reading your idea. Press{" "}
              <strong>Enter the view</strong> to meet the team.
            </span>
            <button
              className="icon-button"
              aria-label="Dismiss launch message"
              onClick={() => {
                setLaunched(null);
                try {
                  sessionStorage.removeItem("foundry.just-launched");
                } catch {}
              }}
            >
              ×
            </button>
          </div>
        )}
        <main className="page-content" key={ventureId}>
          <Routes>
            <Route index element={<Overview />} />
            <Route path="departments" element={<Departments />} />
            <Route path="departments/:id" element={<DepartmentPage />} />
            <Route path="agents" element={<Agents />} />
            <Route path="agents/:id" element={<AgentPage />} />
            <Route path="tickets" element={<Tickets />} />
            <Route path="tickets/:id" element={<TicketPage />} />
            <Route path="runs" element={<Runs />} />
            <Route path="runs/:id" element={<RunPage />} />
            <Route path="approvals" element={<Approvals />} />
            <Route path="chat" element={<Chat />} />
            <Route path="chat/:channelSlug" element={<Chat />} />
            <Route path="org" element={<Org />} />
            <Route path="computers" element={<Computers />} />
            <Route path="computer-tasks/:id" element={<ComputerTask />} />
            <Route path="artifacts" element={<Artifacts />} />
            <Route path="artifacts/:id" element={<ArtifactPage />} />
            <Route path="world-lab" element={<WorldLab />} />
            <Route path="metrics" element={<Metrics />} />
            <Route path="integrations" element={<Integrations />} />
            <Route path="settings" element={<Settings />} />
            <Route
              path="*"
              element={
                <Empty
                  title="This page could not be found"
                  action={
                    <Link className="button" to="/">
                      Back to Overview
                    </Link>
                  }
                />
              }
            />
          </Routes>
        </main>
        <footer className="app-footer">
          <span>Built by the company. Steered by you.</span>
          <span>Foundry × Argon</span>
        </footer>
      </div>
    </div>
  );
}
export default function DashboardRoutes() {
  return (
    <CompanyProvider>
      <Dashboard />
    </CompanyProvider>
  );
}
