import { supabase } from '@/services/supabase/client';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

export async function listMergeTagAliasesByTagNames(tagNames: string[]) {
  if (!tagNames.length) return [];
  if (isNodeApiEnabled('documents')) {
    return apiClient.get<unknown[]>(`/merge-tags?names=${tagNames.join(',')}`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('merge_tag_aliases')
    .select('*')
    .in('tag_name', tagNames);
  if (error) throw error;
  return data || [];
}

export async function listMergeTagAliases(templateId?: string) {
  if (isNodeApiEnabled('documents')) {
    const qs = templateId ? `?templateId=${encodeURIComponent(templateId)}` : '';
    return apiClient.get<unknown[]>(`/merge-tags${qs}`);
  }
  // — Supabase (keep unchanged) —
  let query = supabase.from('merge_tag_aliases').select('*');
  if (templateId) query = query.eq('template_id', templateId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function insertMergeTagAlias(payload: Record<string, unknown>) {
  if (isNodeApiEnabled('documents')) {
    return apiClient.post('/merge-tags', payload);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('merge_tag_aliases').insert(payload);
  if (error) throw error;
}

export async function updateMergeTagAlias(id: string, payload: Record<string, unknown>) {
  if (isNodeApiEnabled('documents')) {
    return apiClient.patch(`/merge-tags/${id}`, payload);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('merge_tag_aliases').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteMergeTagAlias(id: string) {
  if (isNodeApiEnabled('documents')) {
    return apiClient.delete(`/merge-tags/${id}`);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('merge_tag_aliases').delete().eq('id', id);
  if (error) throw error;
}
