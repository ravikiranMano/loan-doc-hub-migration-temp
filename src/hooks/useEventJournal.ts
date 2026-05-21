import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  listEventJournal,
  listEventJournalPaginated,
  insertEventJournalWithIp,
} from '@/services/system/event-journal.service';
import { fetchProfilesByUserIds } from '@/services/admin/profiles.service';

export interface FieldChange {
  fieldLabel: string;
  oldValue: string;
  newValue: string;
}

export interface EventJournalEntry {
  id: string;
  deal_id: string;
  event_number: number;
  actor_user_id: string;
  actor_name: string | null;
  section: string;
  details: FieldChange[];
  created_at: string;
  ip_address: string | null;
}

let cachedIp: string | null = null;

async function getClientIp(): Promise<string> {
  if (cachedIp) return cachedIp;
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const data = await res.json();
    cachedIp = data.ip || 'unknown';
  } catch {
    cachedIp = 'unknown';
  }
  return cachedIp!;
}

export function useEventJournalLogger() {
  const logFieldChanges = useCallback(async (
    dealId: string,
    section: string,
    changes: FieldChange[],
    actorUserId: string
  ) => {
    if (!changes.length) return;

    const ipAddress = await getClientIp();

    try {
      await insertEventJournalWithIp({
        deal_id: dealId,
        section,
        details: changes,
        actor_user_id: actorUserId,
        event_number: 0,
        ip_address: ipAddress,
      });
    } catch (error) {
      console.error('Failed to log event journal entry:', error);
    }
  }, []);

  return { logFieldChanges };
}

export function useEventJournalEntries(dealId: string | null) {
  return useQuery({
    queryKey: ['event-journal', dealId],
    enabled: !!dealId,
    queryFn: async () => {
      if (!dealId) return [];

      const entries = await listEventJournal(dealId);

      const actorIds = [...new Set((entries || []).map((e: any) => e.actor_user_id))];
      let profileMap: Record<string, string> = {};

      if (actorIds.length > 0) {
        const profiles = await fetchProfilesByUserIds(actorIds);
        (profiles || []).forEach((p: any) => {
          profileMap[p.user_id] = p.full_name || p.email || 'Unknown';
        });
      }

      return (entries || []).map((e: any): EventJournalEntry => ({
        id: e.id,
        deal_id: e.deal_id,
        event_number: e.event_number,
        actor_user_id: e.actor_user_id,
        actor_name: profileMap[e.actor_user_id] || 'Unknown',
        section: e.section,
        details: (e.details || []) as FieldChange[],
        created_at: e.created_at,
        ip_address: e.ip_address || null,
      }));
    },
  });
}

export interface PaginatedEventJournalResult {
  entries: EventJournalEntry[];
  totalCount: number;
}

export function usePaginatedEventJournalEntries(
  dealId: string | null,
  page: number,
  pageSize: number
) {
  return useQuery({
    queryKey: ['event-journal-paginated', dealId, page, pageSize],
    enabled: !!dealId,
    queryFn: async (): Promise<PaginatedEventJournalResult> => {
      if (!dealId) return { entries: [], totalCount: 0 };

      const { entries, count } = await listEventJournalPaginated(dealId, page, pageSize);

      const actorIds = [...new Set((entries || []).map((e: any) => e.actor_user_id))];
      let profileMap: Record<string, string> = {};

      if (actorIds.length > 0) {
        const profiles = await fetchProfilesByUserIds(actorIds);
        (profiles || []).forEach((p: any) => {
          profileMap[p.user_id] = p.full_name || p.email || 'Unknown';
        });
      }

      const mapped = (entries || []).map((e: any): EventJournalEntry => ({
        id: e.id,
        deal_id: e.deal_id,
        event_number: e.event_number,
        actor_user_id: e.actor_user_id,
        actor_name: profileMap[e.actor_user_id] || 'Unknown',
        section: e.section,
        details: (e.details || []) as FieldChange[],
        created_at: e.created_at,
        ip_address: e.ip_address || null,
      }));

      return { entries: mapped, totalCount: count || 0 };
    },
  });
}
