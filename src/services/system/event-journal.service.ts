import { supabase } from '@/services/supabase/client';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';
import type { EventJournalRow } from '@/services/supabase/extended-types';

function useNodeJournal(): boolean {
  return isNodeApiEnabled('deals') || isNodeApiEnabled('system');
}

export async function listEventJournal(dealId: string) {
  if (useNodeJournal()) {
    return apiClient.get<EventJournalRow[]>(`/deals/${dealId}/journal`);
  }
  const { data, error } = await supabase
    .from('event_journal')
    .select('*')
    .eq('deal_id', dealId)
    .order('event_number', { ascending: false });
  if (error) throw error;
  return (data || []) as EventJournalRow[];
}

export async function insertEventJournal(payload: Record<string, unknown>) {
  const dealId = payload.deal_id as string;
  if (useNodeJournal() && dealId) {
    const { deal_id, ...body } = payload;
    await apiClient.post(`/deals/${dealId}/journal`, body);
    return;
  }
  const { error } = await supabase.from('event_journal').insert(payload);
  if (error) throw error;
}

export async function fetchEventJournalEntry(id: string) {
  if (useNodeJournal()) {
    return apiClient.get<EventJournalRow>(`/deals/journal/${id}`);
  }
  const { data, error } = await supabase
    .from('event_journal')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as EventJournalRow;
}

export async function listEventJournalPaginated(
  dealId: string,
  page: number,
  pageSize: number
) {
  if (useNodeJournal()) {
    const result = await apiClient.get<{ entries: EventJournalRow[]; count: number }>(
      `/deals/${dealId}/journal?page=${page}&limit=${pageSize}`,
    );
    return { entries: result.entries || [], count: result.count ?? 0 };
  }
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await supabase
    .from('event_journal')
    .select('*', { count: 'exact' })
    .eq('deal_id', dealId)
    .order('event_number', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return { entries: (data || []) as EventJournalRow[], count: count || 0 };
}

export async function insertEventJournalWithIp(payload: Record<string, unknown>) {
  return insertEventJournal(payload);
}
