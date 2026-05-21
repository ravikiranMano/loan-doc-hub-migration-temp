import { supabase } from '@/services/supabase/client';
import { assertOkNullable } from '@/services/supabase/errors';

export const STORAGE_BUCKETS = {
  contactAttachments: 'contact-attachments',
  templates: 'templates',
  generatedDocs: 'generated-docs',
} as const;

export type StorageBucket = (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];

export async function uploadFile(
  bucket: StorageBucket,
  path: string,
  file: File | Blob,
  options?: { upsert?: boolean }
) {
  const { data, error } = await supabase.storage.from(bucket).upload(path, file, options);
  if (error) throw error;
  return data;
}

export async function downloadFile(bucket: StorageBucket, path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  return assertOkNullable({ data, error }) as Blob;
}

export async function removeFiles(bucket: StorageBucket, paths: string[]) {
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error) throw error;
}

export async function uploadGeneratedDoc(path: string, file: File | Blob, options?: { upsert?: boolean }) {
  return uploadFile(STORAGE_BUCKETS.generatedDocs, path, file, options);
}
