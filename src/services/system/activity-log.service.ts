import { supabase } from '@/services/supabase/client';

export async function insertActivityLog(payload: Record<string, unknown>) {
  const { error } = await supabase.from('activity_log').insert(payload);
  if (error) throw error;
}

export async function listActivityLog(dealId: string) {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchRecentActivityLog(dealId: string, since: string) {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('deal_id', dealId)
    .gte('created_at', since);
  if (error) throw error;
  return data || [];
}

export async function fetchLastExternalDataReview(dealId: string) {
  const { data, error } = await supabase
    .from('activity_log')
    .select('created_at')
    .eq('deal_id', dealId)
    .eq('action_type', 'ExternalDataReviewed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
