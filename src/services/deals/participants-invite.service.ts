import { apiClient } from '@/services/node-api/client';

export interface InviteParticipantDto {
  participantId: string;
  email: string;
  name?: string;
  accessMethod: 'login' | 'magic_link';
  magicLinkUrl?: string;
  dealNumber: string;
  role: string;
}

export async function sendParticipantInvite(
  dealId: string,
  dto: InviteParticipantDto,
): Promise<{ error: Error | null }> {
  try {
    await apiClient.post(`/deals/${dealId}/participants/${dto.participantId}/invite`, dto);
    return { error: null };
  } catch (err) {
    return { error: err as Error };
  }
}
