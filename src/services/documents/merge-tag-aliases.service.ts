import { apiClient } from '@/services/client';

export async function listMergeTagAliasesByTagNames(tagNames: string[]) {
  if (!tagNames.length) return [];
  return apiClient.get<unknown[]>(`/merge-tags?names=${tagNames.join(',')}`);
}

export async function listMergeTagAliases(templateId?: string) {
  const qs = templateId ? `?templateId=${encodeURIComponent(templateId)}` : '';
  return apiClient.get<unknown[]>(`/merge-tags${qs}`);
}

export async function insertMergeTagAlias(payload: Record<string, unknown>) {
  return apiClient.post('/merge-tags', payload);
}

export async function updateMergeTagAlias(id: string, payload: Record<string, unknown>) {
  return apiClient.patch(`/merge-tags/${id}`, payload);
}

export async function deleteMergeTagAlias(id: string) {
  return apiClient.delete(`/merge-tags/${id}`);
}
