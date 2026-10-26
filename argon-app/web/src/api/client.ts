// OWNER: tanush — seed version; replace/extend freely but keep the exported names.

// Typed fetch wrapper (04-dashboard/01-dashboard-spec.md §Data loading). Unwraps {data}; throws ApiError.
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try { res = await fetch(path, init); }
  catch { throw new ApiError(0, "network_unavailable", "Connection lost. Your input is unchanged. Check that YCBF is running, then retry."); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json?.error ?? {};
    throw new ApiError(
      res.status,
      e.code ?? "http_error",
      e.message ?? `HTTP ${res.status}`,
      e.details ?? {},
    );
  }
  if (
    !json ||
    typeof json !== "object" ||
    !Object.prototype.hasOwnProperty.call(json, "data")
  ) {
    throw new ApiError(
      res.status,
      "invalid_response",
      "The company returned an unreadable response. Please retry.",
    );
  }
  return json.data as T;
}

export const get = <T>(path: string) => request<T>("GET", path);
export const post = <T>(path: string, body: unknown = {}) =>
  request<T>("POST", path, body);
