// OWNER: tanush
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAppAuth } from "../../auth/AuthProvider";
import { post } from "../../api/client";
import { invalidateQueries } from "../../api/hooks";
import type { Venture } from "../../shared/contracts";
import { useCompany } from "../context";
import { ErrorNotice, useAction } from "../components/Shared";
import OnboardingConnections from "../components/OnboardingConnections";

export default function Onboarding() {
  const auth = useAppAuth();
  const [founder, setFounder] = useState(() => auth.name || "Founder");
  const [name, setName] = useState("");
  const [idea, setIdea] = useState("");
  const [discover, setDiscover] = useState(false);
  const [params] = useSearchParams();
  const [budget, setBudget] = useState("25");
  const [created, setCreated] = useState<Venture | null>(null);
  const [validation, setValidation] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploaded, setUploaded] = useState(false);
  const action = useAction(), navigate = useNavigate(), { selectVenture } = useCompany();
  async function launch() {
    if (action.working) return;
    setValidation("");
    if (idea.trim().length < 50 || idea.trim().length > 4000 || founder.trim().length < 2 || !Number.isFinite(Number(budget)) || Number(budget) <= 0) {
      setValidation("Add a brief of 50–4,000 characters, your name, and a positive planning budget.");
      return;
    }
    await action.run(async () => {
      // Save once; connecting or starting is a separate, explicit step.
      const venture = created ?? await post<Venture>("/v1/ventures", {
        name: name.trim() || "Untitled project", founder_name: founder.trim(), budget_usd: Number(budget),
        idea: discover ? `Founder intent: Discover an idea for me. Research options for founder review before choosing what to build.\n\n${idea.trim()}` : idea.trim(),
      });
      setCreated(venture);
      if (files.length && !uploaded) {
        const body = new FormData();
        files.forEach(file => body.append("files[]", file));
        await post(`/v1/ventures/${venture.id}/files`, body);
        setUploaded(true);
      }
      selectVenture(venture.id);
      invalidateQueries();
      navigate(`/onboarding?step=connections&venture=${encodeURIComponent(venture.id)}`);
    });
  }
  const requested = params.get("venture");
  if (params.get("step") === "connections" && requested) return <OnboardingConnections key={requested} ventureId={requested}/>;
  return <div className="onboarding"><Link className="onboarding-brand" to="/welcome"><span className="brand-mark">Y</span>YCBF</Link>
    <div className="onboarding-card idea-onboarding"><p className="eyebrow">Start with an idea</p><h1>What would you like to build?</h1>
      <p className="page-description">Describe who it helps, the problem, and what the first version should do.</p>
      <form onSubmit={e => { e.preventDefault(); void launch(); }}>
        <label>Your idea brief<textarea autoFocus rows={7} maxLength={4000} readOnly={Boolean(created)} value={idea} onChange={e => setIdea(e.target.value)} aria-describedby="idea-help" /><small id="idea-help">{idea.length} / 4,000 characters · minimum 50</small></label>
        <label className="idea-discovery"><input type="checkbox" checked={discover} disabled={Boolean(created)} onChange={e => setDiscover(e.target.checked)} />I need help finding an idea</label>
        {discover && <p className="muted">Use the brief to share your interests, audience and constraints. Any suggested direction needs your review; it is not validated market research. No discovery has run yet.</p>}
        <label>Project name <span>(optional)</span><input maxLength={200} value={name} readOnly={Boolean(created)} onChange={e => setName(e.target.value)} placeholder="Untitled project" /></label>
        <div className="idea-details"><label>Your name<input autoComplete="given-name" maxLength={60} value={founder} readOnly={Boolean(created)} onChange={e => setFounder(e.target.value)} /></label><label>Planning budget (USD)<input aria-label="Budget" type="number" min="0.01" step="0.01" value={budget} readOnly={Boolean(created)} onChange={e => setBudget(e.target.value)} /></label></div>
        <details><summary>Add context files (optional)</summary><label>Context files<input type="file" multiple accept=".md,.txt,.pdf,.csv,.json" disabled={Boolean(created) || action.working} onChange={e => {
          const selected = Array.from(e.target.files ?? []);
          if (selected.length > 8 || selected.some(file => !/\.(md|txt|pdf|csv|json)$/i.test(file.name) || file.size > 15 * 1024 * 1024)) { setValidation("Choose up to 8 .md, .txt, .pdf, .csv or .json files, up to 15 MB each."); e.target.value = ""; return; }
          setValidation(""); setFiles(selected);
        }} /><small>Up to 8 files, 15 MB each. Uploaded only when you continue.</small></label>{files.length > 0 && <p>{files.map(file => file.name).join(", ")}{uploaded ? " · Uploaded" : " · Ready to upload"}</p>}</details>
        <p className="onboarding-consent">Your idea stays untouched until you continue. The next step saves your brief and lets you connect tools. No agent work, model usage, payments or publishing starts here.</p>
        {created && <p role="status">Your project is saved. Continue below without creating another project.</p>}
        <ErrorNotice error={validation || action.error} />
        <div className="onboarding-footer"><Link to="/dashboard">Back to dashboard</Link><button className="button primary" type="submit" disabled={action.working}>{action.working ? "Saving…" : "Continue to connections"}</button></div>
        <p className="muted">Next: connect tools, then choose when to start building.</p>
      </form>
    </div>
  </div>;
}
