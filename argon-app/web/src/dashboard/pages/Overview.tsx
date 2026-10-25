// OWNER: tanush
import { Link } from "react-router-dom";
import { get, post } from "../../api/client";
import { invalidateQueries, useQuery } from "../../api/hooks";
import type {
  Agent,
  Approval,
  Artifact,
  Department,
  ListPage,
  SseEvent,
  Venture,
} from "../../shared/contracts";
import { useCompany } from "../context";
import { colors, currency, entityLink, titleCase } from "../types";
import { ApprovalCard } from "../components/ApprovalCard";
import {
  Card,
  Empty,
  ErrorNotice,
  Icon,
  Loading,
  PageHeader,
  Portrait,
  Status,
  useAction,
} from "../components/Shared";

function eventText(event: SseEvent) {
  const record = event.data as Record<string, unknown>;
  return String(
    record.title ??
      record.message ??
      record.body ??
      (event.type === "ledger.updated"
        ? `Spend updated to ${currency(Number(record.spent_usd ?? 0))}`
        : titleCase(event.type)),
  );
}
export default function Overview() {
  const { venture, ventureId } = useCompany();
  const action = useAction();
  const departments = useQuery<ListPage<Department>>(
    ventureId ? `/v1/ventures/${ventureId}/departments` : null,
    () => get(`/v1/ventures/${ventureId}/departments`),
  );
  const agents = useQuery<ListPage<Agent>>(
    ventureId ? `/v1/ventures/${ventureId}/agents` : null,
    () => get(`/v1/ventures/${ventureId}/agents`),
  );
  const approvals = useQuery<ListPage<Approval>>(
    ventureId ? `/v1/ventures/${ventureId}/approvals?status=pending` : null,
    () => get(`/v1/ventures/${ventureId}/approvals?status=pending`),
  );
  const activity = useQuery<ListPage<SseEvent>>(
    ventureId ? `/v1/ventures/${ventureId}/activity?limit=50` : null,
    () => get(`/v1/ventures/${ventureId}/activity?limit=50`),
  );
  const artifacts = useQuery<ListPage<Artifact>>(
    ventureId ? `/v1/ventures/${ventureId}/artifacts?limit=200` : null,
    () => get(`/v1/ventures/${ventureId}/artifacts?limit=200`),
  );
  if (!venture) return <Loading />;
  const counts = venture.stats?.tickets ?? {},
    total = Object.values(counts).reduce((sum, n) => sum + n, 0),
    done = counts.done ?? 0,
    pending = approvals.data?.items ?? [];
  const operation =
    venture.status === "draft"
      ? "start"
      : venture.status === "running"
        ? "pause"
        : "resume";
  const shipped =
    artifacts.data?.items.filter(
      (a) =>
        a.kind === "pr" &&
        (a.meta.merged === true || a.meta.status === "merged"),
    ).length ?? 0;
  async function changeStatus() {
    await action.run(async () => {
      await post(`/v1/ventures/${ventureId}/${operation}`);
      invalidateQueries();
    });
  }
  return (
    <>
      <PageHeader
        eyebrow="Your company, at a glance"
        title="Overview"
        actions={
          <button
            className="button"
            disabled={action.working}
            onClick={() => void changeStatus()}
          >
            {titleCase(operation)} company
          </button>
        }
      />
      <ErrorNotice error={action.error} />
      <section className="venture-hero">
        <div className="hero-copy">
          <span className="eyebrow">A company taking shape</span>
          <h2>
            {venture.name}
            <span className="orange-dot">.</span>
          </h2>
          <p>{venture.idea}</p>
          <Status value={venture.status} />
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbital-ring ring-one" />
          <div className="orbital-ring ring-two" />
          <span className="building-shape one" />
          <span className="building-shape two" />
          <span className="building-shape three" />
          <span className="town-caption">Ideas become places.</span>
        </div>
      </section>
      <div className="kpi-grid">
        <Card>
          <span className="overline">Tickets completed</span>
          <strong className="kpi-value">
            {done}
            <small> / {total}</small>
          </strong>
          <span className="muted small-text">Across every department</span>
        </Card>
        <Card>
          <span className="overline">Waiting on you</span>
          <strong className="kpi-value">
            {pending.length}
            <span className="kpi-dot" />
          </strong>
          <Link to="/approvals" className="text-link">
            Review decisions →
          </Link>
        </Card>
        <Card>
          <span className="overline">Company spend</span>
          <strong className="kpi-value">
            {currency(venture.spent_usd)}
            <small> / {currency(venture.budget_usd)}</small>
          </strong>
          <div className="budget-track">
            <span
              style={{
                width: `${Math.min(100, venture.budget_usd ? (venture.spent_usd / venture.budget_usd) * 100 : 0)}%`,
              }}
            />
          </div>
        </Card>
        <Card>
          <span className="overline">Builds shipped</span>
          <strong className="kpi-value">{shipped}</strong>
          <span className="muted small-text">Verified and merged work</span>
        </Card>
      </div>
      <div className="overview-columns">
        <div>
          <div className="section-heading">
            <div>
              <h2>Your departments</h2>
              <p>Thirteen teams. One shared direction.</p>
            </div>
            <Link to="/org" className="text-link">
              Meet the company <Icon name="arrow" size={14} />
            </Link>
          </div>
          <ErrorNotice error={departments.error} retry={departments.refetch} />
          <div className="department-grid">
            {departments.data?.items.map((department) => {
              const lead = agents.data?.items.find(
                (a) => department.agents.includes(a.id) && a.is_lead,
              );
              const latest = artifacts.data?.items.find(
                (a) => a.department_id === department.id,
              );
              return (
                <Link
                  to={`/departments/${department.id}`}
                  className="department-card"
                  key={department.id}
                  style={{ borderTopColor: colors[department.id] }}
                >
                  <div className="department-code">
                    <span>{department.code}</span>
                    <span>↗</span>
                  </div>
                  <h3>{department.name}</h3>
                  <p>{department.building_name}</p>
                  <div className="department-lead">
                    {lead && (
                      <>
                        <Portrait agent={lead} size={28} />
                        <span>{lead.display_name}</span>
                      </>
                    )}
                    <span className="department-count">
                      {department.counts?.in_progress ?? 0} working
                    </span>
                  </div>
                  <div className="department-stats">
                    <span>{department.counts?.open ?? 0} open</span>
                    <span>
                      {department.counts?.waiting_approval ?? 0} waiting
                    </span>
                    <span>{department.counts?.done ?? 0} done</span>
                  </div>
                  {latest && (
                    <small className="latest-artifact">↳ {latest.title}</small>
                  )}
                </Link>
              );
            })}
          </div>
          {pending.length > 0 && (
            <>
              <div className="section-heading">
                <h2>Waiting on you</h2>
                <Link to="/approvals" className="text-link">
                  All decisions →
                </Link>
              </div>
              <div className="approval-grid">
                {pending.slice(0, 3).map((approval) => (
                  <ApprovalCard compact approval={approval} key={approval.id} />
                ))}
              </div>
            </>
          )}
        </div>
        <Card
          title="Company activity"
          action={<span className="subtle-dot" />}
          className="activity-card"
        >
          <p className="card-intro">The latest from across the company.</p>
          <ErrorNotice error={activity.error} retry={activity.refetch} />
          <div className="activity-list">
            {[...(activity.data?.items ?? [])].reverse().map((event) => (
              <Link
                className="activity-item"
                to={
                  event.entity_id
                    ? entityLink(event.entity_kind ?? "", event.entity_id)
                    : "/"
                }
                key={event.id}
              >
                <span
                  className={`activity-icon ${event.type.startsWith("approval") ? "orange" : ""}`}
                >
                  <Icon
                    name={
                      event.type.startsWith("ticket")
                        ? "tickets"
                        : event.type.startsWith("approval")
                          ? "approvals"
                          : event.type.startsWith("artifact")
                            ? "artifacts"
                            : "runs"
                    }
                    size={14}
                  />
                </span>
                <div>
                  <span className="overline">{titleCase(event.type)}</span>
                  <p>{eventText(event)}</p>
                  <small>
                    {new Date(event.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                </div>
              </Link>
            ))}
          </div>
          {!activity.data?.items.length && (
            <Empty title="A quiet start">
              Launch your company to watch the team begin.
            </Empty>
          )}
        </Card>
      </div>
    </>
  );
}
