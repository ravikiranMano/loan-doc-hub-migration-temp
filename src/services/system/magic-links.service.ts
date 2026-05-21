import { supabase } from '@/services/supabase/client';
import { invokeValidateMagicLink } from '@/services/supabase/functions';
import { fetchSystemSettingsByKeys } from '@/services/system/settings.service';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

export interface MagicLinkSettings {
  expiryHours: number;
  maxUses: number;
}

export interface MagicLinkData {
  id: string;
  deal_participant_id: string;
  token: string;
  expires_at: string;
  max_uses: number;
  used_count: number;
  created_at: string;
  last_used_at: string | null;
}

export interface MagicLinkValidationResult {
  isValid: boolean;
  error?: string;
  dealId?: string;
  role?: string;
  participantId?: string;
  dealNumber?: string;
  sessionToken?: string;
}

function useNodeMagicLinks(): boolean {
  return isNodeApiEnabled('deals') || isNodeApiEnabled('system');
}

export async function getMagicLinkSettings(): Promise<MagicLinkSettings> {
  let data: { setting_key: string; setting_value: string | null }[] = [];
  try {
    data = await fetchSystemSettingsByKeys([
      'magic_link_expiry_hours',
      'magic_link_max_uses',
    ]);
  } catch (error) {
    console.error('Error fetching magic link settings:', error);
    return { expiryHours: 72, maxUses: 5 };
  }

  const settings = (data || []).reduce(
    (acc, { setting_key, setting_value }) => {
      acc[setting_key] = setting_value;
      return acc;
    },
    {} as Record<string, string | null>
  );

  return {
    expiryHours: parseInt(settings['magic_link_expiry_hours'] || '72', 10),
    maxUses: parseInt(settings['magic_link_max_uses'] || '5', 10),
  };
}

export async function createMagicLinkRecord(payload: Record<string, unknown>) {
  const participantId = payload.deal_participant_id as string;
  if (useNodeMagicLinks() && participantId) {
    const { deal_participant_id, ...body } = payload;
    const data = await apiClient.post<MagicLinkData>(
      `/deals/participants/${participantId}/magic-links`,
      body,
    );
    return data;
  }
  const { data, error } = await supabase
    .from('magic_links')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as MagicLinkData;
}

export async function validateMagicLinkToken(token: string) {
  const response = await invokeValidateMagicLink(token);
  if (response.error) {
    return { isValid: false, error: response.error.message } as MagicLinkValidationResult;
  }
  return response.data as MagicLinkValidationResult;
}

export async function revokeMagicLink(magicLinkId: string) {
  if (useNodeMagicLinks()) {
    try {
      await apiClient.patch(`/deals/magic-links/${magicLinkId}/revoke`, {});
      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  }
  const { error } = await supabase
    .from('magic_links')
    .update({ max_uses: 0 })
    .eq('id', magicLinkId);
  return { error: error as Error | null };
}

export async function listMagicLinksForParticipant(dealParticipantId: string) {
  if (useNodeMagicLinks()) {
    try {
      const data = await apiClient.get<MagicLinkData[]>(
        `/deals/participants/${dealParticipantId}/magic-links`,
      );
      return { data: data || [], error: null };
    } catch (err) {
      return { data: [], error: err as Error };
    }
  }
  const { data, error } = await supabase
    .from('magic_links')
    .select('*')
    .eq('deal_participant_id', dealParticipantId)
    .order('created_at', { ascending: false });
  return { data: (data || []) as MagicLinkData[], error: error as Error | null };
}
