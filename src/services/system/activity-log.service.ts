import { apiClient } from '@/services/node-api/client';

export async function insertActivityLog(payload: Record<string, unknown>) {
  const dealId = payload.deal_id as string;
  const { deal_id: _deal_id, ...body } = payload;
  await apiClient.post(`/deals/${dealId}/activity`, body);
}

export async function listActivityLog(dealId: string) {
  return apiClient.get<unknown[]>(`/deals/${dealId}/activity`);
}

export async function fetchRecentActivityLog(dealId: string, since: string) {
  return apiClient.get<unknown[]>(
    `/deals/${dealId}/activity/recent?since=${encodeURIComponent(since)}`,
  );
}

export async function fetchLastExternalDataReview(dealId: string) {
  return apiClient.get<{ created_at: string } | null>(
    `/deals/${dealId}/activity/last-external-review`,
  );
}
