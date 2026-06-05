import { fetchSystemSettingsByKeys } from '@/services/system/settings.service';
import { apiClient } from '@/services/node-api/client';

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

export async function getMagicLinkSettings(): Promise<MagicLinkSettings> {
  let data: { setting_key: string; setting_value: string | null }[] = [];
  try {
    data = await fetchSystemSettingsByKeys(['magic_link_expiry_hours', 'magic_link_max_uses']);
  } catch (error) {
    console.error('Error fetching magic link settings:', error);
    return { expiryHours: 72, maxUses: 5 };
  }

  const settings = (data || []).reduce(
    (acc, { setting_key, setting_value }) => {
      acc[setting_key] = setting_value;
      return acc;
    },
    {} as Record<string, string | null>,
  );

  return {
    expiryHours: parseInt(settings['magic_link_expiry_hours'] || '72', 10),
    maxUses: parseInt(settings['magic_link_max_uses'] || '5', 10),
  };
}

export async function createMagicLinkRecord(payload: Record<string, unknown>) {
  const { deal_participant_id, ...body } = payload;
  return apiClient.post<MagicLinkData>(
    `/deals/participants/${deal_participant_id}/magic-links`,
    body,
  );
}

export async function validateMagicLinkToken(token: string): Promise<MagicLinkValidationResult> {
  try {
    return await apiClient.post<MagicLinkValidationResult>('/deals/magic-links/validate', {
      token,
    });
  } catch (err) {
    return { isValid: false, error: (err as Error).message };
  }
}

export async function revokeMagicLink(magicLinkId: string) {
  try {
    await apiClient.patch(`/deals/magic-links/${magicLinkId}/revoke`, {});
    return { error: null };
  } catch (err) {
    return { error: err as Error };
  }
}

export async function listMagicLinksForParticipant(dealParticipantId: string) {
  try {
    const data = await apiClient.get<MagicLinkData[]>(
      `/deals/participants/${dealParticipantId}/magic-links`,
    );
    return { data: data || [], error: null };
  } catch (err) {
    return { data: [], error: err as Error };
  }
}
