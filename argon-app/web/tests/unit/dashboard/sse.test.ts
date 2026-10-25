// OWNER: tanush
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeStreams, getStatus, subscribe, subscribeStatus } from '../../../src/api/sse';
import type { SseEvent } from '../../../src/shared/contracts';

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = 0;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(readonly url: string) {
    super();
    FakeEventSource.instances.push(this);
  }
  close() { this.closed = true; this.readyState = 2; }
  open() { this.readyState = 1; this.onopen?.(new Event('open')); this.dispatchEvent(new Event('open')); }
  fail() { this.onerror?.(new Event('error')); this.dispatchEvent(new Event('error')); }
  emit(event: SseEvent) {
    const message = new MessageEvent(event.type, { data: JSON.stringify(event), lastEventId: String(event.id) });
    this.dispatchEvent(message);
  }
}

const event = (id: number, type = 'ticket.updated'): SseEvent => ({ id, type, entity_kind: 'ticket', entity_id: 'tkt_one',
  data: { id: 'tkt_one', status: 'done' }, level: 'info', created_at: '2026-10-25T18:00:00Z' });

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => { closeStreams(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('one resumable stream per venture', () => {
  it('shares a source across listeners, isolates ventures and closes after the final unsubscribe', () => {
    const first = vi.fn(), second = vi.fn(), other = vi.fn();
    const stopFirst = subscribe('ven_one', first), stopSecond = subscribe('ven_one', second);
    const stopOther = subscribe('ven_two', other);
    expect(FakeEventSource.instances).toHaveLength(2);
    const source = FakeEventSource.instances[0];
    expect(source.url).toContain('/v1/ventures/ven_one/stream');
    source.emit(event(1));
    expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1); expect(other).not.toHaveBeenCalled();
    stopFirst();
    expect(source.closed).toBe(false);
    stopSecond();
    expect(source.closed).toBe(true);
    stopOther();
    expect(FakeEventSource.instances[1].closed).toBe(true);
  });

  it('deduplicates replayed ids without dropping later global world-generation events', () => {
    const listener = vi.fn();
    subscribe('ven_one', listener);
    const source = FakeEventSource.instances[0];
    source.emit(event(7)); source.emit(event(7)); source.emit(event(6)); source.emit(event(8, 'worldgen.progress'));
    expect(listener.mock.calls.map(([data]) => data.id)).toEqual([7, 8]);
    source.dispatchEvent(new MessageEvent('ticket.updated', { data: 'invalid JSON' }));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('reports connecting/live/reconnecting, resumes at the last id and resets backoff after opening', () => {
    const statuses: string[] = [];
    subscribe('ven_one', vi.fn());
    const stopStatus = subscribeStatus('ven_one', (status) => statuses.push(status));
    const source = FakeEventSource.instances[0];
    expect(getStatus('ven_one')).toBe('connecting');
    source.open(); source.emit(event(42));
    expect(getStatus('ven_one')).toBe('live');
    source.fail();
    expect(source.closed).toBe(true); expect(getStatus('ven_one')).toBe('reconnecting');
    vi.advanceTimersByTime(999); expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1); expect(FakeEventSource.instances).toHaveLength(2);
    const resumed = FakeEventSource.instances[1];
    expect(new URL(resumed.url, 'http://localhost').searchParams.get('last_event_id')).toBe('42');
    resumed.open(); resumed.fail();
    vi.advanceTimersByTime(1000); expect(FakeEventSource.instances).toHaveLength(3);
    expect(statuses).toContain('live'); expect(statuses).toContain('reconnecting');
    stopStatus();
  });

  it('increases reconnect waits from one to ten seconds and cancels pending reconnects on teardown', () => {
    const stop = subscribe('ven_one', vi.fn());
    for (const [index, delay] of [1000, 2000, 4000, 8000, 10000, 10000].entries()) {
      FakeEventSource.instances[index].fail();
      vi.advanceTimersByTime(delay - 1);
      expect(FakeEventSource.instances).toHaveLength(index + 1);
      vi.advanceTimersByTime(1);
      expect(FakeEventSource.instances).toHaveLength(index + 2);
    }
    FakeEventSource.instances.at(-1)!.fail();
    stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(7);
    expect(FakeEventSource.instances.every((source) => source.closed)).toBe(true);
  });
});
