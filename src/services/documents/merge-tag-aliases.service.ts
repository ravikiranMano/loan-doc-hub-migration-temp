import { supabase } from '@/services/supabase/client';

export async function listMergeTagAliasesByTagNames(tagNames: string[]) {
  if (!tagNames.length) return [];
  const { data, error } = await supabase
    .from('merge_tag_aliases')
    .select('*')
    .in('tag_name', tagNames);
  if (error) throw error;
  return data || [];
}

export async function listMergeTagAliases(templateId?: string) {
  let query = supabase.from('merge_tag_aliases').select('*');
  if (templateId) query = query.eq('template_id', templateId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function insertMergeTagAlias(payload: Record<string, unknown>) {
  const { error } = await supabase.from('merge_tag_aliases').insert(payload);
  if (error) throw error;
}

export async function updateMergeTagAlias(id: string, payload: Record<string, unknown>) {
  const { error } = await supabase.from('merge_tag_aliases').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteMergeTagAlias(id: string) {
  const { error } = await supabase.from('merge_tag_aliases').delete().eq('id', id);
  if (error) throw error;
}
