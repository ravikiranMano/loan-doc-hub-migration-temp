import { invokeSendMessage } from '@/services/supabase/functions';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

export interface SendMessagePayload {
  message_type: string;
  subject?: string;
  message_body: string;
  recipients: Array<{ email?: string; name?: string; id?: string }>;
  deal_id?: string;
  attachments?: Array<{ filename: string; content?: string; size?: number }>;
}

export async function sendMessage(body: SendMessagePayload): Promise<{ data: unknown | null; error: Error | null }> {
  if (isNodeApiEnabled('system')) {
    try {
      const data = await apiClient.post('/system/messages', body);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err as Error };
    }
  }
  return invokeSendMessage(body as Record<string, unknown>);
}

export { invokeSendMessage };
