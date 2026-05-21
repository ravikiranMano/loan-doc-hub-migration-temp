import { supabase } from '@/services/supabase/client';
import type { AppRole } from '@/contexts/AuthContext';

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
  const { error } = await supabase
    .from('deal_assignments')
    .delete()
    .eq('deal_id', dealId)
    .eq('user_id', userId);
  return { error: error as Error | null };
}
