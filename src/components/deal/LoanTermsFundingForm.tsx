import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { LoanFundingGrid } from './LoanFundingGrid';
import type { FundingRecord } from './LoanFundingGrid';
import type { FundingAdjustmentData } from './FundingAdjustmentModal';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { FieldDefinition } from '@/hooks/useDealFields';
import type { CalculationResult } from '@/lib/calculationEngine';
import type { FundingFormData } from './AddFundingModal';
import { resolveLegacyKey } from '@/lib/legacyKeyMap';
import { unformatCurrencyDisplay } from '@/lib/numericInputFilter';
import { Decimal, computeAmortizedPayment } from '@/lib/precisionFormat';

/**
 * Recompute the persisted per-lender Payment for every funding row using
 * the canonical platform formula (matches LoanFundingGrid display and
 * AddFundingModal):
 *
 *   ProRata_i      = originalAmount_i ÷ loanPrincipal × 100
 *   Lender Payment_i = (ProRata_i ÷ 100) × Borrower Regular P&I
 *
 * Rate (Note/Lender) is NOT used here — rates only drive interest accrual.
 * Sub-cent rounding drift between the exact total and the sum of rounded
 * shares is absorbed by the single lender flagged `roundingAdjustment`
 * (mutual exclusivity enforced elsewhere). Decimal.js throughout — no
 * native floating point on financial math.
 */
/**
 * Canonical per-lender Payment formula (matches LoanFundingGrid display):
 *   Lender Payment = (Original / Principal) × Regular P&I × (LenderRate / NoteRate)
 *
 * When a lender's Lender Rate matches the Note Rate (or no Lender Rate is set),
 * the scaling factor is 1 and the result is the legacy pro-rata Payment.
 * The Note Rate − Lender Rate gap is the servicing/broker spread and is
 * surfaced downstream — never lost.
 *
 * Banker's rounding to 2dp; sub-cent drift is absorbed by the row flagged
 * `roundingAdjustment` so the persisted total reconciles to the cent.
 */
const recomputeLenderPayments = (
  records: FundingRecord[],
  loanPrincipalRaw: string,
  regularPIRaw: string,
  noteRateRaw: string,
): FundingRecord[] => {
  if (!records.length) return records;
  const principal = new Decimal(parseFloat((loanPrincipalRaw || '').replace(/[$,]/g, '')) || 0);
  const regPI = new Decimal(parseFloat((regularPIRaw || '').replace(/[$,]/g, '')) || 0);
  if (principal.lte(0) || regPI.lte(0)) {
    // Without a principal or scheduled P&I we can't split — leave payments untouched.
    return records;
  }
  const noteRateDec = new Decimal(parseFloat((noteRateRaw || '').toString().replace(/[%,]/g, '')) || 0);
  const useRateScaling = noteRateDec.gt(0);
  const exact = records.map(r => {
    const orig = new Decimal(r.originalAmount || 0);
    const base = orig.div(principal).mul(regPI);
    if (!useRateScaling) return base;
    const lr = Number(r.lenderRate);
    if (!Number.isFinite(lr) || lr <= 0) return base; // no lender rate → fall back to note rate
    const lenderRateDec = new Decimal(lr);
    if (lenderRateDec.equals(noteRateDec)) return base;
    return base.mul(lenderRateDec).div(noteRateDec);
  });
  const rounded = exact.map(d => d.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN));
  const sumExact = exact.reduce((a, b) => a.plus(b), new Decimal(0))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
  const sumRounded = rounded.reduce((a, b) => a.plus(b), new Decimal(0));
  const diff = sumExact.minus(sumRounded);
  const adjIdx = records.findIndex(r => r.roundingAdjustment);
  if (adjIdx >= 0 && !diff.isZero()) {
    rounded[adjIdx] = rounded[adjIdx].plus(diff);
  }
  return records.map((r, i) => ({ ...r, regularPayment: rounded[i].toNumber() }));
};

/** Strip commas/$ from a string before parseFloat so formatted values like "3,423.00" parse correctly */
const safeParseFloat = (v: string | undefined): number => {
  if (!v) return 0;
  return parseFloat(unformatCurrencyDisplay(v.replace(/\$/g, ''))) || 0;
};

// Field key mapping for funding data stored in loan_terms section
const FIELD_KEYS = {
  fundingRecords: 'loan_terms.funding_records',
  fundingHistory: 'loan_terms.funding_history',
  fundingAdjustments: 'loan_terms.funding_adjustments',
} as const;

interface LoanTermsFundingFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  saveDraft?: () => Promise<boolean>;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
  dealId: string;
  onRefresh?: () => void;
}

/**
 * Helper: resolve a field_dictionary UUID for a given field_key.
 * Cached per component lifecycle via the returned ref map.
 */
