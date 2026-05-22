import { supabase } from '@/services/supabase/client';
import { generateDealNumber as generateDealNumberSupabase } from '@/services/supabase/rpc';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

export async function generateDealNumber(): Promise<string> {
  if (isNodeApiEnabled('deals')) {
    const { dealNumber } = await apiClient.get<{ dealNumber: string }>('/deals/generate-number');
    return dealNumber;
  }
  return generateDealNumberSupabase();
}

export async function fetchDealById(id: string, columns = '*') {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown>(`/deals/${id}`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase.from('deals').select(columns).eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function fetchDealMaybeSingle(id: string, columns = '*') {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown>(`/deals/${id}`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase.from('deals').select(columns).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listDeals(options?: {
  page?: number;
  pageSize?: number;
  orderBy?: { column: string; ascending?: boolean };
}) {
  if (isNodeApiEnabled('deals')) {
    const qs = new URLSearchParams();
    if (options?.page) qs.set('page', String(options.page));
    if (options?.pageSize) qs.set('limit', String(options.pageSize));
    const data = await apiClient.get<unknown[]>(`/deals?${qs}`);
    return { data: data || [], count: (data || []).length };
  }
  // — Supabase (keep unchanged) —
  let query = supabase.from('deals').select('*', { count: 'exact' });
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

export async function insertDeal(payload: Record<string, unknown>) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.post<unknown>('/deals', payload);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase.from('deals').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateDeal(id: string, updates: Record<string, unknown>) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.patch(`/deals/${id}`, updates);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('deals').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteDeal(id: string) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.delete(`/deals/${id}`);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('deals').delete().eq('id', id);
  if (error) throw error;
}

export async function countDeals() {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<number>('/deals/count');
  }
  // — Supabase (keep unchanged) —
  const { count, error } = await supabase
    .from('deals')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

export async function listDealsByIds(ids: string[], columns = '*') {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>(`/deals?ids=${ids.join(',')}`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase.from('deals').select(columns).in('id', ids);
  if (error) throw error;
  return data || [];
}

export async function listDealsPage(page: number, pageSize: number) {
  if (isNodeApiEnabled('deals')) {
    const result = await apiClient.get<{ data: unknown[]; count: number } | unknown[]>(
      `/deals?page=${page}&limit=${pageSize}`,
    );
    if (Array.isArray(result)) {
      return { data: result, count: result.length };
    }
    return { data: result.data ?? [], count: result.count ?? 0 };
  }
  // — Supabase (keep unchanged) —
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await supabase
    .from('deals')
    .select('*, packets(name)', { count: 'exact' })
    .order('updated_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return { data: data || [], count: count || 0 };
}

export async function listDealsByStatuses(statuses: string[], columns = '*') {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>(`/deals?status=${statuses.join(',')}`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deals')
    .select(columns)
    .in('status', statuses)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listDealsForDashboard() {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>('/deals/dashboard');
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deals')
    .select('id, deal_number, borrower_name, status, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function searchDealsBrief(search: string, limit = 50) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>(
      `/deals/search?q=${encodeURIComponent(search)}&limit=${limit}`
    );
  }
  // — Supabase (keep unchanged) —
  let query = supabase
    .from('deals')
    .select('id, deal_number, borrower_name')
    .order('deal_number', { ascending: false })
    .limit(limit);
  if (search.trim()) {
    query = query.or(
      `deal_number.ilike.%${search.trim()}%,borrower_name.ilike.%${search.trim()}%`
    );
  }
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
