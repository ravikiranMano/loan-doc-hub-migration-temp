import { supabase } from '@/services/supabase/client';
import type { EventJournalRow } from '@/services/supabase/extended-types';

export async function listEventJournal(dealId: string) {
  const { data, error } = await supabase
    .from('event_journal')
    .select('*')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as EventJournalRow[];
}

export async function insertEventJournal(payload: Record<string, unknown>) {
  const { error } = await supabase.from('event_journal').insert(payload);
  if (error) throw error;
}

export async function fetchEventJournalEntry(id: string) {
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
  const { error } = await supabase.from('event_journal').insert(payload);
  if (error) throw error;
}
