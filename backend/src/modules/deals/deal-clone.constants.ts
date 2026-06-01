/** Mirrors CSR DealsPage clone exclusions (keep in sync with frontend deal-clone.constants). */

export const FUNDING_OPERATIONAL_FIELD_KEYS = [
  'loan_terms.funding_history',
  'ln_p_fundingHistor',
  'loan_terms.funding_adjustments',
] as const;

export const CLEAN_FUNDING_HISTORY_KEYS = new Set([
  'loan_terms.funding_history',
  'ln_p_fundingHistor',
  'loan_terms.funding_adjustments',
]);

export const CONTACT_OPERATIONAL_KEYWORDS = [
  'history',
  'conversation',
  'attachment',
  'event_journal',
  'events_journal',
  'audit',
  'activity',
  'workflow',
  'task_history',
  'status_history',
  'communication',
  'internal_notes',
  'chat',
  'sms',
] as const;

export function getCanonicalFundingHistoryKey(fieldKey: string): string {
  if (fieldKey === 'ln_p_fundingHistor') return 'loan_terms.funding_history';
  return fieldKey;
}

export function isOperationalContactDataKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.startsWith('_') &&
    CONTACT_OPERATIONAL_KEYWORDS.some((token) => normalized.includes(token))
  );
}

export function sanitizeContactDataForCopy(contactData: unknown): Record<string, unknown> {
  const source =
    contactData && typeof contactData === 'object'
      ? (contactData as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => !isOperationalContactDataKey(key)),
  );
}

export function isOperationalCloneFieldKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (
    normalized.includes('funding_history') ||
    normalized.includes('fundinghistor') ||
    normalized.includes('funding_adjustments')
  ) {
    return true;
  }
  const isContactScoped =
    /^(borrower|coborrower|co_borrower|broker|lender|authorized_party|additional_guarantor|other|contact|participant|notes_entry)[._]/.test(
      normalized,
    );
  return isContactScoped && CONTACT_OPERATIONAL_KEYWORDS.some((token) => normalized.includes(token));
}
