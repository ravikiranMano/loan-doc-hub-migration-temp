// Storage operations are proxied through the NestJS backend (service_role key).
// Frontend never calls Supabase Storage directly — the API handles auth.
// When S3 migration happens, only the backend storage.service.ts changes.

import { uploadFile as apiUpload, BASE_URL } from '@/services/node-api/client';

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
  options?: { upsert?: boolean },
) {
  return apiUpload(bucket, path, file, options);
}

export async function downloadFile(bucket: StorageBucket, path: string): Promise<Blob> {
  const res = await fetch(
    `${BASE_URL}/storage/${bucket}/file/${encodeURIComponent(path)}`,
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error(`Download failed: ${res.statusText}`);
  return res.blob();
}

export async function getSignedUrl(bucket: StorageBucket, path: string, expiresIn = 3600): Promise<string> {
  const res = await fetch(
    `${BASE_URL}/storage/${bucket}/signed?path=${encodeURIComponent(path)}&expires=${expiresIn}`,
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error(`Signed URL failed: ${res.statusText}`);
  const data = await res.json() as { url: string };
  return data.url;
}

export async function removeFiles(bucket: StorageBucket, paths: string[]) {
  const res = await fetch(`${BASE_URL}/storage/${bucket}/remove`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  if (!res.ok) throw new Error(`Remove failed: ${res.statusText}`);
}

export async function uploadGeneratedDoc(path: string, file: File | Blob, options?: { upsert?: boolean }) {
  return uploadFile(STORAGE_BUCKETS.generatedDocs, path, file, options);
}
