import { subscribePostgresChanges } from '@/services/supabase/realtime';
import type { SubscribePostgresChangesOptions } from '@/services/supabase/realtime';
import { isNodeApiEnabled, BASE_URL } from '@/services/node-api/client';

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
  if (isNodeApiEnabled('deals')) {
    const url = sseUrlFor(options);
    if (url) {
      const source = new EventSource(url, { withCredentials: true });
      source.onmessage = () => options.onChange();
      source.onerror = () => {};
      return { unsubscribe: () => source.close() };
    }
  }
  return subscribePostgresChanges(options);
}
