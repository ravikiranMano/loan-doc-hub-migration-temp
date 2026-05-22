export const API_VERSION = 'v1';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const MIN_PAGE_SIZE = 1;

export const ROLES = {
  ADMIN: 'admin',
  CSR: 'csr',
  BORROWER: 'borrower',
  BROKER: 'broker',
  LENDER: 'lender',
  OTHER: 'other',
} as const;

export type AppRole = (typeof ROLES)[keyof typeof ROLES];

export const DEAL_STATUS = {
  DRAFT: 'draft',
  READY: 'ready',
  GENERATED: 'generated',
} as const;

export const DEAL_MODE = {
  DOC_PREP: 'doc_prep',
  SERVICING_ONLY: 'servicing_only',
} as const;
