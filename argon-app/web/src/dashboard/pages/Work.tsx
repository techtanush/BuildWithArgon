import { MarketingWorkspace } from '../components/MarketingWorkspace';
// OWNER: tanush
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { get, post } from "../../api/client";
import { invalidateQueries, useQuery } from "../../api/hooks";
import type {
  Approval,
  Artifact,
  ListPage,
  Run,
  RunLog,
  Ticket,
} from "../../shared/contracts";
import { useCompany } from "../context";
import { BuildNotifications } from "../components/BuildNotifications";
import type { AgentDetail, TicketDetail } from "../types";
import { currency, safeUrl, titleCase } from "../types";
import { ApprovalCard } from "../components/ApprovalCard";
import {
  ArtifactList,
  RunTable,
  TicketGraph,
  TicketTable,
} from "../components/Records";
import {
  Card,
  Empty,
  ErrorNotice,
  Loading,
  Markdown,
  PageHeader,
  Status,
  useAction,
} from "../components/Shared";

export function Tickets() {
  const { ventureId } = useCompany(),
    [status, setStatus] = useState(""),
    [department, setDepartment] = useState(""),
    [type, setType] = useState(""),
    [graph, setGraph] = useState(false),
    [older, setOlder] = useState<Ticket[]>([]),
    action = useAction();
  const params = new URLSearchParams({
    limit: "200",
    ...(status ? { status } : {}),
    ...(department ? { department_id: department } : {}),
    ...(type ? { type } : {}),
  });
  const key = ventureId ? `/v1/ventures/${ventureId}/tickets?${params}` : null;
  const query = useQuery<ListPage<Ticket>>(key, () => get(key!));
  const all = useQuery<ListPage<Ticket>>(
    ventureId ? `/v1/ventures/${ventureId}/tickets?limit=200` : null,
    () => get(`/v1/ventures/${ventureId}/tickets?limit=200`),
  );
  useEffect(() => setOlder([]), [key]);
  const [cursor, setCursor] = useState<string | null>(null);
  useEffect(() => setCursor(null), [key]);
  const items = [...(query.data?.items ?? []), ...older].filter(
    (t, i, a) => a.findIndex((x) => x.id === t.id) === i,
  );
  return (
    <>
      <PageHeader
        title="Tickets"
        description="Follow each unit of work, from the first brief to the final handoff."
        actions={
          <button className="button" onClick={() => setGraph(!graph)}>
            {graph ? "List view" : "Graph view"}
          </button>
        }
      />
      <div className="filters">
        <label>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            {[
              "open",
              "in_progress",
              "waiting_approval",
              "blocked",
              "done",
              "failed",
              "cancelled",
            ].map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Department
          <select
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
          >
            <option value="">All departments</option>
            {[...new Set(all.data?.items.map((t) => t.department_id))]
              .sort()
              .map((d) => (
                <option key={d}>{d}</option>
              ))}
          </select>
        </label>
        <label>
          Ticket type
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="">All types</option>
            {[...new Set(all.data?.items.map((t) => t.type))]
              .sort()
              .map((t) => (
                <option key={t}>{t}</option>
              ))}
          </select>
        </label>
      </div>
      <ErrorNotice error={query.error ?? action.error} retry={query.refetch} />
      <Card>
        {query.loading ? (
          <Loading />
        ) : graph ? (
          <TicketGraph items={items} />
        ) : (
          <TicketTable items={items} />
        )}
      </Card>
      {(cursor === null ? query.data?.next_cursor : cursor) && (
        <button
          className="button"
          disabled={action.working}
          onClick={() =>
            void action.run(async () => {
              const next = cursor ?? query.data?.next_cursor;
              const page = await get<ListPage<Ticket>>(
                `${key}&cursor=${encodeURIComponent(next!)}`,
              );
              setOlder((old) => [...old, ...page.items]);
              setCursor(page.next_cursor ?? "");
            })
          }
        >
          Load older tickets
        </button>
      )}
    </>
  );
}
export function TicketPage() {
  const { id } = useParams(),
    action = useAction();
  const query = useQuery<TicketDetail>(`/v1/tickets/${id}`, () =>
    get(`/v1/tickets/${id}`),
  );
  if (query.loading) return <Loading />;
  if (!query.data)
    return <ErrorNotice error={query.error} retry={query.refetch} />;
  const ticket = query.data;
  const operate = (actionName: string) =>
    action.run(async () => {
      await post(`/v1/tickets/${id}/${actionName}`);
      invalidateQueries();
    });
  return (
    <>
      <PageHeader
        eyebrow={ticket.type}
        title={ticket.title}
        actions={
          <>
            {["failed", "blocked", "cancelled"].includes(ticket.status) && (
              <button
                className="button"
                disabled={action.working}
                onClick={() => void operate("retry")}
              >
                Retry ticket
              </button>
            )}
            {!["done", "cancelled"].includes(ticket.status) && (
              <button
                className="button"
                disabled={action.working}
                onClick={() => void operate("cancel")}
              >
                Cancel ticket
              </button>
            )}
          </>
        }
      />
      <ErrorNotice error={action.error} />
      <Card>
        <div className="detail-strip">
          <Status value={ticket.status} />
          <span>{titleCase(ticket.department_id)}</span>
          <Link to={`/agents/${ticket.assigned_agent_id}`}>
            {ticket.assigned_agent_id}
          </Link>
          <span>Priority {ticket.priority}</span>
          <span>
            Attempt {ticket.attempts} / {ticket.max_attempts}
          </span>
        </div>
        <Markdown
          text={ticket.body || "This ticket has no additional description."}
        />
        <dl className="detail-grid">
          <div>
            <dt>Created</dt>
            <dd>{new Date(ticket.created_at).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{new Date(ticket.updated_at).toLocaleString()}</dd>
          </div>
          {ticket.completed_at && (
            <div>
              <dt>Completed</dt>
              <dd>{new Date(ticket.completed_at).toLocaleString()}</dd>
            </div>
          )}
        </dl>
        {ticket.depends_on.length > 0 && (
          <p>
            Depends on:{" "}
            {ticket.depends_on.map((dep) => (
              <Link className="ref-chip" to={`/tickets/${dep}`} key={dep}>
                {dep.slice(-7)}
              </Link>
            ))}
          </p>
        )}
        <details>
          <summary>Ticket inputs</summary>
          <pre>{JSON.stringify(ticket.payload, null, 2)}</pre>
        </details>
        {ticket.result && (
          <details>
            <summary>Recorded result</summary>
            <pre>{JSON.stringify(ticket.result, null, 2)}</pre>
          </details>
        )}
      </Card>
      {ticket.approvals.length > 0 && (
        <div className="approval-grid">
          {ticket.approvals.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} />
          ))}
        </div>
      )}
      <Card title="Runs">
        <RunTable items={ticket.runs} />
      </Card>
      <Card title="Artifacts">
        <ArtifactList items={ticket.artifacts} />
      </Card>
      {ticket.children.length > 0 && (
        <Card title="Delegated work">
          <TicketTable items={ticket.children} />
        </Card>
      )}
    </>
  );
}
export function Runs() {
  const { ventureId } = useCompany();
  const query = useQuery<ListPage<Run>>(
    ventureId ? `/v1/ventures/${ventureId}/runs?limit=200` : null,
    () => get(`/v1/ventures/${ventureId}/runs?limit=200`),
  );
  return (
    <>
      <PageHeader
        title="Runs"
        description="The model calls and managed-agent interactions behind every result."
      />
      <BuildNotifications />
      <ErrorNotice error={query.error} retry={query.refetch} />
      <Card>
        {query.loading ? (
          <Loading />
        ) : (
          <RunTable items={query.data?.items ?? []} />
        )}
      </Card>
    </>
  );
}
export function RunPage() {
  const { id } = useParams();
  const {ventureId}=useCompany();
  const query = useQuery<Run>(`/v1/runs/${id}`, () => get(`/v1/runs/${id}`));
  const agentId=query.data?.agent_id;
  const agent=useQuery<AgentDetail>(ventureId&&agentId?`/v1/ventures/${ventureId}/agents/${agentId}`:null,()=>get(`/v1/ventures/${ventureId}/agents/${agentId}`));
  const logs = useQuery<ListPage<RunLog>>(`/v1/runs/${id}/logs`, () =>
    get(`/v1/runs/${id}/logs`),
  );
  useEffect(() => {
    document
      .getElementById("run-log-end")
      ?.scrollIntoView?.({ block: "nearest" });
  }, [logs.data?.items.length]);
  if (query.loading) return <Loading />;
  if (!query.data)
    return <ErrorNotice error={query.error} retry={query.refetch} />;
  const run = query.data;
  const managed = Boolean(run.interaction_id);
  let result: unknown = null;
  try {
    const line = run.output_text
      ?.split("\n")
      .reverse()
      .find((line) => line.startsWith("FOUNDRY_RESULT "));
    if (line) result = JSON.parse(line.slice("FOUNDRY_RESULT ".length));
  } catch {}
  return (
    <>
      <PageHeader
        eyebrow={run.agent_id ?? run.kind}
        title={titleCase(run.job)}
        description={
          managed
            ? "Provider interaction and recorded progress"
            : "Recorded model execution"
        }
      />
      <Card>
        <div className="detail-strip">
          <Status value={run.status} />
          <code>{run.model}</code>
          {run.ticket_id && (
            <Link to={`/tickets/${run.ticket_id}`}>Open ticket ↗</Link>
          )}
        </div>
        <dl className="detail-grid">
          <div>
            <dt>Interaction ID</dt>
            <dd>
              <code>{run.interaction_id ?? "Not recorded"}</code>
            </dd>
          </div>
          <div>
            <dt>Input / output tokens</dt>
            <dd>
              {run.tokens_in.toLocaleString()} /{" "}
              {run.tokens_out.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt>Cost</dt>
            <dd>{currency(run.cost_usd)}</dd>
          </div>
          <div><dt>Thinking level</dt><dd>{agent.data?.runtime?.jobs.find(job=>job.job===run.job)?.thinking_level??'Not recorded'}</dd></div>
          <div>
            <dt>Started</dt>
            <dd>
              {run.started_at
                ? new Date(run.started_at).toLocaleString()
                : "Queued"}
            </dd>
          </div>
        </dl>
        {["engineering_build", "engineering_fix"].includes(run.job) && (
          <p className="notice">
            Engineering runs use repository context and verify changes through
            build and test iterations. The recorded token usage, logs and result
            below show the evidence available for this run.
          </p>
        )}
        {run.error && <ErrorNotice error={run.error} />}
      </Card>
      <Card title="Live progress">
        <ErrorNotice error={logs.error} retry={logs.refetch} />
        <div className="run-logs" role="log">
          {logs.data?.items.map((log) => (
            <div key={log.id} className={`log-${log.level}`}>
              <time>{new Date(log.ts).toLocaleTimeString()}</time>
              <span>{log.level}</span>
              <pre>{log.message}</pre>
            </div>
          ))}
          {!logs.data?.items.length && (
            <p>No progress messages have been recorded yet.</p>
          )}
          <span id="run-log-end" />
        </div>
      </Card>
      {result !== null && (
        <Card title="Managed-agent result">
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </Card>
      )}
      <Card title="Output">
        {run.output_text ? (
          <Markdown text={run.output_text} />
        ) : (
          <Empty title="No output yet">
            The final result will appear when the interaction finishes.
          </Empty>
        )}
      </Card>
    </>
  );
}
export function Approvals() {
  const { ventureId } = useCompany();
  const query = useQuery<ListPage<Approval>>(
    ventureId ? `/v1/ventures/${ventureId}/approvals` : null,
    () => get(`/v1/ventures/${ventureId}/approvals`),
  );
  const target = new URLSearchParams(location.search).get("id");
  useEffect(() => {
    if (target && query.data)
      document.getElementById(target)?.scrollIntoView?.({ block: "center" });
  }, [target, query.data]);
  const sorted = [...(query.data?.items ?? [])].sort(
    (a, b) =>
      Number(b.status === "pending") - Number(a.status === "pending") ||
      b.created_at.localeCompare(a.created_at),
  );
  return (
    <>
      <PageHeader
        eyebrow="People stay in control"
        title="Approvals"
        description="The company brings consequential decisions to you. Review the evidence before acting."
      />
      <ErrorNotice error={query.error} retry={query.refetch} />
      {query.loading ? (
        <Loading />
      ) : sorted.length ? (
        <div className="approval-grid">
          {sorted.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} />
          ))}
        </div>
      ) : (
        <Card>
          <Empty title="Nothing waiting on you">
            Requests to spend, merge, contact people or add capabilities will
            appear here.
          </Empty>
        </Card>
      )}
    </>
  );
}
export function Artifacts() {
  const { ventureId } = useCompany(),
    [kind, setKind] = useState(""),
    [department, setDepartment] = useState("");
  const key = ventureId
    ? `/v1/ventures/${ventureId}/artifacts?limit=200${kind ? `&kind=${encodeURIComponent(kind)}` : ""}${department ? `&department_id=${encodeURIComponent(department)}` : ""}`
    : null;
  const query = useQuery<ListPage<Artifact>>(key, () => get(key!));
  const all = useQuery<ListPage<Artifact>>(
    ventureId ? `/v1/ventures/${ventureId}/artifacts?limit=200` : null,
    () => get(`/v1/ventures/${ventureId}/artifacts?limit=200`),
  );
  return (
    <>
      <PageHeader
        title="Artifacts"
        description="The company’s work, preserved with its sources and the people who made it."
      />
      {ventureId && <MarketingWorkspace key={ventureId} ventureId={ventureId} />}
      <div className="filters">
        <label>
          Kind
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="">All kinds</option>
            {[...new Set(all.data?.items.map((a) => a.kind))]
              .sort()
              .map((value) => (
                <option key={value}>{value}</option>
              ))}
          </select>
        </label>
        <label>
          Department
          <select
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
          >
            <option value="">All departments</option>
            {[
              ...new Set(
                all.data?.items
                  .map((a) => a.department_id)
                  .filter((value): value is string => Boolean(value)),
              ),
            ]
              .sort()
              .map((value) => (
                <option key={value}>{value}</option>
              ))}
          </select>
        </label>
      </div>
      <ErrorNotice error={query.error} retry={query.refetch} />
      <Card>
        {query.loading ? (
          <Loading />
        ) : (
          <ArtifactList items={query.data?.items ?? []} />
        )}
      </Card>
    </>
  );
}
export function ArtifactPage() {
  const { id } = useParams();
  const query = useQuery<Artifact>(`/v1/artifacts/${id}`, () =>
    get(`/v1/artifacts/${id}`),
  );
  if (query.loading) return <Loading />;
  if (!query.data)
    return <ErrorNotice error={query.error} retry={query.refetch} />;
  const artifact = query.data,
    url = safeUrl(artifact.uri);
  return (
    <>
      <PageHeader
        eyebrow={artifact.kind}
        title={artifact.title}
        description={artifact.summary}
        actions={
          url ? (
            <a
              className="button primary"
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              Open artifact ↗
            </a>
          ) : undefined
        }
      />
      <Card>
        <div className="detail-strip">
          {artifact.agent_id && (
            <Link to={`/agents/${artifact.agent_id}`}>{artifact.agent_id}</Link>
          )}
          {artifact.ticket_id && (
            <Link to={`/tickets/${artifact.ticket_id}`}>Source ticket ↗</Link>
          )}
          <time>{new Date(artifact.created_at).toLocaleString()}</time>
        </div>
        <Markdown text={artifact.content_md ?? artifact.summary} />
      </Card>
      <Card title="Recorded metadata">
        <pre>{JSON.stringify(artifact.meta, null, 2)}</pre>
      </Card>
    </>
  );
}
