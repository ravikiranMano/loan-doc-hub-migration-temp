/**
 * Helpers for reading values from deal_section_values.field_values JSONB.
 * Supports plain field_dictionary UUID keys and composite "{prefix}::{uuid}" keys.
 */

export function parseSectionStorageKey(storageKey: string): {
  prefix: string | null;
  fieldDictId: string;
} {
  if (storageKey.includes('::')) {
    const [prefix, fieldDictId] = storageKey.split('::');
    return { prefix, fieldDictId };
  }
  return { prefix: null, fieldDictId: storageKey };
}

interface JsonbFieldEntry {
  value_text?: string | null;
  value_number?: number | null;
  value_date?: string | null;
}

export type SectionValuePreference = 'value_number' | 'value_text' | 'value_date' | 'auto';

/** Field dictionary UUIDs used across contact portfolio grids. */
export const PORTFOLIO_FIELD_IDS = {
  loanAmount: '163cd0b4-7cc0-4975-bcfb-43aa4be9c5c8',
  originalAmount: '32e6856c-6e72-4d91-bcd9-3a3c36b898e2',
  noteRate: '969b2029-d56f-4789-8d77-1f9aecc88f2b',
  principalBalance: '27c1bee2-05d4-46e5-a16b-e10c1e38cafd',
  maturityDate: '33fadfcb-b70c-4425-944e-23044f21a06b',
  nextPaymentDate: '384a8113-5d6d-47fd-9146-b3b1e9f65037',
  nextPayment: '18cff33e-9553-4860-becf-e6c4b54f2a20',
  accountNumber: 'b593a1fb-df22-405c-8ed0-670d251901a4',
  loanStatus: '356839ff-f156-4431-ac7d-87f038428178',
  loanType: '81a92eba-59f3-41cf-a032-b4f5f6950e04',
  originationDate: '60aac148-679d-4ebf-afaa-260c839cea13',
  closingDate: '674e4a01-7621-4eec-88f4-87c75d8867fc',
  paymentAmount: '273499a9-02a6-4a18-abb7-47c7cc9755ac',
  lastPaymentAmount: 'a0e73041-0c9e-4dd7-a6f0-426319e2b6e0',
  lastPaymentDate: '5fd9bd0c-dc57-497b-a1f8-fe142a35771a',
  fundingRecords: 'fe607d1f-3d27-4e37-8d10-326ac34d7a3f',
  fundingHistory: 'b179de11-dbe6-4e3b-b987-0a155114bc52',
} as const;

export function extractSectionFieldValue(
  fieldValues: Record<string, unknown> | null | undefined,
  fieldDictIds: string | string[],
  prefer: SectionValuePreference = 'auto',
): unknown {
  if (!fieldValues) return null;

  const ids = new Set(Array.isArray(fieldDictIds) ? fieldDictIds : [fieldDictIds]);

  for (const [storageKey, raw] of Object.entries(fieldValues)) {
    const { fieldDictId } = parseSectionStorageKey(storageKey);
    if (!ids.has(fieldDictId)) continue;

    if (raw == null) continue;
    if (typeof raw !== 'object') return raw;

    const entry = raw as JsonbFieldEntry;
    switch (prefer) {
      case 'value_number':
        return entry.value_number ?? entry.value_text ?? null;
      case 'value_text':
        return entry.value_text ?? entry.value_number ?? entry.value_date ?? null;
      case 'value_date':
        return entry.value_date ?? entry.value_text ?? null;
      default: {
        if (entry.value_number != null && entry.value_number !== 0) return entry.value_number;
        if (entry.value_text != null && String(entry.value_text).trim() !== '') return entry.value_text;
        if (entry.value_date != null && String(entry.value_date).trim() !== '') return entry.value_date;
        if (entry.value_number != null) return entry.value_number;
        return null;
      }
    }
  }

  return null;
}

export function extractPortfolioLoanAmount(fieldValues: Record<string, unknown> | null | undefined): unknown {
  return (
    extractSectionFieldValue(fieldValues, PORTFOLIO_FIELD_IDS.originalAmount, 'value_number')
    ?? extractSectionFieldValue(fieldValues, PORTFOLIO_FIELD_IDS.loanAmount, 'value_number')
    ?? extractSectionFieldValue(fieldValues, [PORTFOLIO_FIELD_IDS.originalAmount, PORTFOLIO_FIELD_IDS.loanAmount], 'value_text')
  );
}
