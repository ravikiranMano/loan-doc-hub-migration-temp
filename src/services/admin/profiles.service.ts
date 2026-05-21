import { supabase } from '@/services/supabase/client';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

export async function fetchProfileByUserId(userId: string) {
  if (isNodeApiEnabled('admin')) {
    return apiClient.get<unknown>(`/admin/users/${userId}/profile`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function fetchProfilesByUserIds(userIds: string[]) {
  if (isNodeApiEnabled('admin')) {
    if (!userIds.length) return [];
    return apiClient.get<
      Array<{ user_id: string; full_name: string | null; email: string | null }>
    >(`/admin/users?userIds=${userIds.join(',')}`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, full_name, email')
    .in('user_id', userIds);
  if (error) throw error;
  return data || [];
}

export async function listProfiles(options?: {
  search?: string;
  page?: number;
  pageSize?: number;
  userType?: string;
  orderBy?: { column: string; ascending?: boolean };
}) {
  if (isNodeApiEnabled('admin')) {
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
  // — Supabase (keep unchanged) —
  let query = supabase.from('profiles').select('*', { count: 'exact' });
  if (options?.userType) {
    query = query.eq('user_type', options.userType);
  }
  if (options?.search) {
    query = query.or(
      `full_name.ilike.%${options.search}%,email.ilike.%${options.search}%`
    );
  }
  if (options?.orderBy) {
    query = query.order(options.orderBy.column, {
      ascending: options.orderBy.ascending ?? false,
    });
  }
  if (options?.page != null && options?.pageSize != null) {
    const from = (options.page - 1) * options.pageSize;
    query = query.range(from, from + options.pageSize - 1);
  }
  const { data, error, count } = await query;
  if (error) throw error;
  return { data: data || [], count: count || 0 };
}

export async function updateProfile(userId: string, updates: Record<string, unknown>) {
  if (isNodeApiEnabled('admin')) {
    return apiClient.patch(`/admin/users/${userId}/profile`, updates);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('profiles').update(updates).eq('user_id', userId);
  if (error) throw error;
}

export async function updateProfileById(id: string, updates: Record<string, unknown>) {
  if (isNodeApiEnabled('admin')) {
    return apiClient.patch(`/admin/users/${id}/profile`, updates);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('profiles').update(updates).eq('id', id);
  if (error) throw error;
}

export async function countProfiles() {
  if (isNodeApiEnabled('admin')) {
    return apiClient.get<number>('/admin/users/count');
  }
  // — Supabase (keep unchanged) —
  const { count, error } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}
