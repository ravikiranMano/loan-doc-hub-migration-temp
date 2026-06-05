import { apiClient } from '@/services/node-api/client';

export interface ClonedDeal {
  id: string;
  deal_number: string;
}

export async function cloneDeal(sourceDealId: string): Promise<ClonedDeal> {
  return apiClient.post<ClonedDeal>(`/deals/${sourceDealId}/clone`, {});
}
