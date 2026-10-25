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
              {computer.current_task && (
                <RecentComputerActions taskId={computer.current_task.id} />
              )}
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
function RecentComputerActions({ taskId }: { taskId: string }) {
  const query = useQuery<Task>(`/v1/computer-tasks/${taskId}`, () =>
    get(`/v1/computer-tasks/${taskId}`),
  );
  useEffect(() => {
    if (query.data?.status !== "running") return;
    const timer = setInterval(() => void query.refetch(), 1500);
    return () => clearInterval(timer);
  }, [taskId, query.data?.status]);
  return (
    <div className="recent-computer-actions">
      <ErrorNotice error={query.error} retry={query.refetch} />
      {query.data?.actions.slice(-5).map((step) => (
        <div className="standup-update" key={step.step}>
          <strong>Step {step.step}</strong> <Status value={step.guard} />
          <p>{step.reason}</p>
        </div>
      ))}
    </div>
  );
}
export function ComputerTask() {
  const { id } = useParams();
  const { ventureId } = useCompany();
  const approvals = useQuery<ListPage<Approval>>(
    ventureId ? `/v1/ventures/${ventureId}/approvals` : null,
    () => get(`/v1/ventures/${ventureId}/approvals`),
  );
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
      <div className="approval-grid">
        {approvals.data?.items
          .filter(
            (approval) =>
              approval.gate_type === "computer_action" &&
              approval.payload.task_id === id,
          )
          .map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} />
          ))}
      </div>
    </>
  );
}

