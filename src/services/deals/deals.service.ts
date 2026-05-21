import { supabase } from '@/services/supabase/client';
import { generateDealNumber } from '@/services/supabase/rpc';

export { generateDealNumber };

export async function fetchDealById(id: string, columns = '*') {
  const { data, error } = await supabase.from('deals').select(columns).eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function fetchDealMaybeSingle(id: string, columns = '*') {
  const { data, error } = await supabase.from('deals').select(columns).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listDeals(options?: {
  page?: number;
  pageSize?: number;
  orderBy?: { column: string; ascending?: boolean };
}) {
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
  const { data, error } = await supabase.from('deals').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateDeal(id: string, updates: Record<string, unknown>) {
  const { error } = await supabase.from('deals').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteDeal(id: string) {
  const { error } = await supabase.from('deals').delete().eq('id', id);
  if (error) throw error;
}

export async function countDeals() {
  const { count, error } = await supabase
    .from('deals')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

export async function listDealsByIds(ids: string[], columns = '*') {
  const { data, error } = await supabase.from('deals').select(columns).in('id', ids);
  if (error) throw error;
  return data || [];
}

export async function listDealsPage(page: number, pageSize: number) {
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
  const { data, error } = await supabase
    .from('deals')
    .select(columns)
    .in('status', statuses)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listDealsForDashboard() {
  const { data, error } = await supabase
    .from('deals')
    .select('id, deal_number, borrower_name, status, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function searchDealsBrief(search: string, limit = 50) {
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
