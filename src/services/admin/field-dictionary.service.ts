import { supabase } from '@/services/supabase/client';
import { fetchAllRows } from '@/services/supabase/pagination';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

export async function fetchFieldDictionaryBySections(sections: string[]) {
  if (isNodeApiEnabled('admin')) {
    return apiClient.get<unknown[]>(`/admin/fields?sections=${sections.join(',')}`);
  }
  return fetchAllRows((client) =>
    client.from('field_dictionary').select('*').in('section', sections)
  );
}

export async function fetchFieldDictionaryByIds(ids: string[]) {
  if (!ids.length) return [];
  if (isNodeApiEnabled('admin')) {
    return apiClient.post<unknown[]>('/admin/fields/by-ids', { ids });
  }
  return fetchAllRows((client) =>
    client.from('field_dictionary').select('*').in('id', ids)
  );
}

export async function fetchFieldDictionaryMetaByIds(ids: string[]) {
  if (isNodeApiEnabled('admin')) {
    return apiClient.post<unknown[]>('/admin/fields/by-ids', { ids });
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('field_dictionary')
    .select('id, field_key, data_type, label')
    .in('id', ids);
  if (error) throw error;
  return data || [];
}

export async function fetchFieldDictionaryKeysByIds(ids: string[]) {
  if (isNodeApiEnabled('admin')) {
    const rows = await apiClient.post<Array<{ id: string; field_key: string }>>(
      '/admin/fields/by-ids',
      { ids },
    );
    return (rows || []).map(({ id, field_key }) => ({ id, field_key }));
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('field_dictionary')
    .select('id, field_key')
    .in('id', ids);
  if (error) throw error;
  return data || [];
}

export async function fetchAllFieldDictionary(order?: string) {
  if (isNodeApiEnabled('admin')) {
    return apiClient.get<unknown[]>('/admin/fields');
  }
  return fetchAllRows((client) => {
    let q = client.from('field_dictionary').select('*');
    if (order) q = q.order('section').order('label');
    return q;
  });
}

export async function fetchFieldDictionaryPage(columns?: string) {
  if (isNodeApiEnabled('admin')) {
    return apiClient.get<unknown[]>('/admin/fields');
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('field_dictionary')
    .select(columns || '*');
  if (error) throw error;
  return data || [];
}

export async function insertFieldDictionary(payload: Record<string, unknown>) {
  if (isNodeApiEnabled('admin')) {
    return apiClient.post('/admin/fields', payload);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('field_dictionary').insert(payload);
  if (error) throw error;
}

export async function updateFieldDictionary(id: string, payload: Record<string, unknown>) {
  if (isNodeApiEnabled('admin')) {
    return apiClient.patch(`/admin/fields/${id}`, payload);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('field_dictionary').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteFieldDictionary(id: string) {
  if (isNodeApiEnabled('admin')) {
    return apiClient.delete(`/admin/fields/${id}`);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('field_dictionary').delete().eq('id', id);
  if (error) throw error;
}

export async function countFieldDictionary() {
  if (isNodeApiEnabled('admin')) {
    return apiClient.get<number>('/admin/fields/count');
  }
  // — Supabase (keep unchanged) —
  const { count, error } = await supabase
    .from('field_dictionary')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}