async function resolveFieldDictId(fieldKey: string, cache: Map<string, string>): Promise<string | null> {
  if (cache.has(fieldKey)) return cache.get(fieldKey)!;

  const candidateKeys = Array.from(new Set([fieldKey, resolveLegacyKey(fieldKey)]));

  const { data: rows, error } = await supabase
    .from('field_dictionary')
    .select('id, field_key')
    .in('field_key', candidateKeys);

  if (error || !rows?.length) {
    console.warn(`[LoanTermsFundingForm] Could not resolve field_dictionary id for "${fieldKey}"`, error);
    return null;
  }

  const data = rows.find((row) => row.field_key === fieldKey)
    || rows.find((row) => row.field_key === resolveLegacyKey(fieldKey))
    || rows[0];

  cache.set(fieldKey, data.id);
  if (data.field_key !== fieldKey) {
    cache.set(data.field_key, data.id);
  }

  return data.id;
}

/**
 * Direct-persist a JSON value into deal_section_values for loan_terms section.
 */
async function directPersistFundingField(
  dealId: string,
  fieldKey: string,
  jsonValue: string,
  dictCache: Map<string, string>,
): Promise<boolean> {
  try {
    const fieldDictId = await resolveFieldDictId(fieldKey, dictCache);
    if (!fieldDictId) return false;

    const { data: sectionRows, error: fetchError } = await supabase
      .from('deal_section_values')
      .select('id, field_values, version')
      .eq('deal_id', dealId)
      .eq('section', 'loan_terms');

    if (fetchError) throw fetchError;

    if (sectionRows && sectionRows.length > 0) {
      let targetRow = sectionRows.find((sv) => {
        const fv = (sv.field_values as Record<string, any>) || {};
        return !!fv[fieldDictId];
      }) || sectionRows[0];

      const fieldValues = ((targetRow.field_values as Record<string, any>) || {});
      fieldValues[fieldDictId] = {
        ...(fieldValues[fieldDictId] || {}),
        value_text: jsonValue,
        indexed_key: fieldKey,
        indexed_db_key: resolveLegacyKey(fieldKey),
        updated_at: new Date().toISOString(),
      };

      const { error: updateError } = await supabase
        .from('deal_section_values')
        .update({
          field_values: JSON.parse(JSON.stringify(fieldValues)),
          updated_at: new Date().toISOString(),
          version: (targetRow.version || 0) + 1,
        })
        .eq('id', targetRow.id);

      if (updateError) throw updateError;
      return true;
    } else {
      const fieldValues: Record<string, any> = {};
      fieldValues[fieldDictId] = {
        value_text: jsonValue,
        indexed_key: fieldKey,
        indexed_db_key: resolveLegacyKey(fieldKey),
        updated_at: new Date().toISOString(),
      };

      const { error: insertError } = await supabase
        .from('deal_section_values')
        .insert({
          deal_id: dealId,
          section: 'loan_terms',
          field_values: fieldValues,
          version: 1,
        });

      if (insertError) throw insertError;
      return true;
    }
  } catch (err) {
    console.error(`[LoanTermsFundingForm] directPersist failed for "${fieldKey}":`, err);
    return false;
  }
}

