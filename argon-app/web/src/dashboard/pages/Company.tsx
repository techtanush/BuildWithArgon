// OWNER: tanush
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, get, post } from "../../api/client";
import { invalidateQueries, useQuery } from "../../api/hooks";
import type {
  Agent,
  Approval,
  Computer,
  ComputerAction,
  Department,
  ListPage,
  StandupLatest,
  WorldgenRunSummary,
} from "../../shared/contracts";
import { useCompany } from "../context";
import type { Budget, SettingsData } from "../types";
import { colors, currency, percent, safeUrl, titleCase } from "../types";
import CallPanel from "../components/CallPanel";
import { ApprovalCard } from "../components/ApprovalCard";
import { AgentCard } from "./People";
import {
  Card,
  Empty,
  ErrorNotice,
  Loading,
  PageHeader,
  Portrait,
  References,
  RuntimeBadges,
  Status,
  useAction,
} from "../components/Shared";

interface OrgData {
  founder: string;
  chief_of_staff: Agent;
  concierge: Agent;
  departments: { department: Department; lead: Agent; members: Agent[] }[];
}
export function Org() {
  const { venture, ventureId } = useCompany(),
    [calling, setCalling] = useState<Agent | null>(null),
    action = useAction();
  const org = useQuery<OrgData>(
    ventureId ? `/v1/ventures/${ventureId}/org` : null,
    () => get(`/v1/ventures/${ventureId}/org`),
  );
  const agents = useQuery<ListPage<Agent>>(
    ventureId ? `/v1/ventures/${ventureId}/agents` : null,
    () => get(`/v1/ventures/${ventureId}/agents`),
  );
  const departments = useQuery<ListPage<Department>>(
    ventureId ? `/v1/ventures/${ventureId}/departments` : null,
    () => get(`/v1/ventures/${ventureId}/departments`),
  );
  const requests = useQuery<ListPage<import("../../shared/contracts").Ticket>>(
    ventureId
      ? `/v1/ventures/${ventureId}/tickets?type=agent.request&limit=200`
      : null,
    () => get(`/v1/ventures/${ventureId}/tickets?type=agent.request&limit=200`),
  );
  const standup = useQuery<StandupLatest>(
    ventureId ? `/v1/ventures/${ventureId}/standups/latest` : null,
    () => get(`/v1/ventures/${ventureId}/standups/latest`),
  );
  const chief =
      org.data?.chief_of_staff ??
      agents.data?.items.find((a) => a.id === "cos.orchestrator"),
    concierge =
      org.data?.concierge ??
      agents.data?.items.find((a) => a.id === "concierge");
  const groups =
    org.data?.departments ??
    departments.data?.items.map((department) => ({
      department,
      lead: agents.data?.items.find(
        (a) => a.department_id === department.id && a.is_lead,
      ),
      members:
        agents.data?.items.filter(
          (a) => a.department_id === department.id && !a.is_lead,
        ) ?? [],
    })) ??
    [];
  async function report() {
    await action.run(async () => {
      await post(`/v1/ventures/${ventureId}/tickets`, {
        type: "cos.report",
        department_id: "chief-of-staff",
        title: "Founder requested company report",
        body: "Summarize recorded progress, blockers and decisions.",
      });
      invalidateQueries();
    });
  }
  return (
    <>
      <PageHeader
        eyebrow="A company, not a single prompt"
        title="Org"
        description="The Chief of Staff directs department leads. Leads delegate, ask, and hand work forward."
        actions={
          <>
            <button
              className="button"
              disabled={action.working}
              onClick={() => void report()}
            >
              Ask for a report
            </button>
            <button
              className="button primary"
              disabled={action.working}
              onClick={() =>
                void action.run(async () => {
                  await post(`/v1/ventures/${ventureId}/standup`);
                  invalidateQueries();
                })
              }
            >
              Run a standup now
            </button>
          </>
        }
      />
      <ErrorNotice error={action.error} />
      {agents.loading ? (
        <Loading />
      ) : (
        <>
          <div className="founder-node">
            <span className="overline">Founder · consequential decisions</span>
            <h2>{org.data?.founder ?? venture?.founder_name}</h2>
            <span className="org-connector" />
          </div>
          <div className="org-leadership">
            {chief && (
              <AgentCard agent={chief} call={() => setCalling(chief)} />
            )}
            <div className="org-direction">
              <span>Plans · delegates · coordinates</span>
              <span>↓</span>
            </div>
            {concierge && (
              <AgentCard agent={concierge} call={() => setCalling(concierge)} />
            )}
          </div>
          <div className="org-grid">
            {groups.map(({ department, lead, members }) => (
              <Card key={department.id} className="org-department">
                <div
                  className="department-code"
                  style={{ color: colors[department.id] }}
                >
                  {department.code}
                  <Link to={`/departments/${department.id}`}>↗</Link>
                </div>
                <h3>{department.name}</h3>
                {lead && (
                  <>
                    <div className="org-person">
                      <Portrait agent={lead} />
                      <div>
                        <Link to={`/agents/${lead.id}`}>
                          <strong>{lead.display_name}</strong>
                        </Link>
                        <p>{lead.title}</p>
                      </div>
                      <button
                        className="button small"
                        onClick={() => setCalling(lead)}
                      >
                        Call {lead.display_name}
                      </button>
                    </div>
                    <RuntimeBadges runtime={lead.runtime} />
                  </>
                )}
                <div className="org-members">
                  {members
                    .filter((a) => a.id !== "concierge")
                    .map((member) => (
                      <div key={member.id}>
                        <div className="org-person">
                          <Portrait agent={member} size={30} />
                          <Link to={`/agents/${member.id}`}>
                            {member.display_name}
                            <small>{member.title}</small>
                          </Link>
                          <button
                            className="text-link"
                            onClick={() => setCalling(member)}
                          >
                            Call
                          </button>
                        </div>
                        <RuntimeBadges runtime={member.runtime} />
                      </div>
                    ))}
                </div>
                <div className="request-counts">
                  <span>
                    {requests.data?.items.filter(
                      (t) =>
                        t.department_id === department.id &&
                        !["done", "cancelled"].includes(t.status),
                    ).length ?? 0}{" "}
                    open requests in
                  </span>
                  <span>
                    {requests.data?.items.filter(
                      (t) =>
                        agents.data?.items.some(
                          (a) =>
                            a.id === t.payload.from_agent_id &&
                            a.department_id === department.id,
                        ) && !["done", "cancelled"].includes(t.status),
                    ).length ?? 0}{" "}
                    out
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
      <Card title="Latest standup">
        {standup.data?.root_message_id ? (
          <>
            <p className="muted">
              {standup.data.created_at &&
                new Date(standup.data.created_at).toLocaleString()}
            </p>
            {standup.data.updates.map((update) => (
              <div className="standup-update" key={update.agent_id}>
                <strong>{update.agent_id}</strong>
                <p>{update.text}</p>
                <References refs={update.refs} />
              </div>
            ))}
            {standup.data.decisions && (
              <div className="notice">
                <strong>Decisions & assignments</strong>
                <p>{standup.data.decisions.text}</p>
                <References refs={standup.data.decisions.refs} />
              </div>
            )}
          </>
        ) : (
          <Empty title="No standup recorded yet">
            A recorded standup will show department updates and the Chief of
            Staff’s decisions.
          </Empty>
        )}
      </Card>
      {calling && ventureId && (
        <CallPanel
          agent={calling}
          ventureId={ventureId}
          onClose={() => setCalling(null)}
        />
      )}
    </>
  );
}

function ComputerScreen({ id, stamp }: { id: string; stamp: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [stamp]);
  return failed ? (
    <div className="screen-empty">No screenshot available yet.</div>
  ) : (
    <img
      className="computer-screen"
      src={`/v1/computers/${encodeURIComponent(id)}/screen.png?at=${stamp}`}
      alt="Agent computer screen"
      onError={() => setFailed(true)}
    />
  );
}
export function Computers() {
  const { ventureId } = useCompany(),
    action = useAction(),
    [stamp, setStamp] = useState(Date.now());
  const query = useQuery<ListPage<Computer>>(
    ventureId ? `/v1/ventures/${ventureId}/computers` : null,
    () => get(`/v1/ventures/${ventureId}/computers`),
  );
  useEffect(() => {
    if (!query.data?.items.length) return;
    const timer = setInterval(() => {
      setStamp(Date.now());
      void query.refetch();
    }, 1500);
    return () => clearInterval(timer);
  }, [ventureId, Boolean(query.data?.items.length)]);
  const unavailable =
    query.error instanceof ApiError && query.error.status === 404;
  return (
    <>
      <PageHeader
        title="Computers"
        description="Watch the desktops agents use for research, visual testing and bug reproduction."
      />
      <ErrorNotice
        error={!unavailable ? (query.error ?? action.error) : action.error}
        retry={query.refetch}
      />
      {query.loading ? (
        <Loading />
      ) : query.data?.items.length ? (
        <div className="computer-grid">
          {query.data.items.map((computer) => (
            <Card key={computer.id}>
              <div className="card-heading">
                <h2>{computer.agent_id}</h2>
                <Status value={computer.status} />
              </div>
              <ComputerScreen id={computer.id} stamp={stamp} />
              <p>{computer.current_task?.goal ?? "No active task"}</p>
              <div className="detail-strip">
                <span>{titleCase(computer.provider)}</span>
                <span>{computer.current_task?.steps ?? 0} steps</span>
              </div>
              {computer.current_task&&<RecentComputerActions taskId={computer.current_task.id}/>}
              <div className="actions">
                {computer.current_task && (
                  <Link
                    className="button small"
                    to={`/computer-tasks/${computer.current_task.id}`}
                  >
                    View task
                  </Link>
                )}
                <button
                  className="button small"
                  disabled={action.working || computer.status === "stopped"}
                  onClick={() =>
                    void action.run(async () => {
                      await post(`/v1/computers/${computer.id}/stop`);
                      await query.refetch();
                    })
                  }
                >
                  Stop
                </button>
                {computer.provider.includes("space") &&
                  safeUrl(computer.watch_url) && (
                    <a
                      className="button small"
                      href={safeUrl(computer.watch_url)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Take over ↗
                    </a>
                  )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <Empty
            title={
              unavailable
                ? "Computer monitoring is not available yet."
                : "No agent is using a computer right now."
            }
          >
            Leo, Ines, Ben and Yuki use one for competitor pricing, lead
            research, visual QA and bug reproduction.
          </Empty>
        </Card>
      )}
    </>
  );
}
interface Task {
  id: string;
  goal: string;
  status: string;
  allowed_domains?: string[];
  allowed_domains_json?: string;
  steps: number;
  result?: unknown;
  actions: ComputerAction[];
}
function RecentComputerActions({taskId}:{taskId:string}){
  const query=useQuery<Task>(`/v1/computer-tasks/${taskId}`,()=>get(`/v1/computer-tasks/${taskId}`));
  useEffect(()=>{if(query.data?.status!=='running')return;const timer=setInterval(()=>void query.refetch(),1500);return()=>clearInterval(timer);},[taskId,query.data?.status]);
  return <div className="recent-computer-actions"><ErrorNotice error={query.error} retry={query.refetch}/>{query.data?.actions.slice(-5).map(step=><div className="standup-update" key={step.step}><strong>Step {step.step}</strong> <Status value={step.guard}/><p>{step.reason}</p></div>)}</div>;
}
export function ComputerTask() {
  const { id } = useParams();
  const {ventureId}=useCompany();
  const approvals=useQuery<ListPage<Approval>>(ventureId?`/v1/ventures/${ventureId}/approvals`:null,()=>get(`/v1/ventures/${ventureId}/approvals`));
  const query = useQuery<Task>(`/v1/computer-tasks/${id}`, () =>
    get(`/v1/computer-tasks/${id}`),
  );
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    if (query.data?.status !== "running") return;
    const timer = setInterval(() => void query.refetch(), 1500);
    return () => clearInterval(timer);
  }, [id, query.data?.status]);
  if (query.loading) return <Loading />;
  if (!query.data)
    return <ErrorNotice error={query.error} retry={query.refetch} />;
  const task = query.data,
    screen = task.actions[selected];
  return (
    <>
      <PageHeader title="Computer task" description={task.goal} />
      <Card>
        <Status value={task.status} />
        <p>
          Allowed domains:{" "}
          {task.allowed_domains?.join(", ") ??
            "Recorded by the computer provider"}
        </p>
        {screen?.screenshot_url && safeUrl(screen.screenshot_url) && (
          <img
            className="task-screen"
            src={safeUrl(screen.screenshot_url)}
            alt={`Computer step ${screen.step}`}
          />
        )}
        <label>
          Inspect step
          <input
            type="range"
            min="0"
            max={Math.max(0, task.actions.length - 1)}
            value={selected}
            onChange={(event) => setSelected(Number(event.target.value))}
          />
        </label>
        <ol className="action-timeline">
          {task.actions.map((step, index) => (
            <li key={step.step}>
              <button onClick={() => setSelected(index)}>
                <strong>Step {step.step}</strong>
                <Status value={step.guard} />
                <p>{step.reason}</p>
                <pre>{JSON.stringify(step.action, null, 2)}</pre>
              </button>
            </li>
          ))}
        </ol>
        {task.result !== undefined && (
          <details>
            <summary>Task result</summary>
            <pre>{JSON.stringify(task.result, null, 2)}</pre>
          </details>
        )}
      </Card>
      <div className="approval-grid">{approvals.data?.items.filter(approval=>approval.gate_type==='computer_action'&&approval.payload.task_id===id).map(approval=><ApprovalCard key={approval.id} approval={approval}/>)}</div>
    </>
  );
}

interface MetricsData {
  engineering?: {
    first_run_pass_rate?: number;
    loop_pass_rate?: number;
    avg_iterations?: number;
  };
  grounding?: {
    accuracy?: number;
    n?: number;
    citation_accuracy?: number;
    checker_agreement?: number;
  };
  world?: { final_score?: number };
  latency?: { p50?: number; p90?: number; p50_ms?: number; p90_ms?: number };
  costs?: unknown;
}
export function Metrics() {
  const { ventureId } = useCompany();
  const query = useQuery<MetricsData>(
    ventureId ? `/v1/ventures/${ventureId}/metrics` : null,
    () => get(`/v1/ventures/${ventureId}/metrics`),
  );
  const budget = useQuery<Budget>(
    ventureId ? `/v1/ventures/${ventureId}/budget` : null,
    () => get(`/v1/ventures/${ventureId}/budget`),
  );
  const world = useQuery<WorldgenRunSummary>("/v1/world/worldgen/latest", () =>
    get("/v1/world/worldgen/latest"),
  );
  const evals = useQuery<Record<string, unknown>>("/v1/evals/latest", () =>
    get("/v1/evals/latest"),
  );
  const missing = query.error instanceof ApiError && query.error.status === 404;
  return (
    <>
      <PageHeader
        title="Metrics"
        description="Evidence from recorded work. Unmeasured results stay unmeasured."
        actions={
          <Link className="button" to="/world-lab">
            Open World Lab ↗
          </Link>
        }
      />
      <ErrorNotice
        error={!missing ? query.error : null}
        retry={query.refetch}
      />
      <div className="kpi-grid">
        <Card>
          <span className="overline">World score</span>
          <strong className="kpi-value">
            {percent(
              world.data?.final_world_score ?? query.data?.world?.final_score,
            )}
          </strong>
          <Link className="text-link" to="/world-lab">
            See the recorded loop →
          </Link>
        </Card>
        <Card>
          <span className="overline">Grounding accuracy</span>
          <strong className="kpi-value">
            {percent(query.data?.grounding?.accuracy)}
          </strong>
          <span className="muted">
            {query.data?.grounding?.n !== undefined
              ? `${query.data.grounding.n} evaluated answers`
              : "No evaluation recorded yet"}
          </span>
        </Card>
        <Card>
          <span className="overline">Total spend</span>
          <strong className="kpi-value">
            {budget.data ? currency(budget.data.spent_usd) : "—"}
          </strong>
          <span className="muted">Recorded costs only</span>
        </Card>
        <Card>
          <span className="overline">Response latency</span>
          <strong className="kpi-value">
            {query.data?.latency?.p50_ms ?? query.data?.latency?.p50 ?? "—"}
            <small> ms p50</small>
          </strong>
          <span className="muted">
            p90{" "}
            {query.data?.latency?.p90_ms ??
              query.data?.latency?.p90 ??
              "not recorded"}
          </span>
        </Card>
      </div>
      <div className="two-column">
        <Card title="Engineering outcomes">
          {query.data?.engineering?.first_run_pass_rate !== undefined ? (
            <dl className="detail-grid">
              <div>
                <dt>First run pass rate</dt>
                <dd>{percent(query.data.engineering.first_run_pass_rate)}</dd>
              </div>
              <div>
                <dt>Loop pass rate</dt>
                <dd>{percent(query.data.engineering.loop_pass_rate)}</dd>
              </div>
              <div>
                <dt>Average iterations</dt>
                <dd>
                  {query.data.engineering.avg_iterations ?? "Not recorded"}
                </dd>
              </div>
            </dl>
          ) : (
            <Empty title="No engineering evaluation yet">
              Baseline and loop comparisons appear after an evaluation has been
              run.
            </Empty>
          )}
          {evals.data && (
            <details>
              <summary>Latest evaluation records</summary>
              <pre>{JSON.stringify(evals.data, null, 2)}</pre>
            </details>
          )}
        </Card>
        <Card title="Grounded answers">
          <dl className="detail-grid">
            <div>
              <dt>Citation accuracy</dt>
              <dd>{percent(query.data?.grounding?.citation_accuracy)}</dd>
            </div>
            <div>
              <dt>Checker agreement</dt>
              <dd>{percent(query.data?.grounding?.checker_agreement)}</dd>
            </div>
          </dl>
          <p className="muted">
            Scores come from the grounding evaluation. Missing scores are never
            filled with estimates.
          </p>
        </Card>
      </div>
      <div className="two-column">
        <CostChart
          title="Spend by department"
          items={
            budget.data?.by_department.map((row) => ({
              name: titleCase(row.department_id ?? "Shared"),
              value: row.cost_usd,
            })) ?? []
          }
        />
        <CostChart
          title="Spend by model"
          items={
            budget.data?.by_model.map((row) => ({
              name: row.model ?? "Other tools",
              value: row.cost_usd,
            })) ?? []
          }
        />
      </div>
    </>
  );
}
function CostChart({
  title,
  items,
}: {
  title: string;
  items: { name: string; value: number }[];
}) {
  const max = Math.max(...items.map((item) => item.value), 0.01);
  return (
    <Card title={title}>
      {items.length ? (
        <div className="cost-chart">
          {items.map((item) => (
            <div key={item.name}>
              <div>
                <span>{item.name}</span>
                <strong>{currency(item.value)}</strong>
              </div>
              <div className="cost-bar">
                <span style={{ width: `${(item.value / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty title="No costs recorded yet">
          Usage appears here after the company makes model or tool calls.
        </Empty>
      )}
    </Card>
  );
}

export function Settings() {
  const { ventureId, system } = useCompany(),
    action = useAction(),
    [saved, setSaved] = useState(""),
    [approval, setApproval] = useState<string | null>(null);
  const query = useQuery<SettingsData>(
    ventureId ? `/v1/ventures/${ventureId}/settings` : null,
    () => get(`/v1/ventures/${ventureId}/settings`),
  );
  const [founder, setFounder] = useState(""),
    [budget, setBudget] = useState("25"),
    [autopilot, setAutopilot] = useState(false),
    [quality, setQuality] = useState("high");
  useEffect(() => {
    if (query.data) {
      setFounder(query.data.founder_name);
      setBudget(String(query.data.budget_usd));
      setAutopilot(query.data.autopilot_next);
      setQuality(query.data.quality_default);
    }
  }, [query.data]);
  async function save() {
    setSaved("");
    await action.run(async () => {
      const result = await post<SettingsData>(
        `/v1/ventures/${ventureId}/settings`,
        {
          founder_name: founder,
          budget_usd: Number(budget),
          autopilot_next: autopilot,
          quality_default: quality,
        },
      );
      setApproval(result.approval_id ?? null);
      setSaved(
        result.approval_id
          ? "Settings saved. Your budget increase is waiting for approval."
          : "Settings saved.",
      );
      invalidateQueries();
    });
  }
  return (
    <>
      <PageHeader
        title="Settings"
        description="The boundaries and preferences your company works within."
      />
      <ErrorNotice error={query.error ?? action.error} retry={query.refetch} />
      {query.loading ? (
        <Loading />
      ) : (
        <Card title="Company preferences">
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label>
              Founder name
              <input
                value={founder}
                onChange={(event) => setFounder(event.target.value)}
                minLength={2}
                maxLength={60}
                required
              />
            </label>
            <label>
              Budget (USD)
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
                required
              />
              <small>
                Increasing the budget creates an approval. The cap changes after
                you approve it.
              </small>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={autopilot}
                onChange={(event) => setAutopilot(event.target.checked)}
              />
              Plan the next cycle automatically
            </label>
            <label>
              World quality default
              <select
                value={quality}
                onChange={(event) => setQuality(event.target.value)}
              >
                {["low", "medium", "high"].map((value) => (
                  <option key={value} value={value}>
                    {titleCase(value)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Engineering executor
              <input
                readOnly
                value={
                  query.data?.executor ?? system?.executor ?? "Not recorded"
                }
              />
            </label>
            {saved && (
              <div className="notice" role="status">
                {saved}
                {approval && (
                  <Link to={`/approvals?id=${approval}`}>
                    Review budget request →
                  </Link>
                )}
              </div>
            )}
            <button
              className="button primary"
              disabled={action.working || !query.data}
            >
              {action.working ? "Saving…" : "Save settings"}
            </button>
          </form>
        </Card>
      )}
    </>
  );
}
export function Integrations() {
  const { ventureId, system } = useCompany(),
    action = useAction(),
    [notice, setNotice] = useState("");
  const query = useQuery<
    ListPage<{
      provider: string;
      status: string;
      repo_full_name?: string | null;
    }>
  >(ventureId ? `/v1/ventures/${ventureId}/integrations` : null, () =>
    get(`/v1/ventures/${ventureId}/integrations`),
  );
  const approvals = useQuery<ListPage<Approval>>(
    ventureId ? `/v1/ventures/${ventureId}/approvals?status=pending` : null,
    () => get(`/v1/ventures/${ventureId}/approvals?status=pending`),
  );
  const gate = approvals.data?.items.find((a) => a.gate_type === "integration");
  async function connect() {
    await action.run(async () => {
      try {
        const response = await post<{ redirect_url: string }>(
          `/v1/ventures/${ventureId}/integrations/github/connect`,
          { callback_url: `${location.origin}/integrations?connected=github` },
        );
        const url = safeUrl(response.redirect_url);
        if (url) location.assign(url);
      } catch (error) {
        invalidateQueries();
        setNotice("Check Approvals for the GitHub connection request.");
        throw error;
      }
    });
  }
  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connections that give the team a place to work. Credentials stay on the server."
      />
      <ErrorNotice error={action.error} />
      <div className="integration-grid">
        <Card title="GitHub">
          <p>
            Repositories, pull requests, and verified changes through Composio.
          </p>
          <Status
            value={
              query.data?.items.find((item) => item.provider === "github")
                ?.status ?? "not_connected"
            }
          />
          {query.data?.items.find((item) => item.provider === "github")
            ?.repo_full_name && (
            <p>
              {
                query.data.items.find((item) => item.provider === "github")
                  ?.repo_full_name
              }
            </p>
          )}
          <div className="actions">
            <button
              className="button primary"
              disabled={action.working}
              onClick={() => void connect()}
            >
              Connect GitHub
            </button>
            <button
              className="button"
              disabled={action.working}
              onClick={() =>
                void action.run(async () => {
                  await post(
                    `/v1/ventures/${ventureId}/integrations/github/refresh`,
                  );
                  await query.refetch();
                })
              }
            >
              Refresh connection
            </button>
          </div>
          {notice && <p className="notice">{notice}</p>}
          {gate && (
            <Link to={`/approvals?id=${gate.id}`} className="text-link">
              Review connection approval →
            </Link>
          )}
        </Card>
        {Object.entries(system?.providers ?? {})
          .filter(([key]) => key !== "composio")
          .map(([name, value]) => (
            <Card
              title={name === "gemini" ? "Gemini" : titleCase(name)}
              key={name}
            >
              <Status
                value={value.configured ? "configured" : "not_configured"}
              />
              <p className="muted">
                {value.configured
                  ? "This provider is configured on the server."
                  : "This provider has not been configured yet."}
              </p>
            </Card>
          ))}
      </div>
    </>
  );
}
