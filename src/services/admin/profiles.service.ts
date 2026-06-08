import { apiClient } from '@/services/client';

export type ProfileLookupRow = {
  user_id: string;
  full_name: string | null;
  email: string | null;
};

export function normalizeProfileRow(
  row: { user_id?: string; id?: string; full_name?: string | null; email?: string | null },
): ProfileLookupRow {
  const user_id = row.user_id ?? row.id ?? '';
  return {
    user_id,
    full_name: row.full_name ?? null,
    email: row.email ?? null,
  };
}

export async function fetchProfileByUserId(userId: string) {
  return apiClient.get<unknown>(`/admin/users/${userId}/profile`);
}

export async function fetchProfilesByUserIds(userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return [];
  const rows = await apiClient.get<
    Array<{ user_id?: string; id?: string; full_name: string | null; email: string | null }>
  >(`/admin/users?userIds=${encodeURIComponent(ids.join(','))}`);
  return (rows || []).map(normalizeProfileRow);
}

export async function listProfiles(options?: {
  search?: string;
  page?: number;
  pageSize?: number;
  userType?: string;
  orderBy?: { column: string; ascending?: boolean };
}) {
  const params = new URLSearchParams();
  if (options?.userType) params.set('userType', options.userType);
  if (options?.page != null) params.set('page', String(options.page));
  if (options?.pageSize != null) params.set('limit', String(options.pageSize));
  if (options?.search) params.set('search', options.search);
  if (options?.orderBy?.column) {
    params.set('orderBy', options.orderBy.column);
    params.set('ascending', String(options.orderBy.ascending ?? false));
  }
  const qs = params.toString();
  const result = await apiClient.get<{ data: unknown[]; count: number } | unknown[]>(
    `/admin/users${qs ? `?${qs}` : ''}`,
  );
  if (Array.isArray(result)) {
    return { data: result, count: result.length };
  }
  return { data: result.data ?? [], count: result.count ?? 0 };
}

export async function updateProfile(userId: string, updates: Record<string, unknown>) {
  return apiClient.patch(`/admin/users/${userId}/profile`, updates);
}

export async function updateProfileById(id: string, updates: Record<string, unknown>) {
  return apiClient.patch(`/admin/users/${id}/profile`, updates);
}

export async function countProfiles() {
  return apiClient.get<number>('/admin/users/count');
}
