import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

export interface ClonedDeal {
  id: string;
  deal_number: string;
}

/** Clone deal business setup into a new draft file (CSR copy action). */
export async function cloneDeal(sourceDealId: string): Promise<ClonedDeal> {
  if (isNodeApiEnabled('deals')) {
    const deal = await apiClient.post<ClonedDeal>(`/deals/${sourceDealId}/clone`, {});
    return deal;
  }
  throw new Error('Deal clone requires Node API (set VITE_USE_NODE_API to include deals).');
}
