// OWNER: tanush
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { get, post } from "../../api/client";
import { invalidateQueries, useQuery } from "../../api/hooks";
import type {
  Agent,
  Channel,
  Department,
  ListPage,
  Message,
} from "../../shared/contracts";
import { useCompany } from "../context";
import {
  Card,
  Empty,
  ErrorNotice,
  Loading,
  PageHeader,
  References,
  useAction,
} from "../components/Shared";

function Composer({
  channelId,
  root,
  onSent,
}: {
  channelId: string;
  root?: string;
  onSent?: () => void;
}) {
  const { venture, ventureId } = useCompany(),
    [body, setBody] = useState(""),
    action = useAction();
  const agents = useQuery<ListPage<Agent>>(
    ventureId ? `/v1/ventures/${ventureId}/agents` : null,
    () => get(`/v1/ventures/${ventureId}/agents`),
  );
  const departments = useQuery<ListPage<Department>>(
    ventureId ? `/v1/ventures/${ventureId}/departments` : null,
    () => get(`/v1/ventures/${ventureId}/departments`),
  );
  const fragment = body.match(/@([^@\n]*)$/)?.[1];
  const choices =
    fragment === undefined
      ? []
      : [
          ...(agents.data?.items.map((agent) => ({
            id: agent.id,
            label: `${agent.display_name} · ${agent.title}`,
          })) ?? []),
          ...(departments.data?.items.map((dept) => ({
            id: dept.id,
            label: dept.name,
          })) ?? []),
        ]
          .filter((item) =>
            `${item.id} ${item.label}`
              .toLowerCase()
              .includes(fragment.toLowerCase()),
          )
          .slice(0, 6);
  async function send() {
    if (!body.trim()) return;
    await action.run(async () => {
      await post(`/v1/channels/${channelId}/messages`, {
        body,
        author_name: venture?.founder_name ?? "Founder",
        ...(root ? { thread_root_id: root } : {}),
      });
      setBody("");
      invalidateQueries("/v1/channels/");
      onSent?.();
    });
  }
  return (
    <form
      className="chat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <label>
        {root ? "Reply to thread" : "Message the team"}
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={root ? 2 : 3}
          placeholder="Write a message. Use @ to bring an agent into the conversation."
          maxLength={20_000}
        />
      </label>
      {choices.length > 0 && (
        <div className="mention-menu" aria-label="Mention suggestions">
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              onClick={() =>
                setBody((value) => value.replace(/@[^@\n]*$/, `@${choice.id} `))
              }
            >
              <strong>@{choice.id}</strong>
              <span>{choice.label}</span>
            </button>
          ))}
        </div>
      )}
      <ErrorNotice error={action.error} />
      <div className="composer-footer">
        <small>
          Mentions create work. Consequential actions still need approval.
        </small>
        <button
          className="button primary small"
          disabled={action.working || !body.trim()}
        >
          {action.working ? "Sending…" : root ? "Send reply" : "Send message"}
        </button>
      </div>
    </form>
  );
}
function MessageItem({
  message,
  channelId,
  nested = false,
}: {
  message: Message;
  channelId: string;
  nested?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <article className={`chat-message ${nested ? "thread-message" : ""}`}>
      <div className="chat-avatar">
        {message.author_kind === "system"
          ? "f"
          : (message.author_id ?? "A").slice(0, 1).toUpperCase()}
      </div>
      <div className="message-body">
        <div className="message-meta">
          <strong>{message.author_id ?? "Agent"}</strong>
          <span className="kind-badge">
            {message.kind.replaceAll("_", " ")}
          </span>
          <time dateTime={message.created_at}>
            {new Date(message.created_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </div>
        <p>{message.body}</p>
        <References refs={message.refs} />
        {!nested && (
          <button
            className="thread-button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            {message.reply_count
              ? `${message.reply_count} ${message.reply_count === 1 ? "reply" : "replies"}`
              : "Reply in thread"}{" "}
            {open ? "↑" : "→"}
          </button>
        )}
        {open && <Thread channelId={channelId} root={message.id} />}
      </div>
    </article>
  );
}
function Thread({ channelId, root }: { channelId: string; root: string }) {
  const key = `/v1/channels/${channelId}/messages?thread_root_id=${encodeURIComponent(root)}`;
  const query = useQuery<ListPage<Message>>(key, () => get(key));
  return (
    <div className="thread-panel">
      <ErrorNotice error={query.error} retry={query.refetch} />
      {query.data?.items.map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          channelId={channelId}
          nested
        />
      ))}
      <Composer channelId={channelId} root={root} />
    </div>
  );
}
export function ChannelView({ channelId }: { channelId: string }) {
  const key = `/v1/channels/${channelId}/messages`;
  const query = useQuery<ListPage<Message>>(key, () => get(key));
  const [older, setOlder] = useState<Message[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [summary, setSummary] = useState(""),
    action = useAction();
  async function loadOlder() {
    const next = cursor ?? query.data?.next_cursor;
    if (!next) return;
    await action.run(async () => {
      const page = await get<ListPage<Message>>(
        `${key}?cursor=${encodeURIComponent(next)}`,
      );
      setOlder((old) => [...page.items, ...old]);
      setCursor(page.next_cursor ?? "");
    });
  }
  return (
    <div className="channel-view">
      <div className="channel-toolbar">
        <span className="muted">A shared record of decisions and work.</span>
        <button
          className="button small"
          disabled={action.working}
          onClick={() =>
            void action.run(async () => {
              const result = await post<{ summary: string }>(
                `/v1/channels/${channelId}/summarize`,
              );
              setSummary(result.summary);
            })
          }
        >
          Summarize
        </button>
      </div>
      <ErrorNotice error={query.error ?? action.error} retry={query.refetch} />
      {summary && (
        <div className="notice">
          <strong>Channel summary</strong>
          <p>{summary}</p>
          <button className="text-link" onClick={() => setSummary("")}>
            Dismiss
          </button>
        </div>
      )}
      {query.loading ? (
        <Loading />
      ) : (
        <>
          <div className="messages-scroll">
            {(cursor === null ? query.data?.next_cursor : cursor) && (
              <button
                className="button small"
                onClick={() => void loadOlder()}
                disabled={action.working}
              >
                Load earlier messages
              </button>
            )}
            {[...older, ...(query.data?.items ?? [])]
              .filter(
                (message, index, all) =>
                  all.findIndex((m) => m.id === message.id) === index,
              )
              .map((message) => (
                <MessageItem
                  key={message.id}
                  message={message}
                  channelId={channelId}
                />
              ))}
            {!query.data?.items.length && (
              <Empty title="The conversation starts here">
                Updates, handoffs and your messages will appear in this channel.
              </Empty>
            )}
          </div>
          <Composer channelId={channelId} />
        </>
      )}
    </div>
  );
}
export default function Chat() {
  const { channelSlug } = useParams(),
    { ventureId } = useCompany();
  const query = useQuery<ListPage<Channel>>(
    ventureId ? `/v1/ventures/${ventureId}/channels` : null,
    () => get(`/v1/ventures/${ventureId}/channels`),
  );
  const channel = query.data?.items.find(
    (c) => c.slug === (channelSlug ?? "all-hands"),
  );
  return (
    <>
      <PageHeader
        title="Chat"
        description="Where the company thinks together, makes requests, and hands work forward."
      />
      <ErrorNotice error={query.error} retry={query.refetch} />
      <div className="chat-layout">
        <aside className="channel-sidebar">
          <p className="overline">Company channels</p>
          {query.data?.items.map((item) => (
            <Link
              key={item.id}
              to={`/chat/${item.slug}`}
              className={item.id === channel?.id ? "active" : ""}
            >
              <span>#</span>
              {item.slug}
            </Link>
          ))}
        </aside>
        <Card className="chat-card">
          {channel ? (
            <>
              <h2 className="channel-title"># {channel.slug}</h2>
              <ChannelView key={channel.id} channelId={channel.id} />
            </>
          ) : query.loading ? (
            <Loading />
          ) : (
            <Empty title="No channel selected">
              Choose a channel to read its conversation.
            </Empty>
          )}
        </Card>
      </div>
    </>
  );
}
