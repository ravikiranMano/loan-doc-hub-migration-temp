import { getUser } from '@/services/supabase/auth';
import { fetchProfileByUserId } from '@/services/admin/profiles.service';
import { getContactContactData, updateContactRow } from '@/services/contacts/contacts.service';

export interface ContactFieldChange {
  fieldLabel: string;
  oldValue: string;
  newValue: string;
}

export interface ContactEventJournalEntry {
  id: string;
  eventNumber: number;
  section: string;
  user: string;
  details: ContactFieldChange[];
  created_at: string;
  ip_address?: string;
}

let cachedContactIp: string | null = null;

async function getContactClientIp(): Promise<string> {
  if (cachedContactIp) return cachedContactIp;
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const data = await res.json();
    cachedContactIp = data.ip || 'unknown';
  } catch {
    cachedContactIp = 'unknown';
  }
  return cachedContactIp!;
}

/**
 * Logs an event to a contact's _events_journal in contact_data JSONB.
 * This mirrors the deal event_journal pattern but stores in the contact record.
 */
export async function logContactEvent(
  contactDbId: string,
  section: string,
  changes: ContactFieldChange[],
  userName?: string,
): Promise<void> {
  if (!contactDbId || !changes.length) return;

  try {
    // Get current user name if not provided
    let actorName = userName;
    if (!actorName) {
      const { data: { user } } = await getUser();
      if (user) {
        try {
          const profile = await fetchProfileByUserId(user.id);
          actorName = profile?.full_name || profile?.email || 'Unknown';
        } catch {
          actorName = 'Unknown';
        }
      }
    }

    const ipAddress = await getContactClientIp();

    const existing = (await getContactContactData(contactDbId)) as Record<string, any>;
    const journal: ContactEventJournalEntry[] = existing._events_journal || [];

    const newEntry: ContactEventJournalEntry = {
      id: crypto.randomUUID(),
      eventNumber: journal.length + 1,
      section,
      user: actorName || 'Unknown',
      details: changes,
      created_at: new Date().toISOString(),
      ip_address: ipAddress,
    };

    const updatedJournal = [...journal, newEntry];

    await updateContactRow(contactDbId, {
      contact_data: { ...existing, _events_journal: updatedJournal },
    });
  } catch (err) {
    console.error('Failed to log contact event:', err);
  }
}