export const LoanTermsFundingForm: React.FC<LoanTermsFundingFormProps> = ({
  fields,
  values,
  onValueChange,
  saveDraft,
  showValidation = false,
  disabled = false,
  calculationResults = {},
  dealId,
  onRefresh,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [isLoading, setIsLoading] = useState(false);
  const dictCacheRef = useRef<Map<string, string>>(new Map());
  const hydrationAttemptedRef = useRef(false);

  // Get loan number and borrower name from values - auto-populate.
  // Account auto-fills from Previous Account Number (loan_terms.previous_account_number)
  // when the user hasn't typed anything into the Account field yet.
  const previousAccountNumber =
    values['loan_terms.previous_account_number'] ||
    values['ln_p_previousAccountNumber'] ||
    '';
  const derivedLoanNumber =
    values['loan_terms.loan_number'] ||
    values['Terms.LoanNumber'] ||
    previousAccountNumber ||
    '';
  const [localLoanNumber, setLocalLoanNumber] = useState(derivedLoanNumber);
  const loanNumberEdited = useRef(false);

  // Sync from props only if user hasn't locally edited
  useEffect(() => {
    if (!loanNumberEdited.current && derivedLoanNumber) {
      setLocalLoanNumber((prev) => (prev === derivedLoanNumber ? prev : derivedLoanNumber));
      const existing = values['loan_terms.loan_number'] || values['Terms.LoanNumber'] || '';
      if (!existing && previousAccountNumber) {
        onValueChange('Terms.LoanNumber', previousAccountNumber);
      }
    }
  }, [derivedLoanNumber, previousAccountNumber, values, onValueChange]);

  const loanNumber = localLoanNumber;

  // Borrower Name: auto-populate from Participants table (primary borrower)
  const [participantBorrowerName, setParticipantBorrowerName] = useState('');
  const derivedBorrowerName = values['loan_terms.details_borrower_name'] || '';
  const [localBorrowerName, setLocalBorrowerName] = useState('');
  const borrowerNameEdited = useRef(false);

  useEffect(() => {
    if (!dealId) return;
    const fetchBorrower = async () => {
      // Fetch ALL borrower participants for this deal
      const { data: participants } = await supabase
        .from('deal_participants')
        .select('name, contact_id')
        .eq('deal_id', dealId)
        .eq('role', 'borrower')
        .order('created_at', { ascending: true });

      if (!participants || participants.length === 0) return;

      // Primary = first borrower participant
      const primary = participants[0];
      let primaryName = primary.name || '';

      // If no name on participant row, fallback to contacts table
      if (!primaryName && primary.contact_id) {
        const { data: contact } = await supabase
          .from('contacts')
          .select('full_name, first_name, last_name')
          .eq('id', primary.contact_id)
          .maybeSingle();
        if (contact) {
          primaryName = contact.full_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
        }
      }

      // Indicate additional borrowers if present
      if (participants.length > 1) {
        primaryName = `${primaryName} (+${participants.length - 1} more)`;
      }

      if (primaryName) {
        setParticipantBorrowerName(primaryName);
      }
    };
    fetchBorrower();
  }, [dealId]);

  // Sync borrower from props/participants only if user hasn't locally edited
  useEffect(() => {
    if (!borrowerNameEdited.current) {
      const name = derivedBorrowerName || participantBorrowerName || '';
      if (name) setLocalBorrowerName(name);
    }
  }, [derivedBorrowerName, participantBorrowerName]);

  const borrowerName = localBorrowerName;

  // Get loan rates for Rate Selection
  const noteRate = values['loan_terms.note_rate'] || '';
  const soldRate = values['loan_terms.sold_rate_enabled'] ? (values['loan_terms.sold_rate_company'] || values['loan_terms.sold_rate'] || '') : '';
  const totalPayment = values['loan_terms.regular_payment'] || values['loan_terms.total_payment'] || '';
  const loanAmount = values['loan_terms.loan_amount'] || values['loan_terms.original_loan_amount'] || '';
  // Funding is anchored to Loan → Terms & Balances → Original Amount.
  // All funding math (Pro Rata, Current Balance fill, over-funding guard) flows
  // from this single source; falls back to loan_terms.principal only if Original
  // Amount has not been entered yet so legacy deals keep working.
  const loanPrincipalBalance =
    values['loan_terms.original_amount'] ||
    values['loan_terms.principal'] ||
    '';
  const remainingPayments = parseFloat(values['ln_p_termMonths'] || '') || 0;

  // Parse funding records from stored JSON value
  const fundingRecords: FundingRecord[] = useMemo(() => {
    const storedValue = values[FIELD_KEYS.fundingRecords];
    if (storedValue) {
      try {
        return JSON.parse(storedValue);
      } catch {
        return [];
      }
    }
    return [];
  }, [values]);

  // Self-heal pctOwned for stored records: Pro Rata MUST be each lender's
  // funding amount divided by the TOTAL LOAN AMOUNT (not the sum of funded
  // amounts). Records persisted by older builds may have an incorrect
  // pctOwned (e.g. 100% for a single partial-funding lender); recompute and
  // re-persist whenever loanAmount is known and a drift is detected.
  const lastHealedRef = useRef<string>('');
  useEffect(() => {
    if (!fundingRecords.length) return;
    const principal = parseFloat(String(values['loan_terms.principal'] || '').replace(/[$,]/g, '')) || 0;
    const loanAmt = principal > 0
      ? principal
      : (parseFloat(String(loanAmount || '').replace(/[$,]/g, '')) || 0);
    if (loanAmt <= 0) return;
    let drift = false;
    const healed = fundingRecords.map((r) => {
      const fa = Number(r.originalAmount) || 0;
      if (fa <= 0) return r;
      const expected = parseFloat(((fa / loanAmt) * 100).toFixed(4));
      const current = Number(r.pctOwned) || 0;
      if (Math.abs(expected - current) > 0.0001) {
        drift = true;
        return { ...r, pctOwned: expected };
      }
      return r;
    });
    if (!drift) return;
    const json = JSON.stringify(healed);
    if (lastHealedRef.current === json) return;
    lastHealedRef.current = json;
    onValueChange(FIELD_KEYS.fundingRecords, json);
    void directPersistFundingField(dealId, FIELD_KEYS.fundingRecords, json, dictCacheRef.current);
  }, [fundingRecords, loanAmount, dealId, onValueChange]);

  // Auto-compute Pro Rata as the sum of pctOwned across all funding records.
  // No longer normalized to 100% — when the loan is partially funded the total
  // reflects the actual funded share (e.g. 81.20%).
  const computedProRataTotal = useMemo(() => {
    if (!fundingRecords.length) return '';
    const sum = fundingRecords.reduce(
      (acc, r) => acc.plus(new Decimal(Number(r.pctOwned) || 0)),
      new Decimal(0)
    );
    return sum.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(2);
  }, [fundingRecords]);

  // Persist the auto-filled Pro Rata into loan_terms.pro_rata whenever the
  // grid total changes. Uses the same direct-persist path as funding_records
  // so it cannot race with — or be overwritten by — a parent saveDraft() that
  // may be operating on a stale field_values snapshot (which would drop the
  // most recently added funding record).
  const lastPersistedProRataRef = useRef<string | null>(null);
  useEffect(() => {
    if (!computedProRataTotal) return;
    const current = values['loan_terms.pro_rata'] || '';
    if (current === computedProRataTotal) {
      lastPersistedProRataRef.current = computedProRataTotal;
      return;
    }
    if (lastPersistedProRataRef.current === computedProRataTotal) return;
    lastPersistedProRataRef.current = computedProRataTotal;
    onValueChange('loan_terms.pro_rata', computedProRataTotal);
    void directPersistFundingField(
      dealId,
      'loan_terms.pro_rata',
      computedProRataTotal,
      dictCacheRef.current,
    );
  }, [computedProRataTotal, values, onValueChange, dealId]);

  // Parse funding history from stored JSON value.
  // Fallback: if no stored history exists yet (e.g. legacy/in-progress deals where the
  // history field failed to persist), derive a read-only history view from the current
  // funding records so the Funding History grid is never empty when records exist.
  const historyRecords = useMemo(() => {
    const storedValue = values[FIELD_KEYS.fundingHistory];
    let parsed: any[] = [];
    if (storedValue) {
      try {
        parsed = JSON.parse(storedValue);
      } catch {
        parsed = [];
      }
    }

    // Build a lookup from current funding records to enrich any history rows
    // that are missing fundingDate / amountFunded / lender info (e.g. legacy
    // entries where those values were not captured at create time).
    const recordsValue = values[FIELD_KEYS.fundingRecords];
    let recs: any[] = [];
    if (recordsValue) {
      try {
        const r = JSON.parse(recordsValue);
        if (Array.isArray(r)) recs = r;
      } catch {
        recs = [];
      }
    }
    const recById = new Map<string, any>();
    const recByAccount = new Map<string, any>();
    recs.forEach((r) => {
      if (r?.id) recById.set(String(r.id), r);
      if (r?.lenderAccount) recByAccount.set(String(r.lenderAccount), r);
    });

    const toAmount = (v: any): number =>
      typeof v === 'number' ? v : parseFloat(String(v || '').replace(/[$,]/g, '')) || 0;

    const enrich = (h: any) => {
      const idStr = String(h?.id || '').replace(/^history-/, '');
      const match = recById.get(idStr) || recByAccount.get(String(h?.lenderAccount || ''));
      const fundingDate = h?.fundingDate || match?.fundingDate || '';
      const lenderAccount = h?.lenderAccount || match?.lenderAccount || '';
      const lenderName = h?.lenderName || match?.lenderName || '';
      const storedAmount = toAmount(h?.amountFunded);
      const amountFunded = storedAmount > 0
        ? storedAmount
        : toAmount(match?.originalAmount);
      return {
        ...h,
        fundingDate,
        lenderAccount,
        lenderName,
        amountFunded,
      };
    };

    if (storedValue) {
      return parsed.map(enrich);
    }

    // Derive from funding records as a fallback only when no history field exists (no DB writes here)
    if (!recs.length) return [];
    return recs.map((r) => ({
      id: `history-${r.id || r.lenderAccount || Math.random()}`,
      fundingDate: r.fundingDate || '',
      reference: `REF-${r.id || ''}`,
      lenderAccount: r.lenderAccount || '',
      lenderName: r.lenderName || '',
      amountFunded: toAmount(r.originalAmount),
    }));
  }, [values]);

  // Parse funding adjustments from stored JSON value
  const fundingAdjustments: FundingAdjustmentData[] = useMemo(() => {
    const storedValue = values[FIELD_KEYS.fundingAdjustments];
    if (storedValue) {
      try {
        return JSON.parse(storedValue);
      } catch {
        return [];
      }
    }
    return [];
  }, [values]);

  // ── Fallback hydration: load funding data directly from DB if values are empty ──
  useEffect(() => {
    if (hydrationAttemptedRef.current) return;
    if (!dealId) return;
    if (values[FIELD_KEYS.fundingRecords] || values[FIELD_KEYS.fundingHistory] || values[FIELD_KEYS.fundingAdjustments]) {
      hydrationAttemptedRef.current = true;
      return;
    }

    hydrationAttemptedRef.current = true;

    const hydrate = async () => {
      try {
        const recId = await resolveFieldDictId(FIELD_KEYS.fundingRecords, dictCacheRef.current);
        const histId = await resolveFieldDictId(FIELD_KEYS.fundingHistory, dictCacheRef.current);
        const adjId = await resolveFieldDictId(FIELD_KEYS.fundingAdjustments, dictCacheRef.current);
        if (!recId && !histId && !adjId) return;

        const { data: sectionRows, error } = await supabase
          .from('deal_section_values')
          .select('field_values')
          .eq('deal_id', dealId)
          .eq('section', 'loan_terms');

        if (error || !sectionRows?.length) return;

        for (const sv of sectionRows) {
          const fv = (sv.field_values as Record<string, any>) || {};
          if (recId && fv[recId]) {
            const val = fv[recId].value_text;
            if (val) onValueChange(FIELD_KEYS.fundingRecords, val);
          }
          if (histId && fv[histId]) {
            const val = fv[histId].value_text;
            if (val) onValueChange(FIELD_KEYS.fundingHistory, val);
          }
          if (adjId && fv[adjId]) {
            const val = fv[adjId].value_text;
            if (val) onValueChange(FIELD_KEYS.fundingAdjustments, val);
          }
        }
      } catch (err) {
        console.error('[LoanTermsFundingForm] Fallback hydration failed:', err);
      }
    };

    hydrate();
  }, [dealId, values, onValueChange]);

  // Calculate total pages
  const totalPages = Math.max(1, Math.ceil(fundingRecords.length / pageSize));

  // Get paginated records
  const paginatedRecords = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return fundingRecords.slice(startIndex, startIndex + pageSize);
  }, [fundingRecords, currentPage, pageSize]);

  const handleAddFunding = useCallback(async (data: FundingFormData) => {
    // Effective saved lender rate uses override value when override is checked.
    const soldRateVal = (data.rateSoldValue || '').trim();
    const hasSoldRate = soldRateVal !== '' && !isNaN(parseFloat(soldRateVal)) && parseFloat(soldRateVal) > 0;
    const noteRateVal = (data.rateNoteValue || data.noteRateDisplay || noteRate || '').trim();
    const modalLenderRate = parseFloat((data.lenderRate || '').toString().replace(/[%,]/g, '')) || 0;
    let lenderRate = 0;
    if (data.lenderRateOverride) lenderRate = parseFloat(data.lenderRateOverrideValue || '') || 0;
    else if (modalLenderRate > 0) lenderRate = modalLenderRate;
    else if (hasSoldRate) lenderRate = parseFloat(soldRateVal) || 0;
    else if (data.rateSelection === 'note_rate') lenderRate = parseFloat(data.rateNoteValue) || 0;
    else if (data.rateSelection === 'sold_rate') lenderRate = parseFloat(data.rateSoldValue) || 0;
    else if (data.rateSelection === 'lender_rate') lenderRate = parseFloat(data.rateLenderValue) || 0;
    // Final fallback: Note Rate (when Sold Rate is not configured and nothing else resolved)
    if (!lenderRate || lenderRate <= 0) {
      const nrNum = parseFloat(noteRateVal.replace(/[%,]/g, '')) || 0;
      if (nrNum > 0) lenderRate = nrNum;
    }

    const newRecord: FundingRecord = {
      id: `funding-${Date.now()}`,
      fundingDate: data.fundingDate || '',
      lenderAccount: data.lenderId || '',
      lenderName: data.lenderFullName || '',
      lenderEmail: data.lenderEmail || '',
      lenderPhone: data.lenderPhone || '',
      pctOwned: safeParseFloat(data.percentOwned),
      lenderRate,
      principalBalance: safeParseFloat(data.principalBalance || data.fundingAmount),
      originalAmount: safeParseFloat(data.fundingAmount),
      baseFee: data.baseFee !== undefined && data.baseFee !== '' ? safeParseFloat(data.baseFee) : undefined,
      currentBalance: data.currentBalance !== undefined && data.currentBalance !== ''
        ? safeParseFloat(data.currentBalance)
        : safeParseFloat(data.fundingAmount),
      regularPayment: safeParseFloat(data.regularPayment),
      lenderShare: safeParseFloat(data.lenderShare),
      roundingError: false,
      rateSelection: data.rateSelection,
      rateNoteValue: data.rateNoteValue,
      rateSoldValue: data.rateSoldValue,
      rateLenderValue: data.rateLenderValue,
      lenderRateOverride: data.lenderRateOverride,
      lenderRateOverrideValue: data.lenderRateOverrideValue,
      lenderRateOverrideOriginal: data.lenderRateOverrideOriginal,
      lenderRateOverrideReason: data.lenderRateOverrideReason,
      lenderRateOverrideBy: data.lenderRateOverrideBy,
      lenderRateOverrideAt: data.lenderRateOverrideAt,
      brokerParticipates: data.brokerParticipates,
      interestFrom: data.interestFrom,
      roundingAdjustment: data.roundingAdjustment,
      disbursements: data.disbursements,
      payments: data.payments,
      noteRateDisplay: data.noteRateDisplay,
      // Fees to Company
      overrideServicing: data.overrideServicing,
      companyBaseFee: data.companyBaseFee, companyBaseFeePct: data.companyBaseFeePct,
      companyAdditionalServices: data.companyAdditionalServices,
      companyMinimum: data.companyMinimum, companyMaximum: data.companyMaximum,
      companyNrSitSplitPct: data.companyNrSitSplitPct, companyNrSitSplit: data.companyNrSitSplit,
      companyTotal: data.companyTotal,
      // Fees to Vendor
      vendorId: data.vendorId, vendorName: data.vendorName,
      vendorBaseFee: data.vendorBaseFee, vendorBaseFeePct: data.vendorBaseFeePct,
      vendorAdditionalServices: data.vendorAdditionalServices,
      vendorMinimum: data.vendorMinimum, vendorMaximum: data.vendorMaximum,
      vendorNrSitSplitPct: data.vendorNrSitSplitPct, vendorNrSitSplit: data.vendorNrSitSplit,
      vendorTotal: data.vendorTotal,
      // Legacy servicing fees
      overrideServicingFees: data.overrideServicingFees,
      companyServicingFee: data.companyServicingFee, companyServicingFeePct: data.companyServicingFeePct,
      companyMaxFee: data.companyMaxFee, companyMaxFeePct: data.companyMaxFeePct,
      companyMinFee: data.companyMinFee, companyMinFeePct: data.companyMinFeePct,
      brokerServicingFee: data.brokerServicingFee, brokerServicingFeePct: data.brokerServicingFeePct,
      brokerMaxFee: data.brokerMaxFee, brokerMaxFeePct: data.brokerMaxFeePct,
      brokerMinFee: data.brokerMinFee, brokerMinFeePct: data.brokerMinFeePct,
      overrideDefaultFees: data.overrideDefaultFees,
      lateFee1Lender: data.lateFee1Lender, lateFee1Company: data.lateFee1Company, lateFee1Broker: data.lateFee1Broker, lateFee1Total: data.lateFee1Total, lateFee1Maximum: data.lateFee1Maximum,
      lateFee2Lender: data.lateFee2Lender, lateFee2Company: data.lateFee2Company, lateFee2Broker: data.lateFee2Broker, lateFee2Total: data.lateFee2Total, lateFee2Maximum: data.lateFee2Maximum,
      defaultInterestLender: data.defaultInterestLender, defaultInterestCompany: data.defaultInterestCompany, defaultInterestBroker: data.defaultInterestBroker, defaultInterestTotal: data.defaultInterestTotal, defaultInterestMaximum: data.defaultInterestMaximum,
      interestGuaranteeLender: data.interestGuaranteeLender, interestGuaranteeCompany: data.interestGuaranteeCompany, interestGuaranteeBroker: data.interestGuaranteeBroker, interestGuaranteeTotal: data.interestGuaranteeTotal, interestGuaranteeMaximum: data.interestGuaranteeMaximum,
      prepaymentLender: data.prepaymentLender, prepaymentCompany: data.prepaymentCompany, prepaymentBroker: data.prepaymentBroker, prepaymentTotal: data.prepaymentTotal, prepaymentMaximum: data.prepaymentMaximum,
      maturityLender: data.maturityLender, maturityCompany: data.maturityCompany, maturityBroker: data.maturityBroker, maturityTotal: data.maturityTotal, maturityMaximum: data.maturityMaximum,
    };

    // Mutual exclusivity for Rounding Adjustment: only ONE lender can hold it.
    // If the new record enables it, atomically clear it on every existing record in the same write.
    // Mutual exclusivity for Rounding Adjustment: only ONE lender can hold it.
    // If the new record enables it, atomically clear it on every existing record in the same write.
    const baseRecords = newRecord.roundingAdjustment
      ? fundingRecords.map((r) => (r.roundingAdjustment ? { ...r, roundingAdjustment: false } : r))
      : fundingRecords;
    const updatedRecords = recomputeLenderPayments([...baseRecords, newRecord], loanPrincipalBalance, totalPayment, noteRate);
    const updatedRecordsJson = JSON.stringify(updatedRecords);
    onValueChange(FIELD_KEYS.fundingRecords, updatedRecordsJson);
    // Ensure newly added record is visible by jumping to the page that contains it.
    setCurrentPage(Math.max(1, Math.ceil(updatedRecords.length / pageSize)));

    // Build updated history
    const historyValue = values[FIELD_KEYS.fundingHistory];
    let history: any[] = [];
    try {
      history = historyValue ? JSON.parse(historyValue) : [];
    } catch {
      history = [];
    }
    history.push({
      id: `history-${newRecord.id}`,
      fundingDate: data.fundingDate,
      reference: `REF-${newRecord.id}`,
      lenderAccount: data.lenderId,
      lenderName: data.lenderFullName,
      amountFunded: safeParseFloat(data.fundingAmount),
    });
    const updatedHistoryJson = JSON.stringify(history);
    onValueChange(FIELD_KEYS.fundingHistory, updatedHistoryJson);

    // Direct-persist both fields to DB
    await Promise.all([
      directPersistFundingField(dealId, FIELD_KEYS.fundingRecords, updatedRecordsJson, dictCacheRef.current),
      directPersistFundingField(dealId, FIELD_KEYS.fundingHistory, updatedHistoryJson, dictCacheRef.current),
    ]);

    // Auto-add lender to deal_participants if not already present
    if (data.lenderFullName) {
      try {
        const { data: existing } = await supabase
          .from('deal_participants')
          .select('id')
          .eq('deal_id', dealId)
          .eq('role', 'lender')
          .eq('name', data.lenderFullName)
          .maybeSingle();

        if (!existing) {
          // Look up contact for email/phone/contact_id
          let contactId: string | null = null;
          let email: string | null = null;
          let phone: string | null = null;

          if (data.lenderId) {
            const { data: contact } = await supabase
              .from('contacts')
              .select('id, email, phone')
              .eq('contact_id', data.lenderId)
              .maybeSingle();
            if (contact) {
              contactId = contact.id;
              email = contact.email;
              phone = contact.phone;
            }
          }

          await supabase.from('deal_participants').insert({
            deal_id: dealId,
            role: 'lender' as any,
            name: data.lenderFullName,
            email,
            phone,
            contact_id: contactId,
            status: 'invited',
            access_method: 'login',
          });
        }
      } catch (err) {
        console.error('[LoanTermsFundingForm] Auto-add lender participant failed:', err);
      }
    }
  }, [fundingRecords, values, onValueChange, dealId]);

  const handleUpdateRecord = useCallback(async (id: string, updates: Partial<FundingRecord>) => {
    // Mutual exclusivity for Rounding Adjustment: only ONE lender can hold it.
    // When this update sets roundingAdjustment=true, atomically clear it on every other record in the same write.
    const enablingRounding = updates.roundingAdjustment === true;
    const updatedRecords = recomputeLenderPayments(fundingRecords.map((record) => {
      if (record.id === id) return { ...record, ...updates };
      if (enablingRounding && record.roundingAdjustment) return { ...record, roundingAdjustment: false };
      return record;
    }), loanPrincipalBalance, totalPayment, noteRate);
    const updatedRecordsJson = JSON.stringify(updatedRecords);
    onValueChange(FIELD_KEYS.fundingRecords, updatedRecordsJson);

    // Mirror edits into Funding History so the history grid auto-updates
    const updatedRecord = updatedRecords.find((r) => r.id === id);
    const historyValue = values[FIELD_KEYS.fundingHistory];
    let history: any[] = [];
    try {
      history = historyValue ? JSON.parse(historyValue) : [];
    } catch {
      history = [];
    }
    let updatedHistoryJson: string | null = null;
    if (Array.isArray(history) && updatedRecord) {
      const historyId = `history-${id}`;
      const idx = history.findIndex((h: any) => h?.id === historyId);
      const patch = {
        fundingDate: updatedRecord.fundingDate || '',
        lenderAccount: updatedRecord.lenderAccount || '',
        lenderName: updatedRecord.lenderName || '',
        amountFunded: typeof updatedRecord.originalAmount === 'number'
          ? updatedRecord.originalAmount
          : parseFloat(String(updatedRecord.originalAmount || '').replace(/[$,]/g, '')) || 0,
      };
      if (idx >= 0) {
        history[idx] = { ...history[idx], ...patch };
      } else {
        history.push({ id: historyId, reference: `REF-${id}`, ...patch });
      }
      updatedHistoryJson = JSON.stringify(history);
      onValueChange(FIELD_KEYS.fundingHistory, updatedHistoryJson);
    }

    // Direct-persist to DB
    await Promise.all([
      directPersistFundingField(dealId, FIELD_KEYS.fundingRecords, updatedRecordsJson, dictCacheRef.current),
      updatedHistoryJson
        ? directPersistFundingField(dealId, FIELD_KEYS.fundingHistory, updatedHistoryJson, dictCacheRef.current)
        : Promise.resolve(),
    ]);
  }, [fundingRecords, values, onValueChange, dealId]);

  const handleDeleteHistoryRecord = useCallback(async (record: { id: string }) => {
    const current = historyRecords.filter((r: any) => r.id !== record.id);
    const json = JSON.stringify(current);
    onValueChange(FIELD_KEYS.fundingHistory, json);
    try {
      await directPersistFundingField(dealId, FIELD_KEYS.fundingHistory, json, dictCacheRef.current);
      toast.success('Funding history record deleted');
    } catch (err) {
      console.error('[LoanTermsFundingForm] Delete history record failed:', err);
      toast.error('Failed to delete funding history record');
    }
  }, [historyRecords, onValueChange, dealId]);

  const handleDeleteRecord = async (record: FundingRecord) => {
    const updatedRecords = fundingRecords.filter((r) => r.id !== record.id);
    onValueChange(FIELD_KEYS.fundingRecords, JSON.stringify(updatedRecords));

    // Clear any sessionStorage drafts associated with this loan so that
    // re-opening the Add Funding modal — for a brand-new lender or for the
    // just-deleted lender's id — never restores stale funding amounts.
    try {
      const prefix = 'addFundingDraft:';
      const keysToClear: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(prefix)) keysToClear.push(k);
      }
      keysToClear.forEach((k) => sessionStorage.removeItem(k));
    } catch { /* ignore */ }


    // Mirror deletion into Funding History so the history grid auto-updates
    const historyValue = values[FIELD_KEYS.fundingHistory];
    let history: any[] = [];
    try {
      history = historyValue ? JSON.parse(historyValue) : [];
    } catch {
      history = [];
    }
    if (Array.isArray(history) && history.length > 0) {
      const historyId = `history-${record.id}`;
      const updatedHistory = history.filter((h: any) => h?.id !== historyId);
      const updatedHistoryJson = JSON.stringify(updatedHistory);
      onValueChange(FIELD_KEYS.fundingHistory, updatedHistoryJson);
      try {
        await directPersistFundingField(dealId, FIELD_KEYS.fundingHistory, updatedHistoryJson, dictCacheRef.current);
      } catch (err) {
        console.error('[LoanTermsFundingForm] Mirror history delete failed:', err);
      }
    }

    try {
      const fieldDictId = await resolveFieldDictId(FIELD_KEYS.fundingRecords, dictCacheRef.current);
      if (!fieldDictId) throw new Error('Field dictionary entry not found for funding_records');

      const { data: sectionRows, error: fetchError } = await supabase
        .from('deal_section_values')
        .select('id, field_values, version')
        .eq('deal_id', dealId)
        .eq('section', 'loan_terms');

      if (fetchError) throw fetchError;

      for (const sv of (sectionRows || [])) {
        const fieldValues = (sv.field_values as Record<string, any>) || {};

        if (fieldValues[fieldDictId]) {
          fieldValues[fieldDictId] = {
            ...fieldValues[fieldDictId],
            value_text: JSON.stringify(updatedRecords),
            updated_at: new Date().toISOString(),
          };

          await supabase
            .from('deal_section_values')
            .update({
              field_values: JSON.parse(JSON.stringify(fieldValues)),
              updated_at: new Date().toISOString(),
              version: (sv.version || 0) + 1,
            })
            .eq('id', sv.id);

          toast.success('Funding record deleted successfully');
          return;
        }
      }

      if (saveDraft) {
        const success = await saveDraft();
        if (success) {
          toast.success('Funding record deleted successfully');
        }
      }
    } catch (err) {
      console.error('Error persisting funding deletion:', err);
      if (saveDraft) {
        const success = await saveDraft();
        if (success) {
          toast.success('Funding record deleted successfully');
        }
      }
    }
  };

  const handleSaveAdjustment = useCallback(async (adjustment: FundingAdjustmentData) => {
    // Upsert: replace if same id exists, else append
    const existing = fundingAdjustments.filter((a) => a.id !== adjustment.id);
    const updated = [...existing, adjustment];
    const json = JSON.stringify(updated);
    onValueChange(FIELD_KEYS.fundingAdjustments, json);

    await directPersistFundingField(dealId, FIELD_KEYS.fundingAdjustments, json, dictCacheRef.current);
    toast.success('Funding adjustment saved');
  }, [fundingAdjustments, onValueChange, dealId]);

  const handleLoanNumberChange = useCallback((value: string) => {
    loanNumberEdited.current = true;
    setLocalLoanNumber(value);
    onValueChange('Terms.LoanNumber', value);
  }, [onValueChange]);

  const handleBorrowerNameChange = useCallback((value: string) => {
    borrowerNameEdited.current = true;
    setLocalBorrowerName(value);
    onValueChange('loan_terms.details_borrower_name', value);
  }, [onValueChange]);

  const handleHeaderFieldBlur = useCallback(() => {
    window.setTimeout(() => {
      void saveDraft?.();
    }, 0);
  }, [saveDraft]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  return (
    <LoanFundingGrid
      dealId={dealId}
      loanNumber={loanNumber}
      borrowerName={borrowerName}
      fundingRecords={paginatedRecords}
      totalRecordCount={fundingRecords.length}
      historyRecords={historyRecords}
      onAddFunding={handleAddFunding}
      onDeleteRecord={handleDeleteRecord}
      onUpdateRecord={handleUpdateRecord}
      onRefresh={onRefresh}
      isLoading={isLoading}
      disabled={disabled}
      currentPage={currentPage}
      totalPages={totalPages}
      pageSize={pageSize}
      onPageChange={handlePageChange}
      onPageSizeChange={handlePageSizeChange}
      noteRate={noteRate}
      soldRate={soldRate}
      totalPayment={totalPayment}
      loanAmount={loanAmount}
      loanPrincipalBalance={loanPrincipalBalance}
      remainingPayments={remainingPayments}
      onLoanNumberChange={handleLoanNumberChange}
      onBorrowerNameChange={handleBorrowerNameChange}
      onHeaderFieldBlur={handleHeaderFieldBlur}
      proRata={computedProRataTotal || values['loan_terms.pro_rata'] || ''}
      onProRataChange={(v) => onValueChange('loan_terms.pro_rata', v)}
      fundingAdjustments={fundingAdjustments}
      onSaveAdjustment={handleSaveAdjustment}
      onDeleteHistoryRecord={handleDeleteHistoryRecord}
    />
  );
};

export default LoanTermsFundingForm;
