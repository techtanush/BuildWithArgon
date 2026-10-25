// OWNER: tanush
// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearQueryCache, invalidateQueries, patchQuery, useQuery } from '../../../src/api/hooks';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: Error) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'], reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  clearQueryCache();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); clearQueryCache(); vi.unstubAllGlobals();
});

describe('cache-and-revalidate hooks', () => {
  it('deduplicates simultaneous mounts and publishes one result to every subscriber', async () => {
    const pending = deferred<{ status: string }>();
    const fetcher = vi.fn(() => pending.promise);
    function Consumer() {
      const query = useQuery('tickets:one', fetcher);
      return createElement('span', null, query.loading ? 'Loading' : query.data?.status ?? 'empty');
    }
    await act(async () => root.render(createElement('div', null, createElement(Consumer), createElement(Consumer))));
    expect(fetcher).toHaveBeenCalledTimes(1); expect(host.textContent).toBe('LoadingLoading');
    await act(async () => pending.resolve({ status: 'done' }));
    expect(host.textContent).toBe('donedone');
  });

  it('shows cached content while a remounted consumer revalidates it', async () => {
    const next = deferred<string>();
    const fetcher = vi.fn<() => Promise<string>>().mockResolvedValueOnce('cached').mockImplementationOnce(() => next.promise);
    function Consumer() {
      const query = useQuery('venture:one', fetcher);
      return createElement('span', null, query.data ?? 'empty');
    }
    await act(async () => root.render(createElement(Consumer)));
    expect(host.textContent).toBe('cached');
    await act(async () => root.render(null));
    await act(async () => root.render(createElement(Consumer)));
    expect(host.textContent).toBe('cached'); expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => next.resolve('fresh'));
    expect(host.textContent).toBe('fresh');
  });

  it('ignores an old key response after the selected venture changes and skips disabled queries', async () => {
    const old = deferred<string>();
    const fetcher = vi.fn((key: string | null) => key === 'one' ? old.promise : Promise.resolve('second venture'));
    function Consumer({ queryKey }: { queryKey: string | null }) {
      const query = useQuery(queryKey, () => fetcher(queryKey));
      return createElement('span', null, query.data ?? 'empty');
    }
    await act(async () => root.render(createElement(Consumer, { queryKey: null })));
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => root.render(createElement(Consumer, { queryKey: 'one' })));
    await act(async () => root.render(createElement(Consumer, { queryKey: 'two' })));
    expect(host.textContent).toBe('second venture');
    await act(async () => old.resolve('old venture'));
    expect(host.textContent).toBe('second venture');
  });

  it('surfaces a failed request and lets Retry refetch successfully', async () => {
    const fetcher = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error('Kernel unavailable')).mockResolvedValueOnce('connected');
    let retry: (() => Promise<void>) | undefined;
    function Consumer() {
      const query = useQuery('system', fetcher); retry = query.refetch;
      return createElement('span', null, query.error?.message ?? query.data ?? 'empty');
    }
    await act(async () => root.render(createElement(Consumer)));
    expect(host.textContent).toBe('Kernel unavailable');
    await act(async () => retry!());
    expect(host.textContent).toBe('connected'); expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('patches live records in every mounted subscriber without another network request', async () => {
    type Row = { id: string; status: string };
    const fetcher = vi.fn(async (): Promise<Row[]> => [{ id: 'tkt_one', status: 'open' }]);
    function Consumer() {
      const query = useQuery('tickets:venture', fetcher);
      return createElement('span', null, query.data?.map((row) => `${row.id}:${row.status}`).join(','));
    }
    await act(async () => root.render(createElement('div', null, createElement(Consumer), createElement(Consumer))));
    await act(async () => patchQuery<Row[]>('tickets:venture', (rows) => (rows ?? []).map((row) => row.id === 'tkt_one' ? { ...row, status: 'done' } : row)));
    expect(host.textContent).toBe('tkt_one:donetkt_one:done');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('invalidates only the requested cache prefix', async () => {
    const tickets = vi.fn(async () => 'tickets'), agents = vi.fn(async () => 'agents');
    function Consumer() {
      const one = useQuery('tickets:venture', tickets), two = useQuery('agents:venture', agents);
      return createElement('span', null, one.data, two.data);
    }
    await act(async () => root.render(createElement(Consumer)));
    await act(async () => invalidateQueries('tickets:'));
    expect(tickets).toHaveBeenCalledTimes(2); expect(agents).toHaveBeenCalledTimes(1);
  });

  it('queues one refresh when live events invalidate an in-flight request', async () => {
    const pending = deferred<string>();
    const fetcher = vi.fn<() => Promise<string>>().mockImplementationOnce(() => pending.promise).mockResolvedValue('latest status');
    function Consumer() {
      const query = useQuery('tickets:venture', fetcher);
      return createElement('span', null, query.data ?? 'empty');
    }
    await act(async () => root.render(createElement(Consumer)));
    await act(async () => { invalidateQueries('tickets:'); invalidateQueries('tickets:'); invalidateQueries('tickets:'); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve('stale status captured before the event'));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(host.textContent).toBe('latest status');
  });

  it("keeps shared old-key refetches bound to their key after another consumer switches", async () => {
    const fetcher = vi.fn(async (key: string) => `data:${key}`);
    function Consumer({ queryKey }: { queryKey: string }) {
      const query = useQuery(queryKey, () => fetcher(queryKey));
      return createElement("span", null, query.data);
    }
    const view = (dynamic: string) =>
      createElement(
        "div",
        null,
        createElement(Consumer, { queryKey: "venture:one", key: "static" }),
        createElement(Consumer, { queryKey: dynamic, key: "dynamic" }),
      );
    await act(async () => root.render(view("venture:one")));
    await act(async () => root.render(view("venture:two")));
    await act(async () => invalidateQueries("venture:one"));
    expect(host.textContent).toBe("data:venture:onedata:venture:two");
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe("venture:one");
  });
});
