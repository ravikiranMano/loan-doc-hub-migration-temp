import { BASE_URL } from '@/services/client';

export interface SubscribePostgresChangesOptions {
  channelName: string;
  table: string;
  schema?: string;
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
  filter?: string;
  onChange: (payload?: {
    eventType: string;
    new: Record<string, unknown>;
    old: Record<string, unknown>;
  }) => void;
}

function sseUrlFor(options: SubscribePostgresChangesOptions): string | null {
  const { table, filter } = options;
  const dealIdMatch = filter?.match(/^deal_id=eq\.([^&]+)$/);
  const dealId = dealIdMatch?.[1];

  if (table === 'deals') return `${BASE_URL}/deals/events`;
  if (table === 'deal_participants' && dealId) return `${BASE_URL}/deals/${dealId}/participants/events`;
  if ((table === 'generated_documents' || table === 'generation_jobs') && dealId) {
    return `${BASE_URL}/deals/${dealId}/documents/events`;
  }
  return null;
}

export function subscribeToChanges(
  options: SubscribePostgresChangesOptions,
): { unsubscribe: () => void } {
  const url = sseUrlFor(options);
  if (url) {
    const source = new EventSource(url, { withCredentials: true });
    source.onmessage = () => options.onChange();
    source.onerror = () => {};
    return { unsubscribe: () => source.close() };
  }
  return { unsubscribe: () => {} };
}
