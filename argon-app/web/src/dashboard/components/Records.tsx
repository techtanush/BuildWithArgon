// OWNER: tanush
import { Link } from "react-router-dom";
import type { Artifact, Run, Ticket } from "../../shared/contracts";
import { currency, titleCase } from "../types";
import { Empty, Status } from "./Shared";
export function TicketTable({ items }: { items: Ticket[] }) {
  return items.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Department</th>
            <th>Status</th>
            <th>Priority</th>
          </tr>
        </thead>
        <tbody>
          {items.map((ticket) => (
            <tr key={ticket.id}>
              <td>
                <Link to={`/tickets/${ticket.id}`}>
                  <strong>{ticket.title}</strong>
                </Link>
                <small>{ticket.type}</small>
              </td>
              <td>{titleCase(ticket.department_id)}</td>
              <td>
                <Status value={ticket.status} />
              </td>
              <td>P{ticket.priority}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="No tickets yet">
      Work will appear here as the company plans and delegates.
    </Empty>
  );
}
export function RunTable({ items }: { items: Run[] }) {
  return items.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Run</th>
            <th>Model / agent</th>
            <th>Status</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {items.map((run) => (
            <tr key={run.id}>
              <td>
                <Link to={`/runs/${run.id}`}>
                  <strong>{titleCase(run.job)}</strong>
                </Link>
                <small>{run.agent_id ?? run.kind}</small>
              </td>
              <td>
                {run.model}
                <small>
                  {run.interaction_id
                    ? "Interaction recorded"
                    : "Model interaction"}
                </small>
              </td>
              <td>
                <Status value={run.status} />
              </td>
              <td>{currency(run.cost_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="No runs yet">
      Model calls and managed-agent work will appear when tickets start.
    </Empty>
  );
}
export function ArtifactList({ items }: { items: Artifact[] }) {
  return items.length ? (
    <div className="artifact-list">
      {items.map((artifact) => (
        <Link
          className="artifact-row"
          key={artifact.id}
          to={`/artifacts/${artifact.id}`}
        >
          <span className="document-mark">↗</span>
          <div>
            <span className="overline">{artifact.kind}</span>
            <h3>{artifact.title}</h3>
            <p>{artifact.summary}</p>
          </div>
          <span className="muted">→</span>
        </Link>
      ))}
    </div>
  ) : (
    <Empty title="No artifacts yet">
      Research, plans, code and reports will appear as the team works.
    </Empty>
  );
}
export function TicketGraph({ items }: { items: Ticket[] }) {
  const depths = new Map<string, number>();
  const lookup = new Map(items.map((t) => [t.id, t]));
  function depth(id: string, seen = new Set<string>()): number {
    if (depths.has(id)) return depths.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const row = lookup.get(id);
    const value = row?.depends_on.length
      ? 1 +
        Math.max(
          ...row.depends_on
            .filter((d) => lookup.has(d))
            .map((d) => depth(d, new Set(seen))),
          -1,
        )
      : 0;
    depths.set(id, value);
    return value;
  }
  const positions = new Map<string, { x: number; y: number }>(),
    counts = new Map<number, number>();
  for (const ticket of items) {
    const col = depth(ticket.id);
    const row = counts.get(col) ?? 0;
    counts.set(col, row + 1);
    positions.set(ticket.id, { x: col * 260 + 20, y: row * 105 + 20 });
  }
  const width = Math.max(700, ...[...positions.values()].map((p) => p.x + 250)),
    height = Math.max(220, ...[...positions.values()].map((p) => p.y + 100));
  if (!items.length)
    return (
      <Empty title="No dependency graph yet">
        The graph appears when the company creates tickets.
      </Empty>
    );
  return (
    <div className="graph-scroll">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Ticket dependency graph"
      >
        {items.flatMap((ticket) =>
          ticket.depends_on.map((dep) => {
            const from = positions.get(dep),
              to = positions.get(ticket.id);
            return from && to ? (
              <path
                key={`${dep}-${ticket.id}`}
                d={`M ${from.x + 220} ${from.y + 35} C ${from.x + 245} ${from.y + 35},${to.x - 25} ${to.y + 35},${to.x} ${to.y + 35}`}
                stroke="#C9C2B6"
                fill="none"
              />
            ) : null;
          }),
        )}
        {items.map((ticket) => {
          const p = positions.get(ticket.id)!;
          return (
            <g key={ticket.id} transform={`translate(${p.x},${p.y})`}>
              <rect
                width="220"
                height="70"
                rx="9"
                className={`graph-node node-${ticket.status}`}
              />
              <foreignObject width="220" height="70">
                <Link className="graph-link" to={`/tickets/${ticket.id}`}>
                  <span>{ticket.title}</span>
                  <small>{titleCase(ticket.status)}</small>
                </Link>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
