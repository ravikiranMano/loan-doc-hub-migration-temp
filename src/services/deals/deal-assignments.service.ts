import { supabase } from '@/services/supabase/client';
import type { AppRole } from '@/contexts/AuthContext';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

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
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<DealAssignment[]>(`/deals/assignments/by-user/${userId}`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_assignments')
    .select('*')
    .eq('user_id', userId);
  if (error) {
    console.error('Error fetching deal assignments:', error);
    return [];
  }
  return (data || []) as DealAssignment[];
}

export async function fetchDealAssignments(dealId: string): Promise<DealAssignment[]> {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<DealAssignment[]>(`/deals/${dealId}/assignments`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_assignments')
    .select('*')
    .eq('deal_id', dealId);
  if (error) {
    console.error('Error fetching deal assignments:', error);
    return [];
  }
  return (data || []) as DealAssignment[];
}

export async function assignUserToDeal(
  dealId: string,
  userId: string,
  role: AppRole,
  assignedBy: string,
  notes?: string
): Promise<{ error: Error | null }> {
  if (isNodeApiEnabled('deals')) {
    try {
      await apiClient.post(`/deals/${dealId}/assignments`, { user_id: userId, role, notes });
      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('deal_assignments').insert({
    deal_id: dealId,
    user_id: userId,
    role: role,
    assigned_by: assignedBy,
    notes: notes || null,
  });
  return { error: error as Error | null };
}

export async function removeUserFromDeal(
  dealId: string,
  userId: string
): Promise<{ error: Error | null }> {
  if (isNodeApiEnabled('deals')) {
    try {
      await apiClient.delete(`/deals/${dealId}/assignments/${userId}`);
      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase
    .from('deal_assignments')
    .delete()
    .eq('deal_id', dealId)
    .eq('user_id', userId);
  return { error: error as Error | null };
}
