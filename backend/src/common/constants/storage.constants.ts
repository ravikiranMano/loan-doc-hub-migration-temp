export const STORAGE_BUCKETS = {
  CONTACT_ATTACHMENTS: 'contact-attachments',
  TEMPLATES: 'templates',
  GENERATED_DOCS: 'generated-docs',
} as const;

export type StorageBucket = (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];

export const ALLOWED_STORAGE_BUCKETS = new Set<string>(Object.values(STORAGE_BUCKETS));

export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const DEFAULT_SIGNED_URL_TTL_SECONDS = 3600;
