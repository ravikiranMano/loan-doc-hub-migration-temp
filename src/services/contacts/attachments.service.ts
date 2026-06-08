import {
  STORAGE_BUCKETS,
  uploadFile,
  downloadFile,
  removeFiles,
} from '@/services/storage';
import type { BorrowerAttachmentRow } from '@/types';
import { apiClient } from '@/services/client';

export const CONTACT_ATTACHMENTS_BUCKET = STORAGE_BUCKETS.contactAttachments;

export async function uploadContactAttachment(path: string, file: File | Blob) {
  return uploadFile(CONTACT_ATTACHMENTS_BUCKET, path, file);
}

export async function downloadContactAttachment(path: string) {
  return downloadFile(CONTACT_ATTACHMENTS_BUCKET, path);
}

export async function removeContactAttachments(paths: string[]) {
  return removeFiles(CONTACT_ATTACHMENTS_BUCKET, paths);
}

export async function listBorrowerAttachments(contactId: string) {
  return apiClient.get<BorrowerAttachmentRow[]>(`/contacts/${contactId}/attachments`);
}

export async function listActiveBorrowerAttachments(contactId: string) {
  return apiClient.get<BorrowerAttachmentRow[]>(`/contacts/${contactId}/attachments?active=true`);
}

export async function insertBorrowerAttachment(row: Record<string, unknown>) {
  const contactId = row['contact_id'] as string;
  return apiClient.post<BorrowerAttachmentRow>(`/contacts/${contactId}/attachments`, row);
}

export async function updateBorrowerAttachment(id: string, updates: Record<string, unknown>) {
  const contactId = updates['contact_id'] as string | undefined;
  return apiClient.patch(`/contacts/${contactId ?? '_'}/attachments/${id}`, updates);
}

export async function listConversationLogTypes() {
  return apiClient.get<unknown[]>('/contacts/conversation-log-types');
}
