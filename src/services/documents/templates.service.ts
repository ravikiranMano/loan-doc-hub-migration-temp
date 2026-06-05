import {
  STORAGE_BUCKETS,
  uploadFile,
  downloadFile,
  removeFiles,
} from '@/services/storage';
import { apiClient } from '@/services/node-api/client';

export async function listTemplatesOrdered() {
  return apiClient.get<unknown[]>('/templates');
}

export async function listTemplates(activeOnly = false) {
  return apiClient.get<unknown[]>(`/templates${activeOnly ? '?active=true' : ''}`);
}

export async function fetchTemplatesByIds(ids: string[]) {
  if (!ids.length) return [];
  return apiClient.get<unknown[]>(`/templates?ids=${ids.join(',')}`);
}

export async function fetchTemplateById(id: string) {
  return apiClient.get<unknown>(`/templates/${id}`);
}

export async function insertTemplate(payload: Record<string, unknown>) {
  return apiClient.post('/templates', payload);
}

export async function updateTemplate(id: string, payload: Record<string, unknown>) {
  return apiClient.patch(`/templates/${id}`, payload);
}

export async function deleteTemplate(id: string) {
  return apiClient.delete(`/templates/${id}`);
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
  return apiClient.get<number>('/templates/count');
}
