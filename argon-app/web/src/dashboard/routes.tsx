// OWNER: tanush — seed version; replace/extend freely but keep the exported names.

// All dashboard routes (Overview, Departments, Agents, Tickets, Runs, Approvals, Chat, Artifacts,
// Computers, Org, Integrations, Metrics, Settings, Onboarding). Seed: one placeholder page.
import { Link, Route, Routes } from 'react-router-dom';
import AgentComputerViewerPage from '../components/AgentComputerViewer';

function Placeholder() {
  return (
    <main style={{ padding: 32 }}>
      <h1>Foundry</h1>
      <p>Dashboard not built yet (owner: tanush).</p>
      <Link to="/view?mock=1">Enter the view ▸</Link>
      <p><Link to="/computers">View agent computers</Link></p>
    </main>
  );
}

export default function DashboardRoutes() {
  return (
    <Routes>
      <Route path="computers" element={<AgentComputerViewerPage />} />
      <Route path="*" element={<Placeholder />} />
    </Routes>
  );
}
