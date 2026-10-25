// OWNER: mahin
/** Read-only same-origin kernel access. Never invokes providers or starts work. */
export async function readPage<T>(path: string, signal: AbortSignal): Promise<T[]> {
  const response = await fetch(path, {method: "GET", signal});
  if (!response.ok) throw new Error(`Company data unavailable (${response.status}).`);
  const body = await response.json();
  if (!Array.isArray(body?.data?.items)) throw new Error("Unreadable company response.");
  return body.data.items;
}
/** Serial polling, bounded cadence, request timeout, and full teardown. */
export function poll<T>(read: (signal: AbortSignal) => Promise<T>, accept: (value: T) => void, fail: (error: Error) => void, interval = 10000) {
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const tick = async () => {
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 12000);
    try { const value = await read(controller.signal); if (!stopped) accept(value); }
    catch (error) { if (!stopped) fail(error instanceof Error ? error : new Error("Company data unavailable.")); }
    finally { controller?.abort(); clearTimeout(timeout); if (!stopped) timer = setTimeout(tick, Math.max(5000, interval)); }
  };
  void tick();
  return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
}
export function safeWorldLink(value: unknown): string | null {
  if (typeof value !== "string" || !value || /[\\\x00-\x20]/.test(value)) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : null; } catch { return null; }
}
