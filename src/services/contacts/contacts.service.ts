import { supabase } from '@/services/supabase/client';
import { generateContactId, type ContactIdType } from '@/services/supabase/rpc';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

export interface ContactRecord {
  id: string;
  contact_id: string;
  contact_type: string;
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  company: string;
  contact_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface ListContactsParams {
  contactType: ContactIdType;
  page: number;
  pageSize: number;
  search?: string;
}

export interface ListContactsResult {
  contacts: ContactRecord[];
  totalCount: number;
}

function applyContactSearch<T extends { or: (filter: string) => T }>(
  query: T,
  search: string
): T {
  return query.or(
    `full_name.ilike.%${search}%,email.ilike.%${search}%,contact_id.ilike.%${search}%,city.ilike.%${search}%,state.ilike.%${search}%,phone.ilike.%${search}%,company.ilike.%${search}%`
  );
}

export async function listContacts(params: ListContactsParams): Promise<ListContactsResult> {
  if (isNodeApiEnabled('contacts')) {
    const { contactType, page, pageSize, search } = params;
    const qs = new URLSearchParams({
      type: contactType,
      page: String(page),
      pageSize: String(pageSize),
      ...(search ? { search } : {}),
    });
    const result = await apiClient.get<{ contacts: ContactRecord[]; totalCount: number }>(
      `/contacts?${qs}`,
    );
    const contacts = (result.contacts || []).map((row) => ({
      ...row,
      contact_data: (row.contact_data as Record<string, unknown>) || {},
    }));
    return { contacts, totalCount: result.totalCount ?? contacts.length };
  }
  // — Supabase (keep unchanged) —
  const { contactType, page, pageSize, search } = params;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let countQuery = supabase
    .from('contacts')
    .select('*', { count: 'exact', head: true })
    .eq('contact_type', contactType);

  if (search) countQuery = applyContactSearch(countQuery, search);

  const { count, error: countError } = await countQuery;
  if (countError) throw countError;

  let dataQuery = supabase
    .from('contacts')
    .select('*')
    .eq('contact_type', contactType)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (search) dataQuery = applyContactSearch(dataQuery, search);

  const { data, error } = await dataQuery;
  if (error) throw error;

  const contacts = (data || []).map((row) => ({
    ...(row as ContactRecord),
    contact_data: ((row as ContactRecord).contact_data as Record<string, unknown>) || {},
  }));

  return { contacts, totalCount: count || 0 };
}

export async function getContactByContactId(
  contactId: string,
  columns = '*',
  contactType?: string
) {
  if (isNodeApiEnabled('contacts')) {
    return apiClient.get<ContactRecord | null>(`/contacts/search?q=${encodeURIComponent(contactId)}${contactType ? `&type=${contactType}` : ''}&limit=1`).then((r) => Array.isArray(r) ? r[0] ?? null : r);
  }
  // — Supabase (keep unchanged) —
  let query = supabase.from('contacts').select(columns).eq('contact_id', contactId);
  if (contactType) query = query.eq('contact_type', contactType);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

export async function getContactByEmail(email: string, columns = '*') {
  if (isNodeApiEnabled('contacts')) {
    return apiClient.get<ContactRecord | null>(`/contacts/search?q=${encodeURIComponent(email)}&limit=1`).then((r) => Array.isArray(r) ? r[0] ?? null : r);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('contacts')
    .select(columns)
    .eq('email', email)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getContactById(id: string) {
  if (isNodeApiEnabled('contacts')) {
    return apiClient.get<ContactRecord>(`/contacts/${id}`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getContactsByIds(ids: string[], columns = '*') {
  if (isNodeApiEnabled('contacts')) {
    return apiClient.get<ContactRecord[]>(`/contacts?ids=${ids.join(',')}`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase.from('contacts').select(columns).in('id', ids);
  if (error) throw error;
  return data || [];
}

export async function getContactContactData(id: string) {
  if (isNodeApiEnabled('contacts')) {
    const contact = await apiClient.get<ContactRecord>(`/contacts/${id}`);
    return (contact?.contact_data as Record<string, unknown>) || {};
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('contacts')
    .select('contact_data')
    .eq('id', id)
    .single();
  if (error) throw error;
  return (data?.contact_data as Record<string, unknown>) || {};
}

export async function searchContactsByType(
  contactType: string,
  searchTerm: string,
  limit = 10
) {
  if (isNodeApiEnabled('contacts')) {
    return apiClient.get<ContactRecord[]>(
      `/contacts/search?type=${encodeURIComponent(contactType)}&q=${encodeURIComponent(searchTerm)}&limit=${limit}`
    );
  }
  // — Supabase (keep unchanged) —
  let qb = supabase.from('contacts').select('*').eq('contact_type', contactType).limit(limit);
  if (searchTerm.trim()) {
    qb = qb.or(
      `full_name.ilike.%${searchTerm}%,contact_id.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`
    );
  }
  const { data, error } = await qb;
  if (error) throw error;
  return data || [];
}

export async function searchContactsForParticipant(
  participantType: string,
  searchTerm: string,
  limit = 10
) {
  const nativeRoles = new Set(['borrower', 'lender', 'broker', 'other']);
  if (nativeRoles.has(participantType) && participantType !== 'other') {
    return searchContactsByType(
      participantType,
      searchTerm,
      limit
    );
  }
  return searchContactsByTypes(
    ['borrower', 'lender', 'broker', 'additional_guarantor', 'authorized_party', 'co_borrower'],
    searchTerm,
    limit,
    'id, contact_id, full_name, email, phone, contact_type'
  );
}

export async function listContactsByTypes(
  contactTypes: string[],
  columns: string,
  limit = 2000
) {
  if (isNodeApiEnabled('contacts')) {
    return apiClient.get<ContactRecord[]>(
      `/contacts?types=${contactTypes.join(',')}&limit=${limit}`
    );
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('contacts')
    .select(columns)
    .in('contact_type', contactTypes)
    .order('full_name', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function listContactsByType(
  contactType: string,
  columns: string,
  limit = 2000
) {
  if (isNodeApiEnabled('contacts')) {
    return apiClient.get<ContactRecord[]>(
      `/contacts?type=${encodeURIComponent(contactType)}&limit=${limit}`
    );
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('contacts')
    .select(columns)
    .eq('contact_type', contactType)
    .order('full_name', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function searchContactsByTypes(
  contactTypes: string[],
  searchTerm: string,
  limit = 50,
  columns = 'contact_id, full_name, contact_type'
) {
  if (isNodeApiEnabled('contacts')) {
    return apiClient.get<ContactRecord[]>(
      `/contacts/search?types=${contactTypes.join(',')}&q=${encodeURIComponent(searchTerm)}&limit=${limit}`
    );
  }
  // — Supabase (keep unchanged) —
  let qb = supabase.from('contacts').select(columns).in('contact_type', contactTypes).limit(limit);
  if (searchTerm.trim()) {
    qb = qb.or(`contact_id.ilike.%${searchTerm}%,full_name.ilike.%${searchTerm}%`);
  }
  const { data, error } = await qb.order('contact_id', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createContact(params: {
  contactType: ContactIdType;
  createdBy: string;
  contactData: Record<string, string>;
}) {
  if (isNodeApiEnabled('contacts')) {
    const { contactType, createdBy, contactData } = params;
    const fullName =
      contactData.full_name ||
      `${contactData.first_name || ''} ${contactData.last_name || ''}`.trim();
    return apiClient.post<ContactRecord>('/contacts', {
      contact_type: contactType,
      created_by: createdBy,
      full_name: fullName,
      first_name: contactData.first_name || '',
      last_name: contactData.last_name || '',
      email: contactData.email || '',
      phone: contactData.phone || contactData['phone.cell'] || contactData['phone.mobile'] || contactData['phone.home'] || contactData['phone.work'] || '',
      city: contactData.city || contactData['address.city'] || contactData['primary_address.city'] || '',
      state: contactData.state || contactData['address.state'] || contactData['primary_address.state'] || '',
      company: contactData.company || '',
      contact_data: contactData,
    });
  }
  // — Supabase (keep unchanged) —
  const { contactType, createdBy, contactData } = params;
  const fullName =
    contactData.full_name ||
    `${contactData.first_name || ''} ${contactData.last_name || ''}`.trim();
  const contactId = await generateContactId(contactType);

  const insertPayload = {
    contact_type: contactType,
    contact_id: contactId,
    created_by: createdBy,
    full_name: fullName,
    first_name: contactData.first_name || contactData['first_name'] || '',
    last_name: contactData.last_name || contactData['last_name'] || '',
    email: contactData.email || '',
    phone:
      contactData.phone ||
      contactData['phone.cell'] ||
      contactData['phone.mobile'] ||
      contactData['phone.home'] ||
      contactData['phone.work'] ||
      '',
    city:
      contactData.city ||
      contactData['address.city'] ||
      contactData['primary_address.city'] ||
      '',
    state:
      contactData.state ||
      contactData['address.state'] ||
      contactData['primary_address.state'] ||
      '',
    company: contactData.company || '',
    contact_data: contactData,
  };

  const { data, error } = await supabase
    .from('contacts')
    .insert(insertPayload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function insertContact(payload: Record<string, unknown>) {
  if (isNodeApiEnabled('contacts')) {
    return apiClient.post<ContactRecord>('/contacts', payload);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase.from('contacts').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateContactRow(id: string, updates: Record<string, unknown>) {
  if (isNodeApiEnabled('contacts')) {
    return apiClient.patch(`/contacts/${id}`, updates);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('contacts').update(updates).eq('id', id);
  if (error) throw error;
}

export interface UpdateContactWithMergeOptions {
  newContactId?: string;
  contactType?: string;
}

export async function updateContactWithMerge(
  id: string,
  contactData: Record<string, string>,
  opts?: UpdateContactWithMergeOptions,
) {
  if (isNodeApiEnabled('contacts')) {
    return apiClient.patch(`/contacts/${id}/merge`, {
      contact_data: contactData,
      ...(opts?.newContactId ? { new_contact_id: opts.newContactId.trim().toUpperCase() } : {}),
    });
  }
  // — Supabase (keep unchanged) —
  const fullName =
    contactData.full_name ||
    `${contactData.first_name || ''} ${contactData.last_name || ''}`.trim();

  const { data: existing } = await supabase
    .from('contacts')
    .select('contact_data, contact_id, contact_type')
    .eq('id', id)
    .single();

  const existingData = (existing?.contact_data as Record<string, unknown>) || {};
  const mergedData: Record<string, unknown> = { ...contactData };
  Object.entries(existingData).forEach(([key, value]) => {
    if (key.startsWith('_')) mergedData[key] = value;
  });

  const requestedNewId = (opts?.newContactId || '').trim().toUpperCase();
  const currentContactId = (existing?.contact_id || '').trim();
  const willRenameId = !!requestedNewId && requestedNewId !== currentContactId;
  const resolvedContactType = opts?.contactType || existing?.contact_type || '';
  const typeLabel = resolvedContactType
    ? resolvedContactType.charAt(0).toUpperCase() + resolvedContactType.slice(1).replace(/_/g, ' ')
    : 'Contact';
  const dupMsg = `This ${typeLabel} ID already exists. Please enter a unique ID.`;

  if (willRenameId) {
    const { data: dup, error: dupErr } = await supabase
      .from('contacts')
      .select('id')
      .eq('contact_id', requestedNewId)
      .eq('contact_type', resolvedContactType)
      .neq('id', id)
      .limit(1)
      .maybeSingle();
    if (dupErr) throw dupErr;
    if (dup) throw new Error(dupMsg);
  }

  const updatePayload: Record<string, unknown> = {
    full_name: fullName,
    first_name: contactData.first_name || '',
    last_name: contactData.last_name || '',
    email: contactData.email || '',
    phone:
      contactData.phone ||
      contactData['phone.cell'] ||
      contactData['phone.mobile'] ||
      contactData['phone.home'] ||
      contactData['phone.work'] ||
      '',
    city:
      contactData.city ||
      contactData['address.city'] ||
      contactData['primary_address.city'] ||
      '',
    state:
      contactData.state ||
      contactData['address.state'] ||
      contactData['primary_address.state'] ||
      '',
    company: contactData.company || '',
    contact_data: mergedData,
    updated_at: new Date().toISOString(),
  };
  if (willRenameId) updatePayload.contact_id = requestedNewId;

  const { error } = await supabase.from('contacts').update(updatePayload).eq('id', id);
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error(dupMsg);
    throw error;
  }

  const phoneValue =
    contactData.phone ||
    contactData['phone.cell'] ||
    contactData['phone.mobile'] ||
    contactData['phone.home'] ||
    contactData['phone.work'] ||
    '';

  const { data: linkedParticipants } = await supabase
    .from('deal_participants')
    .select('id, deal_id')
    .eq('contact_id', id);

  if (linkedParticipants?.length) {
    const participantIds = linkedParticipants.map((p) => p.id);
    await supabase
      .from('deal_participants')
      .update({ name: fullName, email: contactData.email || '', phone: phoneValue })
      .in('id', participantIds);

    const newCapacity = (contactData.capacity || '').toString().trim();
    if (newCapacity) {
      const dealIds = Array.from(
        new Set(linkedParticipants.map((p) => p.deal_id).filter(Boolean))
      );
      for (const dealId of dealIds) {
        const capacityKey = `participant_${id}_capacity`;
        const { data: existingSection } = await supabase
          .from('deal_section_values')
          .select('id, field_values')
          .eq('deal_id', dealId)
          .eq('section', 'participants')
          .maybeSingle();

        const existingFv = (existingSection?.field_values as Record<string, unknown>) || {};
        const updatedFv = { ...existingFv, [capacityKey]: newCapacity };

        if (existingSection?.id) {
          await supabase
            .from('deal_section_values')
            .update({ field_values: updatedFv, updated_at: new Date().toISOString() })
            .eq('id', existingSection.id);
        } else {
          await supabase
            .from('deal_section_values')
            .insert({ deal_id: dealId, section: 'participants', field_values: updatedFv });
        }
      }
    }
  }
}

export async function deleteContact(id: string) {
  if (isNodeApiEnabled('contacts')) {
    return apiClient.delete(`/contacts/${id}`);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('contacts').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteContacts(ids: string[]) {
  if (isNodeApiEnabled('contacts')) {
    if (!ids.length) return;
    return apiClient.delete(`/contacts/bulk?ids=${ids.join(',')}`);
  }
  // — Supabase (keep unchanged) —
  const { error: dpError } = await supabase
    .from('deal_participants')
    .delete()
    .in('contact_id', ids);
  if (dpError) console.warn('Could not remove linked deal participants:', dpError);

  const { error: baError } = await supabase
    .from('borrower_attachments')
    .delete()
    .in('contact_id', ids);
  if (baError) console.warn('Could not remove linked borrower attachments:', baError);

  const { error } = await supabase.from('contacts').delete().in('id', ids);
  if (error) throw error;
}

export async function patchContactData(
  id: string,
  patch: Record<string, unknown>
) {
  if (isNodeApiEnabled('contacts')) {
    return apiClient.patch(`/contacts/${id}`, { contact_data: patch });
  }
  // — Supabase (keep unchanged) —
  const existing = await getContactContactData(id);
  const merged = { ...existing, ...patch };
  const { error } = await supabase
    .from('contacts')
    .update({ contact_data: merged })
    .eq('id', id);
  if (error) throw error;
  return merged;
}
