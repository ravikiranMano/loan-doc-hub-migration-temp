import { apiClient } from '@/services/client';

export async function listLoanHistory(filters?: { dealIds?: string[] }) {
  if (!filters?.dealIds?.length) return [];
  return apiClient.get<unknown[]>(`/deals/loan-history?dealIds=${filters.dealIds.join(',')}`);
}

export async function listLoanHistoryByDeal(dealId: string) {
  return apiClient.get<unknown[]>(`/deals/${dealId}/loan-history`);
}

export async function listLoanHistoryByDealIds(
  dealIds: string[],
  orderColumn = 'date_due',
  ascending = false,
) {
  if (!dealIds.length) return [];
  const params = new URLSearchParams({
    dealIds: dealIds.join(','),
    orderColumn,
    ascending: String(ascending),
  });
  return apiClient.get<unknown[]>(`/deals/loan-history?${params}`);
}

export async function insertLoanHistory(payload: Record<string, unknown>) {
  const dealId = payload['deal_id'] as string;
  return apiClient.post(`/deals/${dealId}/loan-history`, payload);
}

export async function updateLoanHistory(id: string, payload: Record<string, unknown>) {
  const dealId = payload['deal_id'] as string | undefined;
  return apiClient.patch(`/deals/${dealId ?? '_'}/loan-history/${id}`, payload);
}

export async function deleteLoanHistory(id: string) {
  return apiClient.delete(`/deals/loan-history/${id}`);
}

export async function listLoanHistoryLenders(historyIds: string[]) {
  if (!historyIds.length) return [];
  return apiClient.get<unknown[]>(
    `/deals/loan-history/lenders?historyIds=${historyIds.join(',')}`,
  );
}
