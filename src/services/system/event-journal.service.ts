import { apiClient } from '@/services/node-api/client';
import type { EventJournalRow } from '@/types';

export async function listEventJournal(dealId: string) {
  return apiClient.get<EventJournalRow[]>(`/deals/${dealId}/journal`);
}

export async function insertEventJournal(payload: Record<string, unknown>) {
  const dealId = payload.deal_id as string;
  if (!dealId) return;
  const { deal_id, ...body } = payload;
  await apiClient.post(`/deals/${dealId}/journal`, body);
}

export async function fetchEventJournalEntry(id: string) {
  return apiClient.get<EventJournalRow>(`/deals/journal/${id}`);
}

export async function listEventJournalPaginated(
  dealId: string,
  page: number,
  pageSize: number
) {
  const result = await apiClient.get<{ entries: EventJournalRow[]; count: number }>(
    `/deals/${dealId}/journal?page=${page}&limit=${pageSize}`,
  );
  return { entries: result.entries || [], count: result.count ?? 0 };
}

// Legacy alias — callers that previously passed IP data can continue to use
// this signature; IP capture now happens server-side via request metadata.
export async function insertEventJournalWithIp(payload: Record<string, unknown>) {
  return insertEventJournal(payload);
}
