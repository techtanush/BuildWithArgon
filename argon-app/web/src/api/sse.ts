// OWNER: tanush — seed version; replace/extend freely but keep the exported names.

import type { SseEvent } from "../shared/contracts";

export type SseListener = (event: SseEvent) => void;

export type StreamStatus = "connecting" | "live" | "reconnecting";
type StatusListener = (status: StreamStatus) => void;
interface Stream {
  source: EventSource | null;
  listeners: Set<SseListener>;
  statuses: Set<StatusListener>;
  status: StreamStatus;
  delay: number;
  lastId: number;
  timer?: ReturnType<typeof setTimeout>;
}
const streams = new Map<string, Stream>();
const eventTypes = [
  "venture.updated",
  "ticket.created",
  "ticket.updated",
  "run.started",
  "run.finished",
  "run.log",
  "artifact.created",
  "approval.requested",
  "approval.decided",
  "message.posted",
  "agent.status",
  "answer.checked",
  "ledger.updated",
  "system.warning",
  "worldgen.progress",
  "computer.updated",
  "computer.action",
  "standup.posted",
];
function notify(stream: Stream, status: StreamStatus) {
  stream.status = status;
  stream.statuses.forEach((listener) => listener(status));
}
function connect(id: string, stream: Stream) {
  if (typeof EventSource === "undefined") return;
  const resume = stream.lastId ? `?last_event_id=${stream.lastId}` : "";
  const source = new EventSource(
    `/v1/ventures/${encodeURIComponent(id)}/stream${resume}`,
  );
  stream.source = source;
  source.onopen = () => {
    if (stream.source !== source) return;
    stream.delay = 1000;
    notify(stream, "live");
  };
  source.onerror = () => {
    if (stream.source !== source) return;
    source.close();
    stream.source = null;
    notify(stream, "reconnecting");
    stream.timer = setTimeout(() => {
      stream.timer = undefined;
      connect(id, stream);
    }, stream.delay);
    stream.delay = Math.min(stream.delay * 2, 10_000);
  };
  const receive = (message: Event) => {
    if (stream.source !== source) return;
    try {
      const value = JSON.parse((message as MessageEvent).data) as SseEvent;
      const id = Number((message as MessageEvent).lastEventId || value.id);
      if (
        !Number.isFinite(id) ||
        id <= stream.lastId ||
        typeof value.type !== "string"
      )
        return;
      stream.lastId = id;
      for (const listener of stream.listeners) {
        try {
          listener({ ...value, id });
        } catch {
          /* A consumer must not interrupt the stream. */
        }
      }
    } catch {
      /* Ignore malformed provider messages; a later durable event recovers state. */
    }
  };
  eventTypes.forEach((type) => source.addEventListener(type, receive));
}
function getStream(id: string): Stream {
  let stream = streams.get(id);
  if (!stream) {
    stream = {
      source: null,
      listeners: new Set(),
      statuses: new Set(),
      status: "connecting",
      delay: 1000,
      lastId: 0,
    };
    streams.set(id, stream);
    connect(id, stream);
  }
  return stream;
}
function release(id: string, stream: Stream) {
  if (stream.listeners.size || stream.statuses.size) return;
  if (stream.timer) clearTimeout(stream.timer);
  stream.source?.close();
  stream.source = null;
  streams.delete(id);
}
export function subscribe(
  ventureId: string,
  listener: SseListener,
): () => void {
  const stream = getStream(ventureId);
  stream.listeners.add(listener);
  return () => {
    stream.listeners.delete(listener);
    release(ventureId, stream);
  };
}
export function subscribeStatus(
  ventureId: string,
  listener: StatusListener,
): () => void {
  const stream = getStream(ventureId);
  stream.statuses.add(listener);
  listener(stream.status);
  return () => {
    stream.statuses.delete(listener);
    release(ventureId, stream);
  };
}
export function getStatus(ventureId: string): StreamStatus {
  return streams.get(ventureId)?.status ?? "connecting";
}
export function closeStreams(): void {
  for (const stream of streams.values()) {
    if (stream.timer) clearTimeout(stream.timer);
    stream.source?.close();
    stream.source = null;
  }
  streams.clear();
}
