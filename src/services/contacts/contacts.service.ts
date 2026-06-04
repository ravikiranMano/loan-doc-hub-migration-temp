import { apiClient } from '@/services/node-api/client';

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
  contactType: string;
  page: number;
  pageSize: number;
  search?: string;
}

export interface ListContactsResult {
  contacts: ContactRecord[];
  totalCount: number;
}

export async function listContacts(params: ListContactsParams): Promise<ListContactsResult> {
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

export async function getContactByContactId(
  contactId: string,
  _columns = '*',
  contactType?: string,
) {
  return apiClient
    .get<ContactRecord | null>(
      `/contacts/search?q=${encodeURIComponent(contactId)}${contactType ? `&type=${contactType}` : ''}&limit=1`,
    )
    .then((r) => (Array.isArray(r) ? r[0] ?? null : r));
}

export async function getContactByEmail(email: string, _columns = '*') {
  return apiClient
    .get<ContactRecord | null>(`/contacts/search?q=${encodeURIComponent(email)}&limit=1`)
    .then((r) => (Array.isArray(r) ? r[0] ?? null : r));
}

export async function getContactById(id: string) {
  return apiClient.get<ContactRecord>(`/contacts/${id}`);
}

export async function getContactsByIds(ids: string[], _columns = '*') {
  return apiClient.get<ContactRecord[]>(`/contacts?ids=${ids.join(',')}`);
}

export async function getContactContactData(id: string) {
  const contact = await apiClient.get<ContactRecord>(`/contacts/${id}`);
  return (contact?.contact_data as Record<string, unknown>) || {};
}

export async function searchContactsByType(contactType: string, searchTerm: string, limit = 10) {
  return apiClient.get<ContactRecord[]>(
    `/contacts/search?type=${encodeURIComponent(contactType)}&q=${encodeURIComponent(searchTerm)}&limit=${limit}`,
  );
}

export async function searchContactsForParticipant(
  participantType: string,
  searchTerm: string,
  limit = 10,
) {
  const nativeRoles = new Set(['borrower', 'lender', 'broker', 'other']);
  if (nativeRoles.has(participantType) && participantType !== 'other') {
    return searchContactsByType(participantType, searchTerm, limit);
  }
  return searchContactsByTypes(
    ['borrower', 'lender', 'broker', 'additional_guarantor', 'authorized_party', 'co_borrower'],
    searchTerm,
    limit,
    'id, contact_id, full_name, email, phone, contact_type',
  );
}

export async function listContactsByTypes(
  contactTypes: string[],
  _columns: string,
  limit = 2000,
) {
  return apiClient.get<ContactRecord[]>(`/contacts?types=${contactTypes.join(',')}&limit=${limit}`);
}

export async function listContactsByType(contactType: string, _columns: string, limit = 2000) {
  return apiClient.get<ContactRecord[]>(
    `/contacts?type=${encodeURIComponent(contactType)}&limit=${limit}`,
  );
}

export async function searchContactsByTypes(
  contactTypes: string[],
  searchTerm: string,
  limit = 50,
  _columns = 'contact_id, full_name, contact_type',
) {
  return apiClient.get<ContactRecord[]>(
    `/contacts/search?types=${contactTypes.join(',')}&q=${encodeURIComponent(searchTerm)}&limit=${limit}`,
  );
}

export async function createContact(params: {
  contactType: string;
  createdBy: string;
  contactData: Record<string, string>;
}) {
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
  });
}

export async function insertContact(payload: Record<string, unknown>) {
  return apiClient.post<ContactRecord>('/contacts', payload);
}

export async function updateContactRow(id: string, updates: Record<string, unknown>) {
  return apiClient.patch(`/contacts/${id}`, updates);
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
  return apiClient.patch(`/contacts/${id}/merge`, {
    contact_data: contactData,
    ...(opts?.newContactId ? { new_contact_id: opts.newContactId.trim().toUpperCase() } : {}),
  });
}

export async function deleteContact(id: string) {
  return apiClient.delete(`/contacts/${id}`);
}

export async function deleteContacts(ids: string[]) {
  if (!ids.length) return;
  return apiClient.delete(`/contacts/bulk?ids=${ids.join(',')}`);
}

export async function patchContactData(id: string, patch: Record<string, unknown>) {
  return apiClient.patch(`/contacts/${id}`, { contact_data: patch });
}
