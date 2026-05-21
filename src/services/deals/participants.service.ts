import { supabase } from '@/services/supabase/client';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

/** Node API takes deal_id from the URL; body must not include path/DB metadata. */
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
  return body;
}

export async function listParticipantsByDeal(dealId: string) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>(`/deals/${dealId}/participants`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_participants')
    .select('*')
    .eq('deal_id', dealId);
  if (error) throw error;
  return data || [];
}

export async function listParticipantsByDealAndRole(
  dealId: string,
  role: string,
  columns = '*'
) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>(`/deals/${dealId}/participants?role=${encodeURIComponent(role)}`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_participants')
    .select(columns)
    .eq('deal_id', dealId)
    .eq('role', role);
  if (error) throw error;
  return data || [];
}

export async function listParticipantsByDealOrdered(dealId: string) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>(`/deals/${dealId}/participants?sort=sequence_order`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_participants')
    .select('*')
    .eq('deal_id', dealId)
    .order('sequence_order', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

export async function listParticipantsByDealCreatedAsc(
  dealId: string,
  columns = 'id, name, email, phone, role, status, contact_id'
) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>(`/deals/${dealId}/participants?sort=created_at`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_participants')
    .select(columns)
    .eq('deal_id', dealId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function findParticipantByDealRoleName(
  dealId: string,
  role: string,
  name: string
) {
  if (isNodeApiEnabled('deals')) {
    const results = await apiClient.get<unknown[]>(
      `/deals/${dealId}/participants?role=${encodeURIComponent(role)}`
    );
    return (results as Array<{ name?: string; id?: string }>).find((p) => p.name === name) ?? null;
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_participants')
    .select('id')
    .eq('deal_id', dealId)
    .eq('role', role)
    .eq('name', name)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchParticipantById(id: string) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown>(`/deals/participants/${id}`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_participants')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function findParticipantByDealContactRole(
  dealId: string,
  contactId: string,
  role: string
) {
  if (isNodeApiEnabled('deals')) {
    const results = await apiClient.get<unknown[]>(
      `/deals/${dealId}/participants?role=${encodeURIComponent(role)}`
    );
    return (results as Array<{ contact_id?: string; id?: string }>).find((p) => p.contact_id === contactId) ?? null;
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_participants')
    .select('id')
    .eq('deal_id', dealId)
    .eq('contact_id', contactId)
    .eq('role', role)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findParticipantByDealNameRole(
  dealId: string,
  name: string,
  role: string
) {
  if (isNodeApiEnabled('deals')) {
    const results = await apiClient.get<unknown[]>(
      `/deals/${dealId}/participants?role=${encodeURIComponent(role)}`
    );
    return (results as Array<{ name?: string; id?: string }>).find((p) => p.name === name) ?? null;
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_participants')
    .select('id')
    .eq('deal_id', dealId)
    .eq('role', role)
    .eq('name', name)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findParticipantByDealEmailRole(
  dealId: string,
  email: string,
  role: string
) {
  if (isNodeApiEnabled('deals')) {
    const results = await apiClient.get<unknown[]>(
      `/deals/${dealId}/participants?role=${encodeURIComponent(role)}`
    );
    return (results as Array<{ email?: string; id?: string }>).find((p) => p.email === email) ?? null;
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_participants')
    .select('id')
    .eq('deal_id', dealId)
    .eq('email', email)
    .eq('role', role)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function insertParticipant(payload: Record<string, unknown>) {
  if (isNodeApiEnabled('deals')) {
    const dealId = payload['deal_id'] as string;
    return apiClient.post<unknown>(
      `/deals/${dealId}/participants`,
      participantBodyForApi(payload),
    );
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_participants')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateParticipant(id: string, updates: Record<string, unknown>) {
  if (isNodeApiEnabled('deals')) {
    const dealId = updates['deal_id'] as string | undefined;
    const path = dealId
      ? `/deals/${dealId}/participants/${id}`
      : `/deals/participants/${id}`;
    return apiClient.patch(path, participantBodyForApi(updates));
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('deal_participants').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteParticipant(id: string) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.delete(`/deals/participants/${id}`);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('deal_participants').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteParticipantsByContactIds(contactIds: string[]) {
  if (isNodeApiEnabled('deals')) {
    if (!contactIds.length) return;
    return apiClient.delete(
      `/deals/participants/by-contact?contactIds=${contactIds.join(',')}`,
    );
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase
    .from('deal_participants')
    .delete()
    .in('contact_id', contactIds);
  if (error) throw error;
}

export async function listParticipantsByContactAndRole(
  contactId: string,
  role: string,
  columns = 'deal_id, name'
) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>(
      `/deals/participants?contactId=${encodeURIComponent(contactId)}&role=${encodeURIComponent(role)}`,
    );
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_participants')
    .select(columns)
    .eq('contact_id', contactId)
    .eq('role', role);
  if (error) throw error;
  return data || [];
}

export async function listParticipantsByDealAndRoles(
  dealId: string,
  roles: string[],
  columns = 'id, name, email, role, contact_id'
) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>(
      `/deals/${dealId}/participants?roles=${roles.join(',')}`
    );
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_participants')
    .select(columns)
    .eq('deal_id', dealId)
    .in('role', roles);
  if (error) throw error;
  return data || [];
}

export async function listParticipantsByContact(contactId: string, columns = 'id, deal_id') {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>(
      `/deals/participants?contactId=${encodeURIComponent(contactId)}`,
    );
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_participants')
    .select(columns)
    .eq('contact_id', contactId);
  if (error) throw error;
  return data || [];
}

export async function listParticipantsByDealIds(dealIds: string[], columns = '*') {
  if (isNodeApiEnabled('deals')) {
    if (!dealIds.length) return [];
    return apiClient.get<unknown[]>(
      `/deals/participants?dealIds=${dealIds.map((id) => encodeURIComponent(id)).join(',')}`,
    );
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_participants')
    .select(columns)
    .in('deal_id', dealIds);
  if (error) throw error;
  return data || [];
}

export async function fetchParticipantsWithContacts(dealId: string) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>(`/deals/${dealId}/participants?include=contact`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('deal_participants')
    .select('*, contacts(*)')
    .eq('deal_id', dealId);
  if (error) throw error;
  return data || [];
}

export async function countParticipantsByDeal(dealId: string) {
  if (isNodeApiEnabled('deals')) {
    const results = await apiClient.get<unknown[]>(`/deals/${dealId}/participants`);
    return (results || []).length;
  }
  // — Supabase (keep unchanged) —
  const { count, error } = await supabase
    .from('deal_participants')
    .select('id', { count: 'exact', head: true })
    .eq('deal_id', dealId);
  if (error) throw error;
  return count || 0;
}

export async function deleteParticipantsByIds(ids: string[]) {
  if (isNodeApiEnabled('deals')) {
    return Promise.all(ids.map((id) => apiClient.delete(`/deals/participants/${id}`)));
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('deal_participants').delete().in('id', ids);
  if (error) throw error;
}

export async function searchParticipantsWithEmail(search: string, limit = 20) {
  if (isNodeApiEnabled('deals')) {
    return apiClient.get<unknown[]>(`/deals/participants?search=${encodeURIComponent(search)}&limit=${limit}`);
  }
  // — Supabase (keep unchanged) —
  let query = supabase
    .from('deal_participants')
    .select('id, name, email, role')
    .not('email', 'is', null);
  if (search.trim()) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
  }
  const { data, error } = await query.limit(limit);
  if (error) throw error;
  return data || [];
}
