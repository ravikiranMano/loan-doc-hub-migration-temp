export const BASE_URL = import.meta.env.VITE_NODE_API_URL ?? 'http://localhost:3000/api';

// Thrown after a failed token refresh so callers can detect session expiry
// without showing an error toast (the redirect to /auth is already in flight).
export class SessionExpiredError extends Error {
  constructor() {
    super('Session expired');
    this.name = 'SessionExpiredError';
  }
}

// Which domains are routed to the Node API.
// Set VITE_USE_NODE_API="system,admin" or "all" in .env
const enabledDomains = new Set(
  (import.meta.env.VITE_USE_NODE_API ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
);

export type Domain = 'system' | 'admin' | 'contacts' | 'documents' | 'deals';

export function isNodeApiEnabled(domain: Domain): boolean {
  return enabledDomains.has('all') || enabledDomains.has(domain);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

// Cookies (httpOnly) are sent automatically by the browser.
// On 401 we attempt a single token refresh, then retry the original request.
// If refresh also fails, redirect to /auth so the user can log in again.

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function attemptRefresh(): Promise<boolean> {
  if (isRefreshing && refreshPromise) return refreshPromise;

  isRefreshing = true;
  refreshPromise = fetch(`${BASE_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      isRefreshing = false;
      refreshPromise = null;
    });

  return refreshPromise;
}

/** Proactively refresh session (e.g. when tab regains focus after idle). */
export async function refreshSessionSilently(): Promise<boolean> {
  return attemptRefresh();
}

/** Low-level fetch with cookie auth and automatic token refresh on 401. */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
  isRetry = false,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    // Avoid browser conditional GET (304) — Express etag + empty 304 body breaks JSON parsing.
    cache: 'no-store',
    headers,
  });

  if (res.status === 401 && !isRetry) {
    const refreshed = await attemptRefresh();
    if (refreshed) return apiFetch(path, init, true);
    window.location.replace('/auth');
    throw new SessionExpiredError();
  }

  return res;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  isRetry = false,
): Promise<T> {
  const res = await apiFetch(
    path,
    {
      method,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    isRetry,
  );

  // Express may return 304 when If-None-Match matches etag; fetch treats 304 as !ok with no body.
  if (res.status === 304 && method === 'GET' && !isRetry) {
    const sep = path.includes('?') ? '&' : '?';
    return request<T>(method, `${path}${sep}_=${Date.now()}`, body, true);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((err as { message?: string }).message ?? `Request failed: ${res.status}`);
  }

  // 204 No Content, or 200/201 with an empty body (mirrors Supabase update calls that return no row).
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text.trim()) return undefined as T;
  return JSON.parse(text) as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

// ─── Multipart upload (storage) ───────────────────────────────────────────────

export async function uploadFile(
  bucket: string,
  path: string,
  file: File | Blob,
  options?: { upsert?: boolean },
): Promise<{ path: string }> {
  const form = new FormData();
  form.append('file', file);

  const uploadPath = `/storage/${bucket}/upload?path=${encodeURIComponent(path)}${
    options?.upsert ? '&upsert=true' : ''
  }`;

  const res = await apiFetch(uploadPath, { method: 'POST', body: form });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((err as { message?: string }).message ?? 'Upload failed');
  }

  return res.json() as Promise<{ path: string }>;
}
