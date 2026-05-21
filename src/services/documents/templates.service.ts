import { supabase } from '@/services/supabase/client';
import {
  STORAGE_BUCKETS,
  uploadFile,
  downloadFile,
  removeFiles,
} from '@/services/supabase/storage';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

export async function listTemplatesOrdered() {
  if (isNodeApiEnabled('documents')) {
    return apiClient.get<unknown[]>('/templates');
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .order('name')
    .order('version', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listTemplates(activeOnly = false, columns = '*') {
  if (isNodeApiEnabled('documents')) {
    return apiClient.get<unknown[]>(`/templates${activeOnly ? '?active=true' : ''}`);
  }
  // — Supabase (keep unchanged) —
  let query = supabase.from('templates').select(columns).order('name');
  if (activeOnly) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function fetchTemplatesByIds(ids: string[], columns = 'id, name') {
  if (isNodeApiEnabled('documents')) {
    if (!ids.length) return [];
    return apiClient.get<unknown[]>(`/templates?ids=${ids.join(',')}`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase.from('templates').select(columns).in('id', ids);
  if (error) throw error;
  return data || [];
}

export async function fetchTemplateById(id: string) {
  if (isNodeApiEnabled('documents')) {
    return apiClient.get<unknown>(`/templates/${id}`);
  }
  // — Supabase (keep unchanged) —
  const { data, error } = await supabase.from('templates').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function insertTemplate(payload: Record<string, unknown>) {
  if (isNodeApiEnabled('documents')) {
    return apiClient.post('/templates', payload);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('templates').insert(payload);
  if (error) throw error;
}

export async function updateTemplate(id: string, payload: Record<string, unknown>) {
  if (isNodeApiEnabled('documents')) {
    return apiClient.patch(`/templates/${id}`, payload);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('templates').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteTemplate(id: string) {
  if (isNodeApiEnabled('documents')) {
    return apiClient.delete(`/templates/${id}`);
  }
  // — Supabase (keep unchanged) —
  const { error } = await supabase.from('templates').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteTemplateCascade(template: {
  id: string;
  file_path?: string | null;
  reference_pdf_path?: string | null;
}) {
  const {
    deleteGeneratedDocumentsByTemplate,
    deleteGenerationJobsByTemplate,
    deletePacketTemplatesByTemplate,
    deleteTemplateFieldMapsByTemplate,
  } = await import('@/services/documents/generation.service');

  const filesToDelete: string[] = [];
  if (template.file_path) filesToDelete.push(template.file_path);
  if (template.reference_pdf_path) filesToDelete.push(template.reference_pdf_path);
  if (filesToDelete.length > 0) {
    await removeTemplateFiles(filesToDelete);
  }

  await deleteGeneratedDocumentsByTemplate(template.id);
  await deleteTemplateFieldMapsByTemplate(template.id);
  await deleteGenerationJobsByTemplate(template.id);
  await deletePacketTemplatesByTemplate(template.id);
  await deleteTemplate(template.id);
}

export async function uploadTemplateDocx(
  fileName: string,
  file: File,
  options?: { upsert?: boolean }
) {
  return uploadFile(STORAGE_BUCKETS.templates, fileName, file, options);
}

export async function uploadTemplatePdf(fileName: string, file: File) {
  return uploadFile(STORAGE_BUCKETS.templates, fileName, file);
}

export async function downloadTemplateFile(path: string) {
  return downloadFile(STORAGE_BUCKETS.templates, path);
}

export async function removeTemplateFiles(paths: string[]) {
  return removeFiles(STORAGE_BUCKETS.templates, paths);
}

export async function countActiveTemplates() {
  if (isNodeApiEnabled('documents')) {
    return apiClient.get<number>('/templates/count');
  }
  // — Supabase (keep unchanged) —
  const { count, error } = await supabase
    .from('templates')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);
  if (error) throw error;
  return count || 0;
}
