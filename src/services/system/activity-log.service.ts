import { supabase } from '@/services/supabase/client';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

/** Activity log is served under /deals/:id/activity on the Node API. */
function useNodeActivityLog(): boolean {
  return isNodeApiEnabled('deals') || isNodeApiEnabled('system');
}

export async function insertActivityLog(payload: Record<string, unknown>) {
  const dealId = payload.deal_id as string;
  if (useNodeActivityLog() && dealId) {
    const { deal_id, ...body } = payload;
    await apiClient.post(`/deals/${dealId}/activity`, body);
    return;
  }
  const { error } = await supabase.from('activity_log').insert(payload);
  if (error) throw error;
}

export async function listActivityLog(dealId: string) {
  if (useNodeActivityLog()) {
    return apiClient.get<unknown[]>(`/deals/${dealId}/activity`);
  }
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchRecentActivityLog(dealId: string, since: string) {
  if (useNodeActivityLog()) {
    const query = encodeURIComponent(since);
    return apiClient.get<unknown[]>(`/deals/${dealId}/activity/recent?since=${query}`);
  }
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('deal_id', dealId)
    .gte('created_at', since);
  if (error) throw error;
  return data || [];
}

export async function fetchLastExternalDataReview(dealId: string) {
  if (useNodeActivityLog()) {
    return apiClient.get<{ created_at: string } | null>(
      `/deals/${dealId}/activity/last-external-review`,
    );
  }
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
