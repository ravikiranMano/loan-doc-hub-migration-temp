import { invokeSendParticipantInvite } from '@/services/supabase/functions';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

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
  if (isNodeApiEnabled('deals')) {
    try {
      await apiClient.post(`/deals/${dealId}/participants/${dto.participantId}/invite`, dto);
      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  }
  const { error } = await invokeSendParticipantInvite(dto as Record<string, unknown>);
  return { error: error as Error | null };
}
