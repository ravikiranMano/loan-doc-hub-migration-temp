import { BASE_URL } from './client';

export interface AuthUser {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  company: string | null;
  license_number: string | null;
  user_type: string;
  role: string;
  is_active: boolean;
  last_sign_in_at: string | null;
  created_at: string;
}

async function authRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((err as { message?: string }).message ?? `Auth request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  return authRequest<AuthUser>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function register(
  email: string,
  password: string,
  fullName: string,
): Promise<AuthUser> {
  return authRequest<AuthUser>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, full_name: fullName }),
  });
}

export async function logout(): Promise<void> {
  await authRequest<void>('/auth/logout', { method: 'POST' });
}

export async function getMe(): Promise<AuthUser | null> {
  try {
    return await authRequest<AuthUser>('/auth/me');
  } catch {
    return null;
  }
}

export async function updateMe(data: Partial<Pick<AuthUser, 'full_name' | 'phone' | 'company' | 'license_number'>>): Promise<AuthUser> {
  return authRequest<AuthUser>('/auth/me', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}
