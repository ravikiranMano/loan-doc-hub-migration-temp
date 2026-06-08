import type { AppRole } from '@/contexts/AuthContext';
import { apiClient } from '@/services/client';

export interface DealAssignment {
  id: string;
  deal_id: string;
  user_id: string;
  role: AppRole;
  assigned_by: string;
  assigned_at: string;
  notes: string | null;
}

export async function fetchUserDealAssignments(userId: string): Promise<DealAssignment[]> {
  return apiClient.get<DealAssignment[]>(`/deals/assignments/by-user/${userId}`);
}

export async function fetchDealAssignments(dealId: string): Promise<DealAssignment[]> {
  return apiClient.get<DealAssignment[]>(`/deals/${dealId}/assignments`);
}

export async function assignUserToDeal(
  dealId: string,
  userId: string,
  role: AppRole,
  _assignedBy: string,
  notes?: string,
): Promise<{ error: Error | null }> {
  try {
    await apiClient.post(`/deals/${dealId}/assignments`, { user_id: userId, role, notes });
    return { error: null };
  } catch (err) {
    return { error: err as Error };
  }
}

export async function removeUserFromDeal(
  dealId: string,
  userId: string,
): Promise<{ error: Error | null }> {
  try {
    await apiClient.delete(`/deals/${dealId}/assignments/${userId}`);
    return { error: null };
  } catch (err) {
    return { error: err as Error };
  }
}
