import { supabase } from '@/services/supabase/client';

export async function listParticipantsByDeal(dealId: string) {
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
  const { data, error } = await supabase
    .from('deal_participants')
    .select(columns)
    .eq('deal_id', dealId)
    .eq('role', role);
  if (error) throw error;
  return data || [];
}

export async function listParticipantsByDealOrdered(dealId: string) {
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
  const { data, error } = await supabase
    .from('deal_participants')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateParticipant(id: string, updates: Record<string, unknown>) {
  const { error } = await supabase.from('deal_participants').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteParticipant(id: string) {
  const { error } = await supabase.from('deal_participants').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteParticipantsByContactIds(contactIds: string[]) {
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
  const { data, error } = await supabase
    .from('deal_participants')
    .select(columns)
    .eq('deal_id', dealId)
    .in('role', roles);
  if (error) throw error;
  return data || [];
}

export async function listParticipantsByContact(contactId: string, columns = 'id, deal_id') {
  const { data, error } = await supabase
    .from('deal_participants')
    .select(columns)
    .eq('contact_id', contactId);
  if (error) throw error;
  return data || [];
}

export async function listParticipantsByDealIds(dealIds: string[], columns = '*') {
  const { data, error } = await supabase
    .from('deal_participants')
    .select(columns)
    .in('deal_id', dealIds);
  if (error) throw error;
  return data || [];
}

export async function fetchParticipantsWithContacts(dealId: string) {
  const { data, error } = await supabase
    .from('deal_participants')
    .select('*, contacts(*)')
    .eq('deal_id', dealId);
  if (error) throw error;
  return data || [];
}

export async function countParticipantsByDeal(dealId: string) {
  const { count, error } = await supabase
    .from('deal_participants')
    .select('id', { count: 'exact', head: true })
    .eq('deal_id', dealId);
  if (error) throw error;
  return count || 0;
}

export async function deleteParticipantsByIds(ids: string[]) {
  const { error } = await supabase.from('deal_participants').delete().in('id', ids);
  if (error) throw error;
}

export async function searchParticipantsWithEmail(search: string, limit = 20) {
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
