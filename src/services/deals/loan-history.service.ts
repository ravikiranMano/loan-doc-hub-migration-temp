import { supabase } from '@/services/supabase/client';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

export async function listLoanHistory(filters?: { dealIds?: string[] }) {
  if (isNodeApiEnabled('deals') && filters?.dealIds?.length) {
    return apiClient.get<unknown[]>(
      `/deals/loan-history?dealIds=${filters.dealIds.join(',')}`,
    );
  }
  // — Supabase (keep unchanged) —
  let query = supabase.from('loan_history').select('*');
  if (filters?.dealIds?.length) {
    query = query.in('deal_id', filters.dealIds);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function listLoanHistoryByDeal(dealId: string) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>(`/deals/${dealId}/loan-history`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('loan_history')
    .select('*')
    .eq('deal_id', dealId)
    .order('date_received', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listLoanHistoryByDealIds(
  dealIds: string[],
  orderColumn = 'date_due',
  ascending = false
) {
  if (isNodeApiEnabled('deals') && dealIds.length > 0) {
    const params = new URLSearchParams({
      dealIds: dealIds.join(','),
      orderColumn,
      ascending: String(ascending),
    });
    return apiClient.get<unknown[]>(`/deals/loan-history?${params}`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('loan_history')
    .select('*')
    .in('deal_id', dealIds)
    .order(orderColumn, { ascending });
  if (error) throw error;
  return data || [];
}

export async function insertLoanHistory(payload: Record<string, unknown>) {
  if (isNodeApiEnabled('deals')) {
    const dealId = payload['deal_id'] as string;
    return apiClient.post(`/deals/${dealId}/loan-history`, payload);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('loan_history').insert(payload);
  if (error) throw error;
}

export async function updateLoanHistory(id: string, payload: Record<string, unknown>) {
  if (isNodeApiEnabled('deals')) {
    const dealId = payload['deal_id'] as string | undefined;
    return apiClient.patch(`/deals/${dealId ?? '_'}/loan-history/${id}`, payload);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('loan_history').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteLoanHistory(id: string) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.delete(`/deals/loan-history/${id}`);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('loan_history').delete().eq('id', id);
  if (error) throw error;
}

export async function listLoanHistoryLenders(historyIds: string[]) {
  if (isNodeApiEnabled('deals')) {
    if (!historyIds.length) return [];
    return apiClient.get<unknown[]>(
      `/deals/loan-history/lenders?historyIds=${historyIds.join(',')}`,
    );
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('loan_history_lenders')
    .select('*')
    .in('loan_history_id', historyIds);
  if (error) throw error;
  return data || [];
}
