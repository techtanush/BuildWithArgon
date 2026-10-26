// OWNER: tanush
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { get, post } from "../../api/client";
import { invalidateQueries, useQuery } from "../../api/hooks";
import { subscribe } from "../../api/sse";
import type {
  Agent,
  Artifact,
  ChatTurn,
  Department,
  ListPage,
  TalkResponse,
} from "../../shared/contracts";
import { useCompany } from "../context";
import type { AgentDetail, DepartmentDetail } from "../types";
import { colors, generatedHire, titleCase } from "../types";
import { ArtifactList, RunTable, TicketTable } from "../components/Records";
import {
  Card,
  Empty,
  ErrorNotice,
  Loading,
  PageHeader,
  Portrait,
  RuntimeBadges,
  Sources,
  Status,
  useAction,
} from "../components/Shared";
import CallPanel from "../components/CallPanel";
import { ChannelView } from "./Chat";

export function Departments() {
  const { ventureId } = useCompany();
  const query = useQuery<ListPage<Department>>(
    ventureId ? `/v1/ventures/${ventureId}/departments` : null,
    () => get(`/v1/ventures/${ventureId}/departments`),
  );
  return (
    <>
      <PageHeader
        title="Departments"
        description="One company. Thirteen places where the work happens."
      />
      <ErrorNotice error={query.error} retry={query.refetch} />
      {query.loading ? (
        <Loading />
      ) : (
        <div className="department-grid wide">
          {query.data?.items.map((dept) => (
            <Link
              className="department-card"
              key={dept.id}
              to={`/departments/${dept.id}`}
              style={{ borderTopColor: colors[dept.id] }}
            >
              <div className="department-code">
                {dept.code}
                <span>↗</span>
              </div>
              <h3>{dept.name}</h3>
              <p>{dept.mission}</p>
              <div className="department-stats">
                <span>{dept.counts?.open ?? 0} open</span>
                <span>{dept.counts?.in_progress ?? 0} working</span>
                <span>{dept.counts?.done ?? 0} done</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
export function DepartmentPage() {
  const { id } = useParams(),
    { ventureId } = useCompany();
  const [tab, setTab] = useState("Tickets"),
    action = useAction();
  const query = useQuery<DepartmentDetail>(
    ventureId ? `/v1/ventures/${ventureId}/departments/${id}` : null,
    () => get(`/v1/ventures/${ventureId}/departments/${id}`),
  );
  const agents = useQuery<ListPage<Agent>>(
    ventureId ? `/v1/ventures/${ventureId}/agents` : null,
    () => get(`/v1/ventures/${ventureId}/agents`),
  );
  const runs = useQuery<ListPage<import("../../shared/contracts").Run>>(
    ventureId ? `/v1/ventures/${ventureId}/runs?limit=200` : null,
    () => get(`/v1/ventures/${ventureId}/runs?limit=200`),
  );
  if (query.loading) return <Loading />;
  if (!query.data)
    return <ErrorNotice error={query.error} retry={query.refetch} />;
  const dept = query.data;
  return (
    <>
      <PageHeader
        eyebrow={`${dept.code} · ${dept.building_name}`}
        title={dept.name}
        description={dept.mission}
        actions={
          dept.paused ? (
            <button
              className="button"
              disabled={action.working}
              onClick={() =>
                void action.run(async () => {
                  await post(
                    `/v1/ventures/${ventureId}/departments/${id}/resume`,
                  );
                  invalidateQueries();
                })
              }
            >
              Resume department
            </button>
          ) : undefined
        }
      />
      <ErrorNotice error={action.error} />
      <div className="people-grid">
        {agents.data?.items
          .filter((a) => dept.agents.includes(a.id))
          .map((agent) => <AgentCard key={agent.id} agent={agent} />)}
      </div>
      <div className="tabs" role="tablist" aria-label="Department records">
        {["Tickets", "Artifacts", "Chat", "Runs"].map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <Card>
        {tab === "Tickets" ? (
          <TicketTable items={dept.recent_tickets} />
        ) : tab === "Artifacts" ? (
          <ArtifactList items={dept.recent_artifacts} />
        ) : tab === "Chat" ? (
          <ChannelView channelId={dept.channel_id} />
        ) : (
          <RunTable
            items={
              runs.data?.items.filter((run) =>
                dept.agents.includes(run.agent_id ?? ""),
              ) ?? []
            }
          />
        )}
      </Card>
    </>
  );
}
export function AgentCard({
  agent,
  call,
}: {
  agent: Agent;
  call?: () => void;
}) {
  return (
    <article className="person-card">
      <Link to={`/agents/${agent.id}`} className="person-main">
        <Portrait agent={agent} size={54} />
        <div>
          <h3>{agent.display_name} {generatedHire(agent.id)&&<span className="kind-badge">New hire</span>}</h3>
          <p>{agent.title}</p>
        </div>
        <span className="person-arrow">↗</span>
      </Link>
      <RuntimeBadges runtime={agent.runtime} />
      <div className="person-footer">
        <span
          className="department-chip"
          style={{ color: colors[agent.department_id] }}
        >
          {titleCase(agent.department_id)}
        </span>
        <Status value={agent.state?.status ?? "idle"} />
        {call && (
          <button className="button small" onClick={call}>
            Call {agent.display_name}
          </button>
        )}
      </div>
    </article>
  );
}
export function Agents() {
  const { ventureId } = useCompany();
  const [filter, setFilter] = useState("");
  const query = useQuery<ListPage<Agent>>(
    ventureId ? `/v1/ventures/${ventureId}/agents` : null,
    () => get(`/v1/ventures/${ventureId}/agents`),
  );
  return (
    <>
      <PageHeader
        eyebrow="The people behind the work"
        title="Agents"
        description="Meet your team, see what they run on, and ask what they know."
      />
      <label className="search-field">
        Find an agent
        <input
          type="search"
          placeholder="Search name, role or department"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </label>
      <ErrorNotice error={query.error} retry={query.refetch} />
      {query.loading ? (
        <Loading />
      ) : (
        <div className="people-grid">
          {query.data?.items
            .filter((agent) =>
              `${agent.display_name} ${agent.title} ${agent.department_id}`
                .toLowerCase()
                .includes(filter.toLowerCase()),
            )
            .map((agent) => <AgentCard key={agent.id} agent={agent} />)}
        </div>
      )}
    </>
  );
}
export function AgentPage() {
  const { id } = useParams(),
    { ventureId } = useCompany(),
    [calling, setCalling] = useState(false),
    [text, setText] = useState(""),
    [history, setHistory] = useState<ChatTurn[]>([]),
    [answers, setAnswers] = useState<TalkResponse[]>([]),
    action = useAction();
  const scope = `${ventureId}:${id}`;
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const query = useQuery<AgentDetail>(
    ventureId ? `/v1/ventures/${ventureId}/agents/${id}` : null,
    () => get(`/v1/ventures/${ventureId}/agents/${id}`),
  );
  const artifacts = useQuery<ListPage<Artifact>>(
    ventureId ? `/v1/ventures/${ventureId}/artifacts?limit=200` : null,
    () => get(`/v1/ventures/${ventureId}/artifacts?limit=200`),
  );
  useEffect(() => {
    setHistory([]);
    setText("");
    setAnswers([]);
    setCalling(false);
  }, [id, ventureId]);
  useEffect(
    () =>
      ventureId
        ? subscribe(ventureId, (event) => {
            if (event.type === "answer.checked") {
              const data = event.data as {
                answer_id: string;
                check: TalkResponse["check"];
              };
              setAnswers((old) =>
                old.map((answer) =>
                  answer.answer_id === data.answer_id
                    ? { ...answer, check: data.check }
                    : answer,
                ),
              );
            }
          })
        : undefined,
    [ventureId],
  );
  if (query.loading) return <Loading />;
  if (!query.data)
    return <ErrorNotice error={query.error} retry={query.refetch} />;
  const agent = query.data;
  async function ask() {
    if (!text.trim() || action.working || !ventureId || !id) return;
    const requestScope = scope;
    const message = text.trim();
    await action.run(async () => {
      const answer = await post<TalkResponse>(
        `/v1/ventures/${ventureId}/agents/${id}/talk`,
        { text: message, history: history.slice(-6) },
      );
      if (activeScope.current !== requestScope) return;
      invalidateQueries(`/v1/ventures/${ventureId}/agents/${id}`);
      setHistory((old) => [
        ...old,
        { role: "user", text: message },
        { role: "agent", text: answer.text },
      ]);
      setAnswers((old) => [...old, answer]);
      setText("");
    });
  }
  return (
    <>
      <PageHeader
        eyebrow={titleCase(agent.department_id)}
        title={agent.display_name}
        description={agent.title}
        actions={
          <>
            <button className="button" onClick={() => setCalling(true)}>
              Call {agent.display_name}
            </button>
            <Link
              className="button primary"
              to={`/view?venture=${ventureId}&goto=${encodeURIComponent(agent.id)}`}
            >
              Find in the world ↗
            </Link>
          </>
        }
      />
      <div className="agent-profile">
        <Portrait agent={agent} size={100} />
        <div>
          <h2>{agent.title}</h2>
          <p>{agent.role_summary}</p>
          <p className="muted">{agent.persona}</p>
          <p className="overline">Runs on</p>
          <RuntimeBadges runtime={agent.runtime} />
          <Status value={agent.state?.status ?? "idle"} />
        </div>
      </div>
      <div className="two-column">
        <Card title="Talk">
          <p className="card-intro">
            Ask about this agent’s recorded work. Answers include sources.
          </p>
          <div className="talk-history">
            {history.map((turn, index) => (
              <div className={`conversation-turn ${turn.role}`} key={index}>
                <strong>
                  {turn.role === "user" ? "You" : agent.display_name}
                </strong>
                <p>{turn.text}</p>
                {turn.role === "agent" && answers[Math.floor(index / 2)] && (
                  <Sources answer={answers[Math.floor(index / 2)]} />
                )}
              </div>
            ))}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void ask();
            }}
          >
            <label>
              Message {agent.display_name}
              <textarea
                disabled={action.working}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="What are you working on?"
                rows={3}
                maxLength={4000}
              />
            </label>
            <ErrorNotice error={action.error} />
            <button
              className="button primary"
              disabled={action.working || !text.trim()}
            >
              {action.working ? "Asking…" : "Ask agent"}
            </button>
          </form>
        </Card>
        <Card title="Runtime & capabilities">
          <div className="runtime-jobs">
            {agent.runtime?.jobs.map((job) => (
              <div key={`${job.purpose}-${job.job}`}>
                <span className="overline">{job.purpose}</span>
                <strong>{titleCase(job.job)}</strong>
                <code>
                  {job.model}
                  {job.thinking_level ? ` · ${job.thinking_level}` : ""}
                </code>
              </div>
            ))}
          </div>
          <p className="muted">
            Tools: {agent.runtime?.tools.join(", ") || "No external tools"}
          </p>
          <p className="muted">
            Approval gates:{" "}
            {agent.runtime?.gates.map(titleCase).join(", ") ||
              "No consequential actions"}
          </p>
          {agent.current_ticket && (
            <Link
              className="current-ticket"
              to={`/tickets/${agent.current_ticket.id}`}
            >
              Current ticket → {agent.current_ticket.title}
            </Link>
          )}
        </Card>
      </div>
      <Card title="Recent runs">
        <RunTable items={agent.recent_runs} />
      </Card>
      <Card title="Artifacts">
        <ArtifactList
          items={
            artifacts.data?.items.filter((a) => a.agent_id === agent.id) ?? []
          }
        />
      </Card>
      {calling && ventureId && (
        <CallPanel
          agent={agent}
          ventureId={ventureId}
          onClose={() => setCalling(false)}
        />
      )}
    </>
  );
}
