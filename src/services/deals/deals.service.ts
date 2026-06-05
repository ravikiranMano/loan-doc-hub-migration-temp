import { apiClient } from '@/services/node-api/client';

export async function generateDealNumber(): Promise<string> {
  const { dealNumber } = await apiClient.get<{ dealNumber: string }>('/deals/generate-number');
  return dealNumber;
}

export async function fetchDealById(id: string, _columns = '*') {
  return apiClient.get<unknown>(`/deals/${id}`);
}

export async function fetchDealMaybeSingle(id: string, _columns = '*') {
  return apiClient.get<unknown>(`/deals/${id}`);
}

export async function listDeals(options?: {
  page?: number;
  pageSize?: number;
  orderBy?: { column: string; ascending?: boolean };
}) {
  const qs = new URLSearchParams();
  if (options?.page) qs.set('page', String(options.page));
  if (options?.pageSize) qs.set('limit', String(options.pageSize));
  const data = await apiClient.get<unknown[]>(`/deals?${qs}`);
  return { data: data || [], count: (data || []).length };
}

export async function insertDeal(payload: Record<string, unknown>) {
  return apiClient.post<unknown>('/deals', payload);
}

export async function updateDeal(id: string, updates: Record<string, unknown>) {
  return apiClient.patch(`/deals/${id}`, updates);
}

export async function deleteDeal(id: string) {
  return apiClient.delete(`/deals/${id}`);
}

export async function countDeals() {
  return apiClient.get<number>('/deals/count');
}

export async function listDealsByIds(ids: string[], _columns = '*') {
  return apiClient.get<unknown[]>(`/deals?ids=${ids.join(',')}`);
}

export async function listDealsPage(page: number, pageSize: number) {
  const result = await apiClient.get<{ data: unknown[]; count: number } | unknown[]>(
    `/deals?page=${page}&limit=${pageSize}`,
  );
  if (Array.isArray(result)) {
    return { data: result, count: result.length };
  }
  return { data: result.data ?? [], count: result.count ?? 0 };
}

export async function listDealsByStatuses(statuses: string[], _columns = '*') {
  return apiClient.get<unknown[]>(`/deals?status=${statuses.join(',')}`);
}

export async function listDealsForDashboard() {
  return apiClient.get<unknown[]>('/deals/dashboard');
}

export async function searchDealsBrief(search: string, limit = 50) {
  return apiClient.get<unknown[]>(
    `/deals/search?q=${encodeURIComponent(search)}&limit=${limit}`,
  );
}
