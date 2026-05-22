import {
  getMagicLinkSettings as fetchMagicLinkSettings,
  createMagicLinkRecord,
  validateMagicLinkToken,
  revokeMagicLink as revokeMagicLinkRecord,
  listMagicLinksForParticipant,
  type MagicLinkSettings,
  type MagicLinkData,
  type MagicLinkValidationResult,
} from '@/services/system/magic-links.service';

export type { MagicLinkSettings, MagicLinkData, MagicLinkValidationResult };

export const generateSecureToken = (): string => {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const getMagicLinkSettings = fetchMagicLinkSettings;

export const createMagicLink = async (
  dealParticipantId: string,
  createdBy: string,
  customSettings?: Partial<MagicLinkSettings>
): Promise<{ data: MagicLinkData | null; error: Error | null; url: string | null }> => {
  const defaultSettings = await fetchMagicLinkSettings();
  const settings = { ...defaultSettings, ...customSettings };
  const token = generateSecureToken();
  const expiresAt = new Date(Date.now() + settings.expiryHours * 60 * 60 * 1000);

  try {
    const data = await createMagicLinkRecord({
      deal_participant_id: dealParticipantId,
      token,
      expires_at: expiresAt.toISOString(),
      max_uses: settings.maxUses,
      created_by: createdBy,
    });
    const url = `${window.location.origin}/access/${token}`;
    return { data, error: null, url };
  } catch (error) {
    return { data: null, error: error as Error, url: null };
  }
};

export const validateMagicLink = validateMagicLinkToken;

export const revokeMagicLink = revokeMagicLinkRecord;

export const getMagicLinksForParticipant = listMagicLinksForParticipant;

export const isMagicLinkValid = (link: MagicLinkData): boolean => {
  const expiresAt = new Date(link.expires_at);
  return expiresAt > new Date() && link.used_count < link.max_uses;
};

export const getMagicLinkStatus = (link: MagicLinkData): 'active' | 'expired' | 'exhausted' => {
  const expiresAt = new Date(link.expires_at);
  if (expiresAt <= new Date()) return 'expired';
  if (link.used_count >= link.max_uses) return 'exhausted';
  return 'active';
};

export const storeMagicLinkSession = (session: {
  dealId: string;
  role: string;
  participantId: string;
  dealNumber: string;
  sessionToken: string;
  expiresAt: string;
}): void => {
  localStorage.setItem('magic_link_session', JSON.stringify(session));
};

export const getMagicLinkSession = (): {
  dealId: string;
  role: string;
  participantId: string;
  dealNumber: string;
  sessionToken: string;
  expiresAt: string;
} | null => {
  const stored = localStorage.getItem('magic_link_session');
  if (!stored) return null;
  try {
    const session = JSON.parse(stored);
    if (new Date(session.expiresAt) <= new Date()) {
      localStorage.removeItem('magic_link_session');
      return null;
    }
    return session;
  } catch {
    localStorage.removeItem('magic_link_session');
    return null;
  }
};

export const clearMagicLinkSession = (): void => {
  localStorage.removeItem('magic_link_session');
};
