import { apiClient } from '@/services/client';

export async function fetchFieldDictionaryBySections(sections: string[]) {
  return apiClient.get<unknown[]>(`/admin/fields?sections=${sections.join(',')}`);
}

export async function fetchFieldDictionaryByIds(ids: string[]) {
  if (!ids.length) return [];
  return apiClient.post<unknown[]>('/admin/fields/by-ids', { ids });
}

export async function fetchFieldDictionaryMetaByIds(ids: string[]) {
  return apiClient.post<unknown[]>('/admin/fields/by-ids', { ids });
}

export async function fetchFieldDictionaryKeysByIds(ids: string[]) {
  const rows = await apiClient.post<Array<{ id: string; field_key: string }>>(
    '/admin/fields/by-ids',
    { ids },
  );
  return (rows || []).map(({ id, field_key }) => ({ id, field_key }));
}

export async function fetchAllFieldDictionary(_order?: string) {
  return apiClient.get<unknown[]>('/admin/fields');
}

export async function fetchFieldDictionaryPage(_columns?: string) {
  return apiClient.get<unknown[]>('/admin/fields');
}

export async function insertFieldDictionary(payload: Record<string, unknown>) {
  return apiClient.post('/admin/fields', payload);
}

export async function updateFieldDictionary(id: string, payload: Record<string, unknown>) {
  return apiClient.patch(`/admin/fields/${id}`, payload);
}

export async function deleteFieldDictionary(id: string) {
  return apiClient.delete(`/admin/fields/${id}`);
}

export async function countFieldDictionary() {
  return apiClient.get<number>('/admin/fields/count');
}
