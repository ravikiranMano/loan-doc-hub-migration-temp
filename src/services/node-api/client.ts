import { supabase } from '@/services/supabase/client';

const BASE_URL = import.meta.env.VITE_NODE_API_URL ?? 'http://localhost:3000/api';

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

async function getAuthHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const authHeader = await getAuthHeader();

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? `Request failed: ${res.status}`);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

export const apiClient = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
