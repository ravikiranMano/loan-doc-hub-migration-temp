import { supabase } from '@/services/supabase/client';
import { fetchAllRows } from '@/services/supabase/pagination';

export async function fetchFieldDictionaryBySections(sections: string[]) {
  return fetchAllRows((client) =>
    client.from('field_dictionary').select('*').in('section', sections)
  );
}

export async function fetchFieldDictionaryByIds(ids: string[]) {
  return fetchAllRows((client) =>
    client.from('field_dictionary').select('*').in('id', ids)
  );
}

export async function fetchFieldDictionaryMetaByIds(ids: string[]) {
  const { data, error } = await supabase
    .from('field_dictionary')
    .select('id, field_key, data_type, label')
    .in('id', ids);
  if (error) throw error;
  return data || [];
}

export async function fetchFieldDictionaryKeysByIds(ids: string[]) {
  const { data, error } = await supabase
    .from('field_dictionary')
    .select('id, field_key')
    .in('id', ids);
  if (error) throw error;
  return data || [];
}

export async function fetchAllFieldDictionary(order?: string) {
  return fetchAllRows((client) => {
    let q = client.from('field_dictionary').select('*');
    if (order) q = q.order('section').order('label');
    return q;
  });
}

export async function fetchFieldDictionaryPage(columns?: string) {
  const { data, error } = await supabase
    .from('field_dictionary')
    .select(columns || '*');
  if (error) throw error;
  return data || [];
}

export async function insertFieldDictionary(payload: Record<string, unknown>) {
  const { error } = await supabase.from('field_dictionary').insert(payload);
  if (error) throw error;
}

export async function updateFieldDictionary(id: string, payload: Record<string, unknown>) {
  const { error } = await supabase.from('field_dictionary').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteFieldDictionary(id: string) {
  const { error } = await supabase.from('field_dictionary').delete().eq('id', id);
  if (error) throw error;
}

export async function countFieldDictionary() {
  const { count, error } = await supabase
    .from('field_dictionary')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}