interface MetricsData {
  engineering?: {
    first_run_pass_rate?: number | null;
    loop_pass_rate?: number | null;
    avg_iterations?: number | null;
    n: number;
    first_pass_n: number;
    final_pass_n: number;
    cost_per_shipped_task: number | null;
    tickets: {
      ticket_id: string;
      title: string;
      status: string;
      first_pass_passed: boolean | null;
      final_passed: boolean | null;
      iterations: number | null;
      tests_passed: number | null;
      tests_failed: number | null;
      cost_usd: number | null;
    }[];
  };
  grounding?: {
    accuracy?: number | null;
    n?: number;
    citation_accuracy?: number | null;
    checker_agreement?: number | null;
    route_accuracy?: number | null;
    fabrication_rate?: number | null;
    answerer?: string | null;
    capability_evidence?: boolean | null;
  };
  world?: { final_score?: number | null };
  latency?: {
    n: number;
    p50_ms: number | null;
    p90_ms: number | null;
    by_stage: Record<
      string,
      { n: number; p50_ms: number | null; p90_ms: number | null }
    >;
  };
  costs?: unknown;
}
interface EvaluationSuite {
  suite: string;
  created_at: string;
  answerer: string | null;
  capability_evidence: boolean | null;
  items: {
    id: string;
    case_id: string;
    condition: string;
    metrics: Record<string, unknown>;
    created_at: string;
  }[];
}
interface LatestEvaluations {
  engineering: EvaluationSuite | null;
  grounding: EvaluationSuite | null;
  world: EvaluationSuite | null;
}
function EvaluationTable({ suite }: { suite: EvaluationSuite }) {
  const columns = [
    ...new Set(suite.items.flatMap((row) => Object.keys(row.metrics))),
  ].filter(
    (key) =>
      ![
        "evaluation_id",
        "report_id",
        "run_id",
        "summary",
        "answerer",
        "capability_evidence",
        "answer",
      ].includes(key),
  );
  return (
    <Card title={`${titleCase(suite.suite)} · raw evaluation results`}>
      <p className="card-intro">
        {new Date(suite.created_at).toLocaleString()} · failures included ·{" "}
        {suite.answerer ?? "unlabelled"} answerer
      </p>
      {suite.capability_evidence === false && (
        <p className="notice">
          Fake or injected evaluation. These results test the implementation and
          do not measure live model capability.
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Case</th>
              <th>Condition</th>
              {columns.map((key) => (
                <th key={key}>{titleCase(key)}</th>
              ))}
              <th>Answer & sources</th>
            </tr>
          </thead>
          <tbody>
            {suite.items.map((row) => (
              <tr key={row.id}>
                <td>{row.case_id}</td>
                <td>{row.condition}</td>
                {columns.map((key) => (
                  <td key={key}>
                    {row.metrics[key] === null || row.metrics[key] === undefined
                      ? "Not scored"
                      : typeof row.metrics[key] === "object"
                        ? JSON.stringify(row.metrics[key])
                        : String(row.metrics[key])}
                  </td>
                ))}
                <td>
                  {row.metrics.answer !== undefined ? (
                    <details>
                      <summary>Inspect answer</summary>
                      <pre>{JSON.stringify(row.metrics.answer, null, 2)}</pre>
                    </details>
                  ) : (
                    "Not recorded"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
function EngineeringComparison({ suite }: { suite: EvaluationSuite }) {
  const groups = ["baseline", "loop"].map((condition) => {
    const rows = suite.items.filter((row) => row.condition === condition);
    const measured = rows
      .map((row) => row.metrics.all_hidden_pass)
      .filter((value): value is boolean => typeof value === "boolean");
    return {
      condition,
      n: measured.length,
      rate: measured.length
        ? measured.filter(Boolean).length / measured.length
        : null,
    };
  });
  if (!groups.some((group) => group.n)) return null;
  return (
    <Card title="Engineering evaluation · baseline versus loop">
      <svg
        viewBox="0 0 460 235"
        role="img"
        aria-label="Engineering hidden acceptance test pass rates"
        style={{ width: "100%", maxHeight: 260 }}
      >
        <path d="M50 20V190H430" stroke="#D5C7B0" fill="none" />
        {groups.map((group, index) => (
          <g key={group.condition}>
            <rect
              x={100 + index * 175}
              y={group.rate === null ? 190 : 190 - group.rate * 155}
              width="90"
              height={(group.rate ?? 0) * 155}
              fill={index ? "#D67B48" : "#B8A58A"}
              rx="4"
            />
            <text
              x={145 + index * 175}
              y="211"
              textAnchor="middle"
              fontSize="12"
              fill="#8E7759"
            >
              {titleCase(group.condition)} · n={group.n}
            </text>
            <text
              x={145 + index * 175}
              y={
                group.rate === null ? 173 : Math.max(20, 180 - group.rate * 155)
              }
              textAnchor="middle"
              fontSize="13"
              fill="#765B3A"
            >
              {percent(group.rate)}
            </text>
          </g>
        ))}
      </svg>
      <p className="muted small-text">
        Each rate uses only recorded hidden-test outcomes. Missing conditions
        stay unscored.
      </p>
    </Card>
  );
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
  const evals = useQuery<LatestEvaluations>("/v1/evals/latest", () =>
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
          {query.data?.grounding?.capability_evidence === false && (
            <span className="fake-badge">
              {query.data.grounding.answerer ?? "Fake"} evaluation
            </span>
          )}
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
            {query.data?.latency?.p50_ms?.toFixed(0) ?? "—"}
            <small> ms p50</small>
          </strong>
          <span className="muted">
            p90 {query.data?.latency?.p90_ms?.toFixed(0) ?? "not recorded"} ms ·{" "}
            {query.data?.latency?.n ?? 0} samples
          </span>
        </Card>
      </div>
      <div className="two-column">
        <Card title="Engineering outcomes">
          {query.data?.engineering?.n ? (
            <dl className="detail-grid">
              <div>
                <dt>First run pass rate</dt>
                <dd>{percent(query.data.engineering.first_run_pass_rate)}</dd>
                <small>
                  {query.data.engineering.first_pass_n} measured builds
                </small>
              </div>
              <div>
                <dt>Loop pass rate</dt>
                <dd>{percent(query.data.engineering.loop_pass_rate)}</dd>
                <small>
                  {query.data.engineering.final_pass_n} measured builds
                </small>
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
          {query.data?.engineering?.cost_per_shipped_task != null && (
            <p className="muted">
              Cost per shipped task:{" "}
              {currency(query.data.engineering.cost_per_shipped_task)}
            </p>
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
            <div>
              <dt>Route accuracy</dt>
              <dd>{percent(query.data?.grounding?.route_accuracy)}</dd>
            </div>
            <div>
              <dt>Fabrication rate</dt>
              <dd>{percent(query.data?.grounding?.fabrication_rate)}</dd>
            </div>
          </dl>
          <p className="muted">
            Scores come from the grounding evaluation. Missing scores are never
            filled with estimates.
          </p>
          {query.data?.grounding?.capability_evidence === false && (
            <p className="notice">
              Implementation check only ·{" "}
              {query.data.grounding.answerer ?? "fake or injected"} answers.
              This is not live model quality evidence.
            </p>
          )}
        </Card>
      </div>
      {Boolean(query.data?.engineering?.tickets.length) && (
        <Card title="Recorded build outcomes">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Build ticket</th>
                  <th>First pass</th>
                  <th>Final pass</th>
                  <th>Iterations</th>
                  <th>Tests passed / failed</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {query.data?.engineering?.tickets.map((ticket) => (
                  <tr key={ticket.ticket_id}>
                    <td>
                      <Link to={`/tickets/${ticket.ticket_id}`}>
                        {ticket.title}
                      </Link>
                      <small>{ticket.status}</small>
                    </td>
                    <td>
                      {ticket.first_pass_passed == null
                        ? "Not recorded"
                        : ticket.first_pass_passed
                          ? "Passed"
                          : "Failed"}
                    </td>
                    <td>
                      {ticket.final_passed == null
                        ? "Not recorded"
                        : ticket.final_passed
                          ? "Passed"
                          : "Failed"}
                    </td>
                    <td>{ticket.iterations ?? "—"}</td>
                    <td>
                      {ticket.tests_passed ?? "—"} /{" "}
                      {ticket.tests_failed ?? "—"}
                    </td>
                    <td>
                      {ticket.cost_usd == null
                        ? "Not recorded"
                        : currency(ticket.cost_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {evals.data?.engineering && (
        <EngineeringComparison suite={evals.data.engineering} />
      )}
      {query.data?.latency && query.data.latency.n > 0 && (
        <Card title="Voice response latency">
          <p className="card-intro">
            Latest {query.data.latency.n} valid samples across all ventures ·
            milliseconds · maximum 500 samples
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>p50</th>
                  <th>p90</th>
                  <th>Samples</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(query.data.latency.by_stage).map(
                  ([stage, values]) => (
                    <tr key={stage}>
                      <td>{titleCase(stage.replace("_ms", ""))}</td>
                      <td>{values.p50_ms?.toFixed(0) ?? "—"}</td>
                      <td>{values.p90_ms?.toFixed(0) ?? "—"}</td>
                      <td>{values.n}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <ErrorNotice error={evals.error} retry={evals.refetch} />
      {evals.data &&
        Object.values(evals.data)
          .filter((suite): suite is EvaluationSuite => Boolean(suite))
          .map((suite) => <EvaluationTable key={suite.suite} suite={suite} />)}
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
