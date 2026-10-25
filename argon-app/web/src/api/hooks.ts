// OWNER: tanush — seed version; replace/extend freely but keep the exported names.

import { useEffect, useRef, useSyncExternalStore } from "react";

interface Snapshot<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
}
interface Entry<T> {
  snapshot: Snapshot<T>;
  listeners: Set<() => void>;
  fetcher?: () => Promise<T>;
  pending?: Promise<void>;
  generation: number;
  dirty?: boolean;
}
const cache = new Map<string, Entry<unknown>>();
const disabled = { data: undefined, error: null, loading: false };
function entry<T>(key: string): Entry<T> {
  if (!cache.has(key))
    cache.set(key, {
      snapshot: { data: undefined, error: null, loading: true },
      listeners: new Set(),
      generation: 0,
    });
  return cache.get(key)! as Entry<T>;
}
function publish<T>(value: Entry<T>, next: Snapshot<T>) {
  value.snapshot = next;
  value.listeners.forEach((listener) => listener());
}
async function refresh<T>(value: Entry<T>): Promise<void> {
  if (value.pending) return value.pending;
  if (!value.fetcher) return;
  const generation = ++value.generation;
  publish(value, {
    ...value.snapshot,
    error: null,
    loading: value.snapshot.data === undefined,
  });
  value.pending = (async () => {
    try {
      const data = await value.fetcher!();
      if (generation === value.generation)
        publish(value, { data, error: null, loading: false });
    } catch (error) {
      if (generation === value.generation)
        publish(value, {
          ...value.snapshot,
          error:
            error instanceof Error
              ? error
              : new Error("Could not load this information."),
          loading: false,
        });
    } finally {
      value.pending = undefined;
      if (value.dirty) {
        value.dirty = false;
        if (value.listeners.size) void refresh(value);
      }
    }
  })();
  return value.pending;
}

export function useQuery<T>(key: string | null, fetcher: () => Promise<T>) {
  const latest = useRef({ key, fetcher });
  latest.current = { key, fetcher };
  const value = key === null ? null : entry<T>(key);
  const snapshot = useSyncExternalStore(
    (listener) => {
      if (!value) return () => {};
      value.listeners.add(listener);
      return () => {
        value.listeners.delete(listener);
      };
    },
    () => value?.snapshot ?? disabled,
    () => value?.snapshot ?? disabled,
  ) as Snapshot<T>;
  useEffect(() => {
    if (!value) return;
    // A shared old-key entry can outlive this consumer switching keys. Keep its
    // request bound to its original key, while allowing current-key closures to update.
    value.fetcher = () =>
      latest.current.key === key ? latest.current.fetcher() : fetcher();
    void refresh(value);
  }, [value]);
  return {
    ...snapshot,
    refetch: () => (value ? refresh(value) : Promise.resolve()),
  };
}

export function invalidateQueries(prefix = ""): void {
  for (const [key, value] of cache)
    if (key.startsWith(prefix) && value.listeners.size) {
      if (value.pending) value.dirty = true;
      else void refresh(value);
    }
}
export function patchQuery<T>(
  key: string,
  updater: (previous: T | undefined) => T | undefined,
): void {
  const value = entry<T>(key);
  if (value.pending) {
    value.generation++;
    value.dirty = true;
  }
  publish(value, { ...value.snapshot, data: updater(value.snapshot.data) });
}
export function clearQueryCache(): void {
  for (const value of cache.values()) value.generation++;
  cache.clear();
}
