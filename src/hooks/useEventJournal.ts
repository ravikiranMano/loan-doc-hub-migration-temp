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

async function resolveActorNames(actorIds: string[]): Promise<Record<string, string>> {
  const profileMap: Record<string, string> = {};
  if (!actorIds.length) return profileMap;
  try {
    const profiles = await fetchProfilesByUserIds(actorIds);
    (profiles || []).forEach((p) => {
      profileMap[p.user_id] = p.full_name || p.email || 'Unknown';
    });
  } catch (err) {
    console.warn('Event journal: could not load actor names (entries still shown):', err);
  }
  return profileMap;
}

function mapJournalRow(e: Record<string, unknown>, profileMap: Record<string, string>): EventJournalEntry {
  const actorId = String(e.actor_user_id ?? '');
  const actorNameFromApi = typeof e.actor_name === 'string' ? e.actor_name : null;
  return {
    id: String(e.id),
    deal_id: String(e.deal_id),
    event_number: Number(e.event_number ?? 0),
    actor_user_id: actorId,
    actor_name: actorNameFromApi || profileMap[actorId] || 'Unknown',
    section: String(e.section ?? ''),
    details: (e.details || []) as FieldChange[],
    created_at: typeof e.created_at === 'string' ? e.created_at : String(e.created_at ?? ''),
    ip_address: (e.ip_address as string | null) ?? null,
  };
}

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
    staleTime: 0,
    queryFn: async () => {
      if (!dealId) return [];

      const entries = await listEventJournal(dealId);
      const rows = (entries || []) as Record<string, unknown>[];
      const needsProfiles = rows.some((e) => !e.actor_name);
      const profileMap = needsProfiles
        ? await resolveActorNames([...new Set(rows.map((e) => String(e.actor_user_id)))])
        : {};
      return rows.map((e) => mapJournalRow(e, profileMap));
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
    staleTime: 0,
    queryFn: async (): Promise<PaginatedEventJournalResult> => {
      if (!dealId) return { entries: [], totalCount: 0 };

      const { entries, count } = await listEventJournalPaginated(dealId, page, pageSize);
      const rows = (entries || []) as Record<string, unknown>[];
      const needsProfiles = rows.some((e) => !e.actor_name);
      const profileMap = needsProfiles
        ? await resolveActorNames([...new Set(rows.map((e) => String(e.actor_user_id)))])
        : {};
      const mapped = rows.map((e) => mapJournalRow(e, profileMap));

      return { entries: mapped, totalCount: count || 0 };
    },
  });
}
