import { supabase } from '@/services/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type PostgresChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

export interface SubscribePostgresChangesOptions {
  channelName: string;
  table: string;
  schema?: string;
  event?: PostgresChangeEvent;
  filter?: string;
  onChange: (payload?: {
    eventType: string;
    new: Record<string, unknown>;
    old: Record<string, unknown>;
  }) => void;
}

export function subscribePostgresChanges(
  options: SubscribePostgresChangesOptions
): { channel: RealtimeChannel; unsubscribe: () => void } {
  const { channelName, table, schema = 'public', event = '*', filter, onChange } = options;

  let channel = supabase.channel(channelName);

  const config: {
    event: PostgresChangeEvent;
    schema: string;
    table: string;
    filter?: string;
  } = { event, schema, table };
  if (filter) config.filter = filter;

  channel = channel.on('postgres_changes', config, (payload) => {
    onChange(
      payload as {
        eventType: string;
        new: Record<string, unknown>;
        old: Record<string, unknown>;
      }
    );
  }).subscribe();

  return {
    channel,
    unsubscribe: () => {
      supabase.removeChannel(channel);
    },
  };
}
