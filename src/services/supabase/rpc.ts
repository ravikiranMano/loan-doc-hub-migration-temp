import { supabase } from '@/services/supabase/client';
import { assertOk } from '@/services/supabase/errors';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';
import type { Database } from '@/services/supabase/types';

export type ContactIdType = Database['public']['Enums']['contact_type'] | string;
export type AppRoleEnum = Database['public']['Enums']['app_role'];

export async function generateContactId(pType: ContactIdType): Promise<string> {
  if (isNodeApiEnabled('contacts')) {
    const { contactId } = await apiClient.get<{ contactId: string }>(
      `/contacts/generate-id?type=${encodeURIComponent(String(pType))}`,
    );
    return contactId;
  }
  const { data, error } = await supabase.rpc('generate_contact_id', { p_type: pType });
  return assertOk({ data: data as string, error });
}

export async function generateDealNumber(): Promise<string> {
  if (isNodeApiEnabled('deals')) {
    const { dealNumber } = await apiClient.get<{ dealNumber: string }>('/deals/generate-number');
    return dealNumber;
  }
  const { data, error } = await supabase.rpc('generate_deal_number');
  return assertOk({ data: data as string, error });
}

export async function assignUserRoleAndPermission(params: {
  p_user_id: string;
  p_role: 'admin' | 'csr';
  p_permission_level: string;
}): Promise<void> {
  const { error } = await supabase.rpc('assign_user_role_and_permission', params);
  if (error) throw error;
}
