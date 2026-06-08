import { uploadFile as apiUpload, apiFetch } from '@/services/client';

export const STORAGE_BUCKETS = {
  contactAttachments: 'contact-attachments',
  templates: 'templates',
  generatedDocs: 'generated-docs',
} as const;

export type StorageBucket = (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];

/** Build /storage/:bucket/file/a/b/c — encode each segment, preserve slashes. */
export function storageDownloadUrl(bucket: StorageBucket, objectPath: string): string {
  const segments = objectPath.split('/').filter(Boolean).map((s) => encodeURIComponent(s));
  return `/storage/${bucket}/file/${segments.join('/')}`;
}

export async function uploadFile(
  bucket: StorageBucket,
  path: string,
  file: File | Blob,
  options?: { upsert?: boolean },
) {
  return apiUpload(bucket, path, file, options);
}

async function storageFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((err as { message?: string }).message ?? `Storage request failed: ${res.status}`);
  }
  return res;
}

export async function downloadFile(bucket: StorageBucket, path: string): Promise<Blob> {
  const res = await storageFetch(storageDownloadUrl(bucket, path), { method: 'GET' });
  return res.blob();
}

export async function getSignedUrl(bucket: StorageBucket, path: string, expiresIn = 3600): Promise<string> {
  const res = await storageFetch(
    `/storage/${bucket}/signed?path=${encodeURIComponent(path)}&expires=${expiresIn}`,
    { method: 'GET' },
  );
  const data = await res.json() as { url: string };
  return data.url;
}

export async function removeFiles(bucket: StorageBucket, paths: string[]) {
  await storageFetch(`/storage/${bucket}/remove`, {
    method: 'DELETE',
    body: JSON.stringify({ paths }),
  });
}

export async function uploadGeneratedDoc(path: string, file: File | Blob, options?: { upsert?: boolean }) {
  return uploadFile(STORAGE_BUCKETS.generatedDocs, path, file, options);
}
