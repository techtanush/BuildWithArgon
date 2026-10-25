// OWNER: tanush
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type {
  Agent,
  AgentRuntime,
  Citation,
  Ref,
  TalkResponse,
  ConciergeResponse,
} from "../../shared/contracts";
import { colors, entityLink, safeUrl, titleCase } from "../types";

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    departments: "M3 21V7l9-4 9 4v14 M8 21v-7h8v7 M7 8v2 M12 6v4 M17 8v2",
    agents:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
    tickets: "M4 3h16v18H4z M8 8h8 M8 12h8 M8 16h5",
    approvals: "M12 3l9 4v5c0 5-9 10-9 10S3 17 3 12V7z M8 12l3 3 5-6",
    chat: "M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0z M7 10h10 M7 14h6",
    org: "M9 3h6v5H9z M3 16h6v5H3z M15 16h6v5h-6z M12 8v4 M6 16v-4h12v4",
    computers: "M3 4h18v13H3z M8 21h8 M12 17v4",
    artifacts: "M4 3h10l6 6v12H4z M14 3v6h6 M8 13h8 M8 17h6",
    world: "M12 3l9 5v9l-9 5-9-5V8z M3 8l9 5 9-5 M12 13v9",
    metrics: "M4 3v18h17 M8 17v-5 M13 17V7 M18 17V4",
    integrations: "M8 3v5 M16 3v5 M5 8h14v3a7 7 0 0 1-14 0z M12 18v4",
    settings:
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z",
    arrow: "M4 12h16 M14 6l6 6-6 6",
    runs: "M8 4l13 8-13 8z",
    plus: "M12 4v16 M4 12h16",
    close: "M6 6l12 12 M18 6L6 18",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.overview} />
    </svg>
  );
}
export function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value.replace(/[^\w-]/g, "")}`}>
      <span />
      {titleCase(value)}
    </span>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-symbol">
        <Icon name="artifacts" size={24} />
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
export function ErrorNotice({
  error,
  retry,
}: {
  error: Error | string | null | undefined;
  retry?: () => unknown;
}) {
  if (!error) return null;
  return (
    <div className="error-banner" role="alert">
      <span>{typeof error === "string" ? error : error.message}</span>
      {retry && (
        <button
          className="button small"
          onClick={() => {
            void retry();
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      Loading company records…
    </div>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}
export function Card({
  title,
  children,
  action,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <div className="card-heading">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Portrait({
  agent,
  size = 42,
}: {
  agent: Pick<Agent, "id" | "display_name" | "department_id" | "portrait_url">;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="portrait"
      style={{
        width: size,
        height: size,
        borderColor: colors[agent.department_id] ?? "#8C8175",
        fontSize: size / 3,
      }}
    >
      {agent.portrait_url && !failed ? (
        <img src={agent.portrait_url} alt="" onError={() => setFailed(true)} />
      ) : (
        agent.display_name
          .split(" ")
          .map((s) => s[0])
          .slice(0, 2)
          .join("")
      )}
    </span>
  );
}
export function References({ refs }: { refs: (Ref | Citation)[] }) {
  return (
    <span className="references">
      {refs.map((ref, index) => (
        <Link
          key={`${ref.id}-${index}`}
          className="ref-chip"
          to={entityLink(ref.kind, ref.id)}
        >
          {ref.kind} · {ref.id.slice(-7)}
        </Link>
      ))}
    </span>
  );
}
export function Sources({
  answer,
}: {
  answer: TalkResponse | ConciergeResponse;
}) {
  return (
    <div className="source-list">
      <Status value={answer.check.status} />
      {answer.citations.map((citation, index) => (
        <Link
          className="source-card"
          to={entityLink(citation.kind, citation.id)}
          key={`${citation.id}-${index}`}
        >
          <strong>{citation.label}</strong>
          <blockquote>{citation.quote}</blockquote>
        </Link>
      ))}
      {"route_card" in answer && answer.route_card && (
        <Link
          className="button small"
          to={`/agents/${encodeURIComponent(answer.route_card.agent_id)}`}
        >
          Ask {answer.route_card.agent_name}
        </Link>
      )}
      {"suggested_agent" in answer && answer.suggested_agent && (
        <Link
          className="source-card"
          to={`/agents/${encodeURIComponent(answer.suggested_agent.agent_id)}`}
        >
          <strong>Ask {answer.suggested_agent.agent_id}</strong>
          <p>{answer.suggested_agent.reason}</p>
        </Link>
      )}
    </div>
  );
}
export function modelName(value: string) {
  return value.includes("deep-research")
    ? "Deep Research"
    : value.includes("argon")
      ? "Argon"
      : value.includes("flash-lite")
        ? "Flash-Lite"
        : value.includes("flash")
          ? "Flash"
          : value;
}
export function runtimeLabels(runtime: AgentRuntime | undefined): string[] {
  if (!runtime) return [];
  const labels = runtime.jobs
    .filter((j) => j.purpose === "work")
    .map(
      (j) =>
        `${modelName(j.model)}${j.thinking_level ? ` ${j.thinking_level}` : ""}`,
    );
  if (!labels.length)
    labels.push(
      ...runtime.jobs
        .filter(
          (j) => j.purpose === "conversation" && j.job !== "check_citation",
        )
        .map((j) => modelName(j.model)),
    );
  labels.push(
    ...runtime.managed_agents.map((value) =>
      value === "antigravity" ? "Antigravity sandbox" : titleCase(value),
    ),
  );
  labels.push(
    ...runtime.tools
      .filter((value) => !["antigravity", "deep_research"].includes(value))
      .map(
        (value) =>
          ({ github: "GitHub", cua: "Cua", antigravity_web: "Web research" })[
            value
          ] ?? titleCase(value),
      ),
  );
  return [...new Set(labels)];
}
export function RuntimeBadges({ runtime }: { runtime?: AgentRuntime }) {
  return (
    <div className="runtime-badges" aria-label="Agent runtime">
      {runtimeLabels(runtime).map((label) => (
        <span key={label}>{label}</span>
      ))}
    </div>
  );
}
export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  let code = false;
  const blocks: ReactNode[] = [];
  let codeLines: string[] = [];
  const inline = (line: string) =>
    line
      .split(/(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*)/g)
      .map((part, index) => {
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          const url = safeUrl(link[2]);
          return url ? (
            <a href={url} key={index} target="_blank" rel="noreferrer">
              {link[1]}
            </a>
          ) : (
            link[1]
          );
        }
        if (part.startsWith("`") && part.endsWith("`"))
          return <code key={index}>{part.slice(1, -1)}</code>;
        if (part.startsWith("**") && part.endsWith("**"))
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        return part;
      });
  let skipUntil = -1;
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  lines.forEach((line, index) => {
    if (index <= skipUntil) return;
    if (line.startsWith("```")) {
      if (code) {
        blocks.push(
          <pre key={index}>
            <code>{codeLines.join("\n")}</code>
          </pre>,
        );
        codeLines = [];
      }
      code = !code;
      return;
    }
    if (code) {
      codeLines.push(line);
      return;
    }
    if (
      line.includes("|") &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(
        lines[index + 1] ?? "",
      )
    ) {
      const headers = cells(line),
        rows: string[][] = [];
      let next = index + 2;
      while (
        next < lines.length &&
        lines[next].includes("|") &&
        lines[next].trim()
      ) {
        rows.push(cells(lines[next]));
        next++;
      }
      skipUntil = next - 1;
      blocks.push(
        <div className="table-scroll" key={index}>
          <table>
            <thead>
              <tr>
                {headers.map((cell, i) => (
                  <th key={i}>{inline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {headers.map((_, j) => (
                    <td key={j}>{inline(row[j] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      return;
    }
    if (/^### /.test(line))
      blocks.push(<h4 key={index}>{inline(line.slice(4))}</h4>);
    else if (/^## /.test(line))
      blocks.push(<h3 key={index}>{inline(line.slice(3))}</h3>);
    else if (/^# /.test(line))
      blocks.push(<h2 key={index}>{inline(line.slice(2))}</h2>);
    else if (/^[-*] /.test(line))
      blocks.push(
        <div className="markdown-list" key={index}>
          • {inline(line.slice(2))}
        </div>,
      );
    else if (line.trim()) blocks.push(<p key={index}>{inline(line)}</p>);
  });
  if (codeLines.length)
    blocks.push(
      <pre key="remaining">
        <code>{codeLines.join("\n")}</code>
      </pre>,
    );
  return <div className="markdown">{blocks}</div>;
}
export function useAction() {
  const [working, setWorking] = useState(false),
    [error, setError] = useState<Error | null>(null);
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setWorking(true);
    setError(null);
    try {
      return await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e
          : new Error("This action could not be completed."),
      );
      return undefined;
    } finally {
      setWorking(false);
    }
  }
  return { run, working, error };
}
