import { apiClient } from '@/services/node-api/client';

function participantBodyForApi(payload: Record<string, unknown>) {
  const {
    deal_id: _dealId,
    id: _id,
    created_at: _createdAt,
    updated_at: _updatedAt,
    invited_at: _invitedAt,
    completed_at: _completedAt,
    revoked_at: _revokedAt,
    ...body
  } = payload;
  return Object.fromEntries(
    Object.entries(body).filter(([, v]) => v !== null && v !== undefined),
  );
}

export async function listParticipantsByDeal(dealId: string) {
  return apiClient.get<unknown[]>(`/deals/${dealId}/participants`);
}

export async function listParticipantsByDealAndRole(dealId: string, role: string, _columns = '*') {
  return apiClient.get<unknown[]>(
    `/deals/${dealId}/participants?role=${encodeURIComponent(role)}`,
  );
}

export async function listParticipantsByDealOrdered(dealId: string) {
  return apiClient.get<unknown[]>(`/deals/${dealId}/participants?sort=sequence_order`);
}

export async function listParticipantsByDealCreatedAsc(
  dealId: string,
  _columns = 'id, name, email, phone, role, status, contact_id',
) {
  return apiClient.get<unknown[]>(`/deals/${dealId}/participants?sort=created_at`);
}

export async function findParticipantByDealRoleName(dealId: string, role: string, name: string) {
  const results = await apiClient.get<unknown[]>(
    `/deals/${dealId}/participants?role=${encodeURIComponent(role)}`,
  );
  return (results as Array<{ name?: string; id?: string }>).find((p) => p.name === name) ?? null;
}

export async function fetchParticipantById(id: string) {
  return apiClient.get<unknown>(`/deals/participants/${id}`);
}

export async function findParticipantByDealContactRole(
  dealId: string,
  contactId: string,
  role: string,
) {
  const results = await apiClient.get<unknown[]>(
    `/deals/${dealId}/participants?role=${encodeURIComponent(role)}`,
  );
  return (
    (results as Array<{ contact_id?: string; id?: string }>).find(
      (p) => p.contact_id === contactId,
    ) ?? null
  );
}

export async function findParticipantByDealNameRole(dealId: string, name: string, role: string) {
  const results = await apiClient.get<unknown[]>(
    `/deals/${dealId}/participants?role=${encodeURIComponent(role)}`,
  );
  return (results as Array<{ name?: string; id?: string }>).find((p) => p.name === name) ?? null;
}

export async function findParticipantByDealEmailRole(dealId: string, email: string, role: string) {
  const results = await apiClient.get<unknown[]>(
    `/deals/${dealId}/participants?role=${encodeURIComponent(role)}`,
  );
  return (
    (results as Array<{ email?: string; id?: string }>).find((p) => p.email === email) ?? null
  );
}

export async function insertParticipant(payload: Record<string, unknown>) {
  const dealId = payload['deal_id'] as string;
  return apiClient.post<unknown>(`/deals/${dealId}/participants`, participantBodyForApi(payload));
}

export async function updateParticipant(id: string, updates: Record<string, unknown>) {
  const dealId = updates['deal_id'] as string | undefined;
  const path = dealId ? `/deals/${dealId}/participants/${id}` : `/deals/participants/${id}`;
  return apiClient.patch(path, participantBodyForApi(updates));
}

export async function deleteParticipant(id: string) {
  return apiClient.delete(`/deals/participants/${id}`);
}

export async function deleteParticipantsByContactIds(contactIds: string[]) {
  if (!contactIds.length) return;
  return apiClient.delete(`/deals/participants/by-contact?contactIds=${contactIds.join(',')}`);
}

export async function listParticipantsByContactAndRole(
  contactId: string,
  role: string,
  _columns = 'deal_id, name',
) {
  return apiClient.get<unknown[]>(
    `/deals/participants?contactId=${encodeURIComponent(contactId)}&role=${encodeURIComponent(role)}`,
  );
}

export async function listParticipantsByDealAndRoles(
  dealId: string,
  roles: string[],
  _columns = 'id, name, email, role, contact_id',
) {
  return apiClient.get<unknown[]>(`/deals/${dealId}/participants?roles=${roles.join(',')}`);
}

export async function listParticipantsByContact(contactId: string, _columns = 'id, deal_id') {
  return apiClient.get<unknown[]>(
    `/deals/participants?contactId=${encodeURIComponent(contactId)}`,
  );
}

export async function listParticipantsByDealIds(dealIds: string[], _columns = '*') {
  if (!dealIds.length) return [];
  return apiClient.get<unknown[]>(
    `/deals/participants?dealIds=${dealIds.map((id) => encodeURIComponent(id)).join(',')}`,
  );
}

export async function fetchParticipantsWithContacts(dealId: string) {
  return apiClient.get<unknown[]>(`/deals/${dealId}/participants?include=contact`);
}

export async function countParticipantsByDeal(dealId: string) {
  const results = await apiClient.get<unknown[]>(`/deals/${dealId}/participants`);
  return (results || []).length;
}

export async function deleteParticipantsByIds(ids: string[]) {
  return Promise.all(ids.map((id) => apiClient.delete(`/deals/participants/${id}`)));
}

export async function searchParticipantsWithEmail(search: string, limit = 20) {
  return apiClient.get<unknown[]>(
    `/deals/participants?search=${encodeURIComponent(search)}&limit=${limit}`,
  );
}
