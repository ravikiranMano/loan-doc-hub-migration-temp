import { supabase } from '@/services/supabase/client';

export async function listLoanHistory(filters?: { dealIds?: string[] }) {
  let query = supabase.from('loan_history').select('*');
  if (filters?.dealIds?.length) {
    query = query.in('deal_id', filters.dealIds);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function listLoanHistoryByDeal(dealId: string) {
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
  const { data, error } = await supabase
    .from('loan_history')
    .select('*')
    .in('deal_id', dealIds)
    .order(orderColumn, { ascending });
  if (error) throw error;
  return data || [];
}

export async function insertLoanHistory(payload: Record<string, unknown>) {
  const { error } = await supabase.from('loan_history').insert(payload);
  if (error) throw error;
}

export async function updateLoanHistory(id: string, payload: Record<string, unknown>) {
  const { error } = await supabase.from('loan_history').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteLoanHistory(id: string) {
  const { error } = await supabase.from('loan_history').delete().eq('id', id);
  if (error) throw error;
}

export async function listLoanHistoryLenders(historyIds: string[]) {
  const { data, error } = await supabase
    .from('loan_history_lenders')
    .select('*')
    .in('loan_history_id', historyIds);
  if (error) throw error;
  return data || [];
}
