import { supabase } from '@/services/supabase/client';
import {
  STORAGE_BUCKETS,
  uploadFile,
  downloadFile,
  removeFiles,
} from '@/services/supabase/storage';
import type { BorrowerAttachmentRow } from '@/services/supabase/extended-types';

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
  const { data, error } = await supabase
    .from('borrower_attachments')
    .select('*')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as BorrowerAttachmentRow[];
}

export async function listActiveBorrowerAttachments(contactId: string) {
  const { data, error } = await supabase
    .from('borrower_attachments')
    .select('*')
    .eq('contact_id', contactId)
    .eq('status', 'active')
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  return (data || []) as BorrowerAttachmentRow[];
}

export async function insertBorrowerAttachment(row: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('borrower_attachments')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data as BorrowerAttachmentRow;
}

export async function updateBorrowerAttachment(
  id: string,
  updates: Record<string, unknown>
) {
  const { error } = await supabase.from('borrower_attachments').update(updates).eq('id', id);
  if (error) throw error;
}

export async function listConversationLogTypes() {
  const { data, error } = await supabase
    .from('conversation_log_types')
    .select('label')
    .eq('is_active', true)
    .order('display_order');
  if (error) throw error;
  return data || [];
}
