import React, { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { sanitizeInterestInput, normalizeInterestOnBlur } from '@/lib/interestValidation';
import { formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';
import { computeBorrowerScheduledPayment } from '@/lib/borrowerPaymentFormula';

const FK = {
  proposed_loan_amount: 'origination_fees.re885_proposed_loan_amount',
  initial_fees_page1: 'origination_fees.re885_initial_fees_page1',
  other_obligations: 'origination_fees.re885_other_obligations',
  credit_life_insurance: 'origination_fees.re885_credit_life_insurance',
  additional_obligation_1: 'origination_fees.re885_additional_obligation_1',
  additional_obligation_2: 'origination_fees.re885_additional_obligation_2',
  // Editable line-number (left-side) inputs for each deduction row
  initial_fees_page1_lineno: 'origination_fees.re885_initial_fees_page1_lineno',
  credit_life_insurance_lineno: 'origination_fees.re885_credit_life_insurance_lineno',
  other_obligations_lineno: 'origination_fees.re885_other_obligations_lineno',
  additional_obligation_1_lineno: 'origination_fees.re885_additional_obligation_1_lineno',
  additional_obligation_2_lineno: 'origination_fees.re885_additional_obligation_2_lineno',
  liens_payoff_lineno: 'origination_fees.re885_liens_payoff_lineno',
  // Manual overrides for the three computed-display rows (Initial Fees,
  // Existing Liens, Subtotal). When non-empty, the typed value wins; the
  // small "×" button clears it and reverts to the auto value.
  initial_fees_page1_override: 'origination_fees.re885_initial_fees_page1_override',
  liens_payoff_override: 'origination_fees.re885_liens_payoff_override',
  subtotal_deductions_override: 'origination_fees.re885_subtotal_deductions_override',
  subtotal_deductions: 'origination_fees.re885_subtotal_deductions',
  cash_at_closing_option: 'origination_fees.re885_cash_at_closing_option',
  cash_at_closing_amount: 'origination_fees.re885_cash_at_closing_amount',
  // Manual override: when non-empty, used instead of computed cashAtClosing.
  cash_at_closing_override: 'origination_fees.re885_cash_at_closing_override',
  cash_payable_to_you: 'origination_fees.re885_cash_payable_to_you',
  cash_you_must_pay: 'origination_fees.re885_cash_you_must_pay',
  loan_term_value: 'origination_fees.re885_loan_term_value',
  loan_term_unit: 'origination_fees.re885_loan_term_unit',
  interest_rate: 'origination_fees.re885_interest_rate',
  rate_type_fixed: 'origination_fees.re885_rate_type_fixed',
  rate_type_adjustable: 'origination_fees.re885_rate_type_adjustable',
  iv_adj_rate_months: 'origination_fees.re885_iv_adj_rate_months',
  v_fully_indexed_rate: 'origination_fees.re885_v_fully_indexed_rate',
  vi_max_interest_rate: 'origination_fees.re885_vi_max_interest_rate',
  vii_payment_amount: 'origination_fees.re885_vii_payment_amount',
  viii_rate_increase_pct: 'origination_fees.re885_viii_rate_increase_pct',
  viii_rate_increase_months: 'origination_fees.re885_viii_rate_increase_months',
  ix_payment_end_months: 'origination_fees.re885_ix_payment_end_months',
  ix_payment_end_pct: 'origination_fees.re885_ix_payment_end_pct',
  // Section X – Balloon Payment
  x_balloon_has: 'origination_fees.re885_x_balloon_has',
  x_balloon_amount: 'origination_fees.re885_x_balloon_amount',
  x_balloon_due_months: 'origination_fees.re885_x_balloon_due_months',
  xi_neg_amort_balance: 'origination_fees.re885_xi_neg_amort_balance',
  impound_county_taxes: 'origination_fees.re885_impound_county_taxes',
  impound_hazard_ins: 'origination_fees.re885_impound_hazard_ins',
  impound_mortgage_ins: 'origination_fees.re885_impound_mortgage_ins',
  impound_flood_ins: 'origination_fees.re885_impound_flood_ins',
  impound_other: 'origination_fees.re885_impound_other',
  impound_other_desc: 'origination_fees.re885_impound_other_desc',
  impound_approx_amount: 'origination_fees.re885_impound_approx_amount',
  // Section XVII – Prepayment Penalty (seeded from Loan → Article 7)
  xvii_prepay_has: 'origination_fees.re885_xvii_prepay_has',
  xvii_prepay_amount: 'origination_fees.re885_xvii_prepay_amount',
  xvii_prepay_term_months: 'origination_fees.re885_xvii_prepay_term_months',
  xvii_prepay_pct: 'origination_fees.re885_xvii_prepay_pct',
  // Section XVIII – Documentation Type (seeded from Loan → Limited/No Doc)
  xviii_doc_type: 'origination_fees.re885_xviii_doc_type',
  xviii_doc_type_other: 'origination_fees.re885_xviii_doc_type_other',
};

const DOC_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'full', label: 'Full Documentation' },
  { value: 'limited', label: 'Limited Documentation' },
  { value: 'none', label: 'No Documentation' },
  { value: 'stated_income', label: 'Stated Income' },
  { value: 'sisa', label: 'SISA (Stated Income / Stated Assets)' },
  { value: 'nina', label: 'NINA (No Income / No Assets)' },
  { value: 'other', label: 'Other' },
];

interface RE885Props {
  getValue: (key: string) => string;
  setValue: (key: string, value: string) => void;
  getBoolValue: (key: string) => boolean;
  setBoolValue: (key: string, value: boolean) => void;
  parseNumber: (val: string) => number;
  disabled: boolean;
  upstreamLoanAmount?: number;
  upstreamInterestRate?: number;
  upstreamLoanTermValue?: string;
  upstreamLoanTermUnit?: string;
  /** Loan tab → Rate Structure (e.g. 'frm_fixed_rate' | 'arm_adjustable_rate' | 'gtm_graduated_terms') */
  upstreamRateStructure?: string;
  /** Loan tab → Loan Type → Variable / ARM checkbox */
  upstreamVariableArm?: boolean;
  /** Loan tab → Current Rate (Section V — Fully Indexed fallback when adj rate is unset) */
  upstreamCurrentRate?: number;
  /** Loan tab → Regular P&I (legacy — kept only to detect divergence). */
  upstreamRegularPI?: number;
  /** Loan tab → Amortization method (drives Section VII formula). */
  upstreamAmortization?: string;
  /** Loan tab → Payment Frequency (drives Section VII period count). */
  upstreamPaymentFrequency?: string;
  /** Loan tab → Loan Type → Balloon Payment + Estimated Balloon */
  upstreamBalloonEnabled?: boolean;
  upstreamBalloonAmount?: number;
  /** Loan tab → Adjustable / Graduated Loan Details — single source of truth for Sections IV–IX. */
  upstreamAdjInitialRateMonths?: string;
  upstreamAdjFullyIndexedRate?: number;
  upstreamAdjMaxInterestRate?: number;
  upstreamAdjRateIncreasePercent?: number;
  upstreamAdjRateIncreaseMonths?: string;
  upstreamAdjPaymentOptionsEndMonths?: string;
  upstreamAdjPaymentOptionsEndPercent?: number;
  section800Total?: number;
  liensPayoffTotal?: number;
  loanDocFeeTotal?: number;
  // Loan tab → Article 7 (Pre-payment Penalty)
  upstreamPrepayEnabled?: boolean;
  upstreamPrepayPenaltyMonths?: string;
  upstreamPrepayGreaterThanPct?: string;
  upstreamPrepayFirstYears?: string;
  // Loan tab → Limited / No Documentation
  upstreamLimitedNoDoc?: boolean;
}

const CurrencyInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
}> = ({ value, onChange, disabled, readOnly, className = '' }) => (
  <div className="relative">
    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">$</span>
    <Input
      inputMode="decimal"
      value={value}
      onChange={(e) => {
        const v = e.target.value.replace(/[^0-9.]/g, '');
        onChange(v);
      }}
      onBlur={() => { if (!readOnly && value) { const formatted = formatCurrencyDisplay(value); if (formatted) onChange(formatted); } }}
      onFocus={() => { if (!readOnly && value) { onChange(unformatCurrencyDisplay(value)); } }}
      disabled={disabled}
      readOnly={readOnly}
      placeholder="0.00"
      className={`h-8 text-xs text-right pl-5 ${readOnly ? 'bg-muted/50' : ''} ${className}`}
    />
  </div>
);

export const RE885ProposedLoanTerms: React.FC<RE885Props> = ({
  getValue,
  setValue,
  getBoolValue,
  setBoolValue,
  parseNumber,
  disabled,
  upstreamLoanAmount = 0,
  upstreamInterestRate = 0,
  upstreamLoanTermValue = '',
  upstreamLoanTermUnit = '',
  upstreamRateStructure = '',
  upstreamVariableArm = false,
  upstreamCurrentRate = 0,
  upstreamRegularPI = 0,
  upstreamAmortization = '',
  upstreamPaymentFrequency = '',
  upstreamBalloonEnabled = false,
  upstreamBalloonAmount = 0,
  upstreamAdjInitialRateMonths = '',
  upstreamAdjFullyIndexedRate = 0,
  upstreamAdjMaxInterestRate = 0,
  upstreamAdjRateIncreasePercent = 0,
  upstreamAdjRateIncreaseMonths = '',
  upstreamAdjPaymentOptionsEndMonths = '',
  upstreamAdjPaymentOptionsEndPercent = 0,
  section800Total = 0,
  liensPayoffTotal = 0,
  loanDocFeeTotal = 0,
  upstreamPrepayEnabled = false,
  upstreamPrepayPenaltyMonths = '',
  upstreamPrepayGreaterThanPct = '',
  upstreamPrepayFirstYears = '',
  upstreamLimitedNoDoc = false,
}) => {
  const isFixed = getBoolValue(FK.rate_type_fixed);
  const isAdjustable = getBoolValue(FK.rate_type_adjustable);
  // Sections IV–IX remain editable regardless of rate type so the user can
  // override the auto-seeded values (or fill them in even on a fixed loan).
  const adjustableSectionsDisabled = disabled;

  // Treat "", "0", "0.00", "$0.00" all as "empty" so re-seeding works after first render
  const isEmptyOrZero = (raw: string): boolean => {
    if (!raw) return true;
    const n = parseNumber(raw);
    return !Number.isFinite(n) || n === 0;
  };

  // ─── Seed Proposed Loan Amount from Loan tab if empty/zero
  React.useEffect(() => {
    if (upstreamLoanAmount > 0 && isEmptyOrZero(getValue(FK.proposed_loan_amount))) {
      setValue(FK.proposed_loan_amount, formatCurrencyDisplay(upstreamLoanAmount.toFixed(2)));
    }
  }, [upstreamLoanAmount]);

  // ─── Seed Interest Rate from Loan tab if empty/zero
  React.useEffect(() => {
    if (upstreamInterestRate > 0 && isEmptyOrZero(getValue(FK.interest_rate))) {
      setValue(FK.interest_rate, upstreamInterestRate.toFixed(4));
    }
  }, [upstreamInterestRate]);

  // ─── Seed Loan Term value + unit from Loan tab if empty/zero
  React.useEffect(() => {
    if (upstreamLoanTermValue && isEmptyOrZero(getValue(FK.loan_term_value))) {
      setValue(FK.loan_term_value, String(upstreamLoanTermValue));
    }
  }, [upstreamLoanTermValue]);
  React.useEffect(() => {
    if (upstreamLoanTermUnit && !getValue(FK.loan_term_unit)) {
      setValue(FK.loan_term_unit, upstreamLoanTermUnit);
    }
  }, [upstreamLoanTermUnit]);

  // ─── Seed Section III rate type (Fixed / Adjustable) from Loan → Rate Structure
  // or Loan → Loan Type → Variable/ARM. CA DRE requires exactly one selection — when
  // rate structure is unknown, default to Fixed. When the loan flips structure, force
  // the matching selection so stale choices cannot persist.
  React.useEffect(() => {
    const adjustable =
      upstreamVariableArm ||
      upstreamRateStructure === 'arm_adjustable_rate' ||
      upstreamRateStructure === 'gtm_graduated_terms';
    const fixed =
      !adjustable &&
      (upstreamRateStructure === 'frm_fixed_rate' ||
        !upstreamRateStructure); // default to Fixed when unknown
    const wantFixed = fixed;
    const wantAdjustable = adjustable;
    if (wantFixed && (!getBoolValue(FK.rate_type_fixed) || getBoolValue(FK.rate_type_adjustable))) {
      setBoolValue(FK.rate_type_fixed, true);
      setBoolValue(FK.rate_type_adjustable, false);
    } else if (wantAdjustable && (!getBoolValue(FK.rate_type_adjustable) || getBoolValue(FK.rate_type_fixed))) {
      setBoolValue(FK.rate_type_adjustable, true);
      setBoolValue(FK.rate_type_fixed, false);
    }
  }, [upstreamRateStructure, upstreamVariableArm]);

  // ─── Seed Sections IV–IX from the loan's Adjustable / Graduated Loan Details when the
  // loan is Adjustable. Seed-if-empty pattern so user edits to the RE 885
  // fields are never overwritten by upstream loan values. Fields stay editable
  // for every rate type — no clearing when isFixed.
  // Note: V (Fully Indexed Rate) falls back to Loan → Current Rate when adj field is unset.
  React.useEffect(() => {
    if (isFixed) return;
    // IV — Initial Adjustable Rate in effect for (months)
    if (upstreamAdjInitialRateMonths && isEmptyOrZero(getValue(FK.iv_adj_rate_months))) {
      setValue(FK.iv_adj_rate_months, String(upstreamAdjInitialRateMonths));
    }
    // V — Fully Indexed Rate
    const fullyIndexed = upstreamAdjFullyIndexedRate > 0 ? upstreamAdjFullyIndexedRate : upstreamCurrentRate;
    if (fullyIndexed > 0 && isEmptyOrZero(getValue(FK.v_fully_indexed_rate))) {
      setValue(FK.v_fully_indexed_rate, fullyIndexed.toFixed(4));
    }
    // VI — Maximum Interest Rate
    if (upstreamAdjMaxInterestRate > 0 && isEmptyOrZero(getValue(FK.vi_max_interest_rate))) {
      setValue(FK.vi_max_interest_rate, upstreamAdjMaxInterestRate.toFixed(4));
    }
    // VIII — Rate increase % and frequency in months
    if (upstreamAdjRateIncreasePercent > 0 && isEmptyOrZero(getValue(FK.viii_rate_increase_pct))) {
      setValue(FK.viii_rate_increase_pct, upstreamAdjRateIncreasePercent.toFixed(4));
    }
    if (upstreamAdjRateIncreaseMonths && isEmptyOrZero(getValue(FK.viii_rate_increase_months))) {
      setValue(FK.viii_rate_increase_months, String(upstreamAdjRateIncreaseMonths));
    }
    // IX — Payment Options end after months / % of original balance
    if (upstreamAdjPaymentOptionsEndMonths && isEmptyOrZero(getValue(FK.ix_payment_end_months))) {
      setValue(FK.ix_payment_end_months, String(upstreamAdjPaymentOptionsEndMonths));
    }
    if (upstreamAdjPaymentOptionsEndPercent > 0 && isEmptyOrZero(getValue(FK.ix_payment_end_pct))) {
      setValue(FK.ix_payment_end_pct, upstreamAdjPaymentOptionsEndPercent.toFixed(4));
    }
  }, [
    isFixed,
    upstreamAdjInitialRateMonths,
    upstreamAdjFullyIndexedRate,
    upstreamCurrentRate,
    upstreamAdjMaxInterestRate,
    upstreamAdjRateIncreasePercent,
    upstreamAdjRateIncreaseMonths,
    upstreamAdjPaymentOptionsEndMonths,
    upstreamAdjPaymentOptionsEndPercent,
  ]);



  // ─── Seed Section X Balloon from Loan → Loan Type → Balloon Payment
  React.useEffect(() => {
    // Only seed when user hasn't touched it (both flag and amount untouched).
    const hasFlag = getValue(FK.x_balloon_has);
    if (hasFlag === '' && isEmptyOrZero(getValue(FK.x_balloon_amount))) {
      setBoolValue(FK.x_balloon_has, !!upstreamBalloonEnabled);
      if (upstreamBalloonEnabled && upstreamBalloonAmount > 0) {
        setValue(FK.x_balloon_amount, formatCurrencyDisplay(upstreamBalloonAmount.toFixed(2)));
      }
    }
  }, [upstreamBalloonEnabled, upstreamBalloonAmount]);

  // ─── Seed Section XVII (Prepayment Penalty) from Loan → Article 7 (only if untouched)
  // Per spec: penalty term in months = first_years × 12; falls back to penalty_months when years absent.
  React.useEffect(() => {
    if (getValue(FK.xvii_prepay_has) === '' && getValue(FK.xvii_prepay_amount) === '' &&
        getValue(FK.xvii_prepay_term_months) === '' && getValue(FK.xvii_prepay_pct) === '') {
      setBoolValue(FK.xvii_prepay_has, upstreamPrepayEnabled);
      if (upstreamPrepayEnabled) {
        const years = parseNumber(upstreamPrepayFirstYears);
        const months = years > 0 ? years * 12 : parseNumber(upstreamPrepayPenaltyMonths);
        if (months > 0) setValue(FK.xvii_prepay_term_months, String(months));
        if (upstreamPrepayGreaterThanPct) setValue(FK.xvii_prepay_pct, String(upstreamPrepayGreaterThanPct));
      }
    }
  }, [upstreamPrepayEnabled, upstreamPrepayFirstYears, upstreamPrepayPenaltyMonths, upstreamPrepayGreaterThanPct]);

  // ─── Seed Section XVIII (Documentation Type) from Loan → Limited/No Doc (only if untouched)
  React.useEffect(() => {
    if (!getValue(FK.xviii_doc_type)) {
      setValue(FK.xviii_doc_type, upstreamLimitedNoDoc ? 'limited' : 'full');
    }
  }, [upstreamLimitedNoDoc]);

  // ─── Initial Commissions/Fees (Page 1): auto-track Section 800 total UNLESS
  // the user has typed a manual override. Override wins until the × is clicked.
  const initialFeesOverrideRaw = getValue(FK.initial_fees_page1_override);
  const initialFeesHasOverride =
    initialFeesOverrideRaw !== '' && Number.isFinite(parseNumber(initialFeesOverrideRaw));
  React.useEffect(() => {
    if (initialFeesHasOverride) return;
    const formatted = formatCurrencyDisplay(section800Total.toFixed(2));
    if (getValue(FK.initial_fees_page1) !== formatted) {
      setValue(FK.initial_fees_page1, formatted);
    }
  }, [section800Total, initialFeesHasOverride]);
  // Mirror an active override into the persisted value used by the subtotal sum.
  React.useEffect(() => {
    if (!initialFeesHasOverride) return;
    const formatted = formatCurrencyDisplay(parseNumber(initialFeesOverrideRaw).toFixed(2));
    if (getValue(FK.initial_fees_page1) !== formatted) {
      setValue(FK.initial_fees_page1, formatted);
    }
  }, [initialFeesOverrideRaw, initialFeesHasOverride]);

  // ─── Seed "Payment of Other Obligations" from the Loan Documentation Fee
  // (HUD-1 line 812 _d) only when the RE 885 field is empty/zero, mirroring
  // the seed-if-empty pattern used for initial_fees_page1. User edits win.
  React.useEffect(() => {
    if (loanDocFeeTotal > 0 && isEmptyOrZero(getValue(FK.other_obligations))) {
      setValue(FK.other_obligations, formatCurrencyDisplay(loanDocFeeTotal.toFixed(2)));
    }
  }, [loanDocFeeTotal]);

  // Existing-lien payoff: override wins, else use upstream liensPayoffTotal.
  const liensOverrideRaw = getValue(FK.liens_payoff_override);
  const liensHasOverride =
    liensOverrideRaw !== '' && Number.isFinite(parseNumber(liensOverrideRaw));
  const effectiveLiensPayoff = liensHasOverride
    ? parseNumber(liensOverrideRaw)
    : (liensPayoffTotal || 0);

  // Auto-calculate subtotal of deductions.
  // Per spec (Bug 2): existing-lien payoff(s) where Condition = "Existing –
  // Payoff" AND "Will Be Paid By This Loan" = TRUE MUST flow into the RE 885
  // deductions and reduce Estimated Cash at Closing. liensPayoffTotal is
  // computed upstream from the Lien Management data and passed in as a prop.
  const computedSubtotal = useMemo(() => {
    const fees = parseNumber(getValue(FK.initial_fees_page1));
    const otherObl = parseNumber(getValue(FK.other_obligations));
    const insurance = parseNumber(getValue(FK.credit_life_insurance));
    const add1 = parseNumber(getValue(FK.additional_obligation_1));
    const add2 = parseNumber(getValue(FK.additional_obligation_2));
    return fees + otherObl + insurance + add1 + add2 + effectiveLiensPayoff;
  }, [
    getValue(FK.initial_fees_page1),
    getValue(FK.other_obligations),
    getValue(FK.credit_life_insurance),
    getValue(FK.additional_obligation_1),
    getValue(FK.additional_obligation_2),
    effectiveLiensPayoff,
  ]);

  // Subtotal override wins over the live sum.
  const subtotalOverrideRaw = getValue(FK.subtotal_deductions_override);
  const subtotalHasOverride =
    subtotalOverrideRaw !== '' && Number.isFinite(parseNumber(subtotalOverrideRaw));
  const subtotal = subtotalHasOverride ? parseNumber(subtotalOverrideRaw) : computedSubtotal;

  // Auto-calculate cash at closing: loan amount − subtotal deductions.
  // computedCashAtClosing is the legally-correct derived figure; cashAtClosing
  // is what the form actually displays/persists (override wins when set).
  const computedCashAtClosing = useMemo(() => {
    const loanAmt = parseNumber(getValue(FK.proposed_loan_amount));
    return loanAmt - subtotal;
  }, [getValue(FK.proposed_loan_amount), subtotal]);

  const overrideRaw = getValue(FK.cash_at_closing_override);
  const hasOverride = overrideRaw !== '' && Number.isFinite(parseNumber(overrideRaw));
  const cashAtClosing = hasOverride ? parseNumber(overrideRaw) : computedCashAtClosing;

  // Persist subtotal (the effective value — override or computed).
  React.useEffect(() => {
    const f = formatCurrencyDisplay(subtotal.toFixed(2));
    if (getValue(FK.subtotal_deductions) !== f) setValue(FK.subtotal_deductions, f);
  }, [subtotal]);

  // ─── Section VII: Proposed Initial (Minimum) Loan Payment.
  // SINGLE source of truth = computeBorrowerScheduledPayment, the same function the
  // Loan tab's Regular Payment uses. Loan-scoped, recomputes on every input change.
  const minMonthlyPayment = useMemo(() => {
    const loanAmt = parseNumber(getValue(FK.proposed_loan_amount)) || upstreamLoanAmount;
    const annualRate = parseNumber(getValue(FK.interest_rate)) || upstreamInterestRate;
    const termRaw = parseNumber(getValue(FK.loan_term_value)) || parseNumber(upstreamLoanTermValue);
    const unit = (getValue(FK.loan_term_unit) || upstreamLoanTermUnit || 'months').toLowerCase();
    const termMonths = unit.startsWith('year') ? termRaw * 12 : termRaw;
    const pmt = computeBorrowerScheduledPayment({
      principal: loanAmt,
      annualRatePct: annualRate,
      termMonths,
      amortization: (upstreamAmortization || '') as any,
      balloonAmount: upstreamBalloonEnabled ? upstreamBalloonAmount : 0,
      frequency: (upstreamPaymentFrequency || 'monthly') as any,
    });
    return pmt ?? 0;
  }, [
    getValue(FK.proposed_loan_amount),
    getValue(FK.interest_rate),
    getValue(FK.loan_term_value),
    getValue(FK.loan_term_unit),
    upstreamLoanAmount,
    upstreamInterestRate,
    upstreamLoanTermValue,
    upstreamLoanTermUnit,
    upstreamAmortization,
    upstreamPaymentFrequency,
    upstreamBalloonEnabled,
    upstreamBalloonAmount,
  ]);

  // Continuous sync: overwrite the stored Section VII payment whenever the live
  // derived value differs by more than a half-cent. This prevents stale values
  // (e.g. $2,812.50 from a previous $450k tranche) from sticking across loans.
  React.useEffect(() => {
    if (minMonthlyPayment <= 0) return;
    const formatted = formatCurrencyDisplay(minMonthlyPayment.toFixed(2));
    const current = parseNumber(getValue(FK.vii_payment_amount));
    if (Math.abs(current - minMonthlyPayment) > 0.005 || getValue(FK.vii_payment_amount) === '') {
      setValue(FK.vii_payment_amount, formatted);
    }
  }, [minMonthlyPayment]);




  // Persist cash-at-closing on EVERY change (no abs > 0 gate)
  React.useEffect(() => {
    const abs = Math.abs(cashAtClosing);
    const amountFormatted = formatCurrencyDisplay(abs.toFixed(2));
    if (getValue(FK.cash_at_closing_amount) !== amountFormatted) {
      setValue(FK.cash_at_closing_amount, amountFormatted);
    }
    if (cashAtClosing > 0) {
      if (getValue(FK.cash_at_closing_option) !== 'payable_to_you') setValue(FK.cash_at_closing_option, 'payable_to_you');
      if (!getBoolValue(FK.cash_payable_to_you)) setBoolValue(FK.cash_payable_to_you, true);
      if (getBoolValue(FK.cash_you_must_pay)) setBoolValue(FK.cash_you_must_pay, false);
    } else if (cashAtClosing < 0) {
      if (getValue(FK.cash_at_closing_option) !== 'you_must_pay') setValue(FK.cash_at_closing_option, 'you_must_pay');
      if (getBoolValue(FK.cash_payable_to_you)) setBoolValue(FK.cash_payable_to_you, false);
      if (!getBoolValue(FK.cash_you_must_pay)) setBoolValue(FK.cash_you_must_pay, true);
    } else {
      if (getValue(FK.cash_at_closing_option) !== '') setValue(FK.cash_at_closing_option, '');
      if (getBoolValue(FK.cash_payable_to_you)) setBoolValue(FK.cash_payable_to_you, false);
      if (getBoolValue(FK.cash_you_must_pay)) setBoolValue(FK.cash_you_must_pay, false);
    }
  }, [cashAtClosing]);


  const closingOption = getValue(FK.cash_at_closing_option);
  const isPayableToYou = getBoolValue(FK.cash_payable_to_you) || closingOption === 'payable_to_you';
  const isYouMustPay = getBoolValue(FK.cash_you_must_pay) || closingOption === 'you_must_pay';

  const selectClosingOption = (which: 'payable_to_you' | 'you_must_pay') => {
    setValue(FK.cash_at_closing_option, which);
    setBoolValue(FK.cash_payable_to_you, which === 'payable_to_you');
    setBoolValue(FK.cash_you_must_pay, which === 'you_must_pay');
  };
  const termUnit = getValue(FK.loan_term_unit) || 'years';

  const ROW = 'flex items-center justify-between gap-4 py-2 border-b border-border/30';
  const LBL = 'text-xs text-foreground min-w-0 flex-1';
  const FIELD_W = 'w-[160px] flex-shrink-0';

  return (
    <div className="mt-8 border-t-2 border-foreground pt-4 space-y-4">
      <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">
        RE 885 – Proposed Loan Terms
      </h2>

      {/* ─── I. Proposed Loan Amount ─── */}
      <div className="space-y-0">
        <div className="bg-muted/30 px-3 py-1.5 border-b border-foreground/20">
          <span className="text-xs font-bold text-foreground">I. Proposed Loan Amount</span>
        </div>

        <div className={ROW}>
          <span className={LBL}>Proposed Loan Amount</span>
          <div className={FIELD_W}>
            <CurrencyInput value={getValue(FK.proposed_loan_amount)} onChange={(v) => setValue(FK.proposed_loan_amount, v)} disabled={disabled} />
          </div>
        </div>

        {/* Helper: render a deduction row with editable left-side line-number
            input (Bug 4) and a currency value. */}
        {(() => null)()}

        {/* Initial Commissions, Fees, Costs and Expenses (read-only — Section 800 total) */}
        <div className={ROW}>
          <Input
            value={getValue(FK.initial_fees_page1_lineno)}
            onChange={(e) => setValue(FK.initial_fees_page1_lineno, e.target.value)}
            disabled={disabled}
            placeholder="#"
            className="h-8 text-xs w-14 text-center flex-shrink-0"
            aria-label="Line number"
          />
          <span className={LBL}>Initial Commissions, Fees, Costs and Expenses Summarized on Page 1</span>
          <div className={`${FIELD_W} relative`}>
            <CurrencyInput
              value={
                initialFeesHasOverride
                  ? formatCurrencyDisplay(parseNumber(initialFeesOverrideRaw).toFixed(2))
                  : getValue(FK.initial_fees_page1)
              }
              onChange={(v) => setValue(FK.initial_fees_page1_override, v)}
              disabled={disabled}
              className={initialFeesHasOverride ? 'pr-6' : ''}
            />
            {initialFeesHasOverride && (
              <button
                type="button"
                onClick={() => setValue(FK.initial_fees_page1_override, '')}
                disabled={disabled}
                aria-label="Clear manual override"
                title="Clear manual override"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs leading-none px-1 disabled:opacity-50"
              >
                ×
              </button>
            )}
          </div>
        </div>


        <div className="bg-muted/20 px-3 py-1 border-b border-border/30">
          <span className="text-xs font-semibold text-foreground">Payment of Other Obligations (List)</span>
        </div>

        <div className={ROW}>
          <Input
            value={getValue(FK.credit_life_insurance_lineno)}
            onChange={(e) => setValue(FK.credit_life_insurance_lineno, e.target.value)}
            disabled={disabled}
            placeholder="#"
            className="h-8 text-xs w-14 text-center flex-shrink-0"
            aria-label="Line number"
          />
          <span className={LBL}>Credit Life and/or Disability Insurance (see XIV below)</span>
          <div className={FIELD_W}>
            <CurrencyInput value={getValue(FK.credit_life_insurance)} onChange={(v) => setValue(FK.credit_life_insurance, v)} disabled={disabled} />
          </div>
        </div>

        <div className={ROW}>
          <Input
            value={getValue(FK.other_obligations_lineno)}
            onChange={(e) => setValue(FK.other_obligations_lineno, e.target.value)}
            disabled={disabled}
            placeholder="#"
            className="h-8 text-xs w-14 text-center flex-shrink-0"
            aria-label="Line number"
          />
          <span className={LBL}>Payment of Other Obligations</span>
          <div className={FIELD_W}>
            <CurrencyInput value={getValue(FK.other_obligations)} onChange={(v) => setValue(FK.other_obligations, v)} disabled={disabled} />
          </div>
        </div>

        <div className={ROW}>
          <Input
            value={getValue(FK.additional_obligation_1_lineno)}
            onChange={(e) => setValue(FK.additional_obligation_1_lineno, e.target.value)}
            disabled={disabled}
            placeholder="#"
            className="h-8 text-xs w-14 text-center flex-shrink-0"
            aria-label="Line number"
          />
          <span className={LBL}>Additional Obligation Line 1</span>
          <div className={FIELD_W}>
            <CurrencyInput value={getValue(FK.additional_obligation_1)} onChange={(v) => setValue(FK.additional_obligation_1, v)} disabled={disabled} />
          </div>
        </div>

        <div className={ROW}>
          <Input
            value={getValue(FK.additional_obligation_2_lineno)}
            onChange={(e) => setValue(FK.additional_obligation_2_lineno, e.target.value)}
            disabled={disabled}
            placeholder="#"
            className="h-8 text-xs w-14 text-center flex-shrink-0"
            aria-label="Line number"
          />
          <span className={LBL}>Additional Obligation Line 2</span>
          <div className={FIELD_W}>
            <CurrencyInput value={getValue(FK.additional_obligation_2)} onChange={(v) => setValue(FK.additional_obligation_2, v)} disabled={disabled} />
          </div>
        </div>

        {/* Existing-lien payoff(s) flowed from Lien Management. Included in
            the Subtotal of All Deductions (Bug 2). */}
        {(liensPayoffTotal > 0 || liensHasOverride) && (
          <div className={ROW}>
            <Input
              value={getValue(FK.liens_payoff_lineno)}
              onChange={(e) => setValue(FK.liens_payoff_lineno, e.target.value)}
              disabled={disabled}
              placeholder="#"
              className="h-8 text-xs w-14 text-center flex-shrink-0"
              aria-label="Line number"
            />
            <span className={`${LBL} italic`}>Payment of Existing Liens (from Lien Management)</span>
            <div className={`${FIELD_W} relative`}>
              <CurrencyInput
                value={
                  liensHasOverride
                    ? formatCurrencyDisplay(parseNumber(liensOverrideRaw).toFixed(2))
                    : formatCurrencyDisplay(liensPayoffTotal.toFixed(2))
                }
                onChange={(v) => setValue(FK.liens_payoff_override, v)}
                disabled={disabled}
                className={liensHasOverride ? 'pr-6' : ''}
              />
              {liensHasOverride && (
                <button
                  type="button"
                  onClick={() => setValue(FK.liens_payoff_override, '')}
                  disabled={disabled}
                  aria-label="Clear manual override"
                  title="Clear manual override"
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs leading-none px-1 disabled:opacity-50"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        )}

        {/* Subtotal */}
        <div className="flex items-center justify-between gap-4 py-2 border-t border-foreground/30 border-b border-border/30">
          <span className="text-xs font-bold text-foreground flex-1">Subtotal of All Deductions</span>
          <div className={`${FIELD_W} relative`}>
            <CurrencyInput
              value={
                subtotalHasOverride
                  ? formatCurrencyDisplay(parseNumber(subtotalOverrideRaw).toFixed(2))
                  : (subtotal > 0 ? formatCurrencyDisplay(subtotal.toFixed(2)) : '')
              }
              onChange={(v) => setValue(FK.subtotal_deductions_override, v)}
              disabled={disabled}
              className={subtotalHasOverride ? 'pr-6' : ''}
            />
            {subtotalHasOverride && (
              <button
                type="button"
                onClick={() => setValue(FK.subtotal_deductions_override, '')}
                disabled={disabled}
                aria-label="Clear manual override"
                title="Clear manual override"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs leading-none px-1 disabled:opacity-50"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Estimated Cash at Closing — editable manual override (Bug 3).
            Computed value is the default; typing replaces it (override saved
            to re885_cash_at_closing_override). "Reset" clears the override. */}
        <div className="flex items-center justify-between gap-4 py-2 border-b border-border/30">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <span className="text-xs font-bold text-foreground whitespace-nowrap">Estimated Cash at Closing</span>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox
                  checked={isPayableToYou}
                  onCheckedChange={(c) => {
                    if (c) selectClosingOption('payable_to_you');
                    else {
                      setBoolValue(FK.cash_payable_to_you, false);
                      if (closingOption === 'payable_to_you') setValue(FK.cash_at_closing_option, '');
                    }
                  }}
                  disabled={disabled}
                  className="h-3.5 w-3.5"
                />
                <span className="text-xs text-foreground">Payable to You</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox
                  checked={isYouMustPay}
                  onCheckedChange={(c) => {
                    if (c) selectClosingOption('you_must_pay');
                    else {
                      setBoolValue(FK.cash_you_must_pay, false);
                      if (closingOption === 'you_must_pay') setValue(FK.cash_at_closing_option, '');
                    }
                  }}
                  disabled={disabled}
                  className="h-3.5 w-3.5"
                />
                <span className="text-xs text-foreground">You Must Pay</span>
              </label>
              {hasOverride && (
                <button
                  type="button"
                  onClick={() => setValue(FK.cash_at_closing_override, '')}
                  disabled={disabled}
                  className="text-[10px] text-primary hover:underline disabled:opacity-50"
                  title="Clear manual override and revert to computed value"
                >
                  Reset to computed
                </button>
              )}
            </div>
          </div>
          <div className={`${FIELD_W} relative`}>
            <CurrencyInput
              value={
                hasOverride
                  ? formatCurrencyDisplay(Math.abs(cashAtClosing).toFixed(2))
                  : (Math.abs(computedCashAtClosing) > 0
                      ? formatCurrencyDisplay(Math.abs(computedCashAtClosing).toFixed(2))
                      : '')
              }
              onChange={(v) => setValue(FK.cash_at_closing_override, v)}
              disabled={disabled}
              className={hasOverride ? 'pr-6' : ''}
            />
            {hasOverride && (
              <button
                type="button"
                onClick={() => setValue(FK.cash_at_closing_override, '')}
                disabled={disabled}
                aria-label="Clear manual override"
                title="Clear manual override"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs leading-none px-1 disabled:opacity-50"
              >
                ×
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── II. Proposed Loan Term ─── */}
      <div className="space-y-0">
        <div className="bg-muted/30 px-3 py-1.5 border-b border-foreground/20">
          <span className="text-xs font-bold text-foreground">II. Proposed Loan Term</span>
        </div>
        <div className={ROW}>
          <div className="flex items-center gap-3 flex-1">
            <Input
              type="number"
              inputMode="numeric"
              min="1"
              value={getValue(FK.loan_term_value)}
              onChange={(e) => setValue(FK.loan_term_value, e.target.value)}
              disabled={disabled}
              placeholder="0"
              className="h-8 text-xs w-20"
            />
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="re885_term_unit"
                checked={termUnit === 'years'}
                onChange={() => setValue(FK.loan_term_unit, 'years')}
                disabled={disabled}
                className="h-3 w-3"
              />
              <span className="text-xs text-foreground">Years</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="re885_term_unit"
                checked={termUnit === 'months'}
                onChange={() => setValue(FK.loan_term_unit, 'months')}
                disabled={disabled}
                className="h-3 w-3"
              />
              <span className="text-xs text-foreground">Months</span>
            </label>
          </div>
        </div>
      </div>

      {/* ─── III. Proposed Interest Rate ─── */}
      <div className="space-y-0">
        <div className="bg-muted/30 px-3 py-1.5 border-b border-foreground/20">
          <span className="text-xs font-bold text-foreground">III. Proposed Interest Rate</span>
        </div>
        <div className={ROW}>
          <div className="flex items-center gap-4 flex-1">
            <div className="relative w-24">
              <Input
                inputMode="decimal"
                value={getValue(FK.interest_rate)}
                onChange={(e) => {
                  const v = sanitizeInterestInput(e.target.value);
                  setValue(FK.interest_rate, v);
                }}
                onBlur={() => { const v = normalizeInterestOnBlur(getValue(FK.interest_rate), 3); if (v !== getValue(FK.interest_rate)) setValue(FK.interest_rate, v); }}
                disabled={disabled}
                placeholder="0.00"
                className="h-8 text-xs text-right pr-5"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Checkbox
                checked={isFixed}
                onCheckedChange={(c) => {
                  setBoolValue(FK.rate_type_fixed, !!c);
                  if (c) setBoolValue(FK.rate_type_adjustable, false);
                }}
                disabled={disabled}
              />
              <Label className="text-xs cursor-pointer">Fixed Rate</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Checkbox
                checked={isAdjustable}
                onCheckedChange={(c) => {
                  setBoolValue(FK.rate_type_adjustable, !!c);
                  if (c) setBoolValue(FK.rate_type_fixed, false);
                }}
                disabled={disabled}
              />
              <Label className="text-xs cursor-pointer">Initial Adjustable Rate</Label>
            </div>
          </div>
        </div>
        {isFixed && (
          <div className="px-3 py-2 bg-accent/30 border border-accent rounded text-xs text-foreground italic">
            If the Fixed Rate Box is checked in Section III immediately above, proceed to section X. Do not complete sections IV through IX.
          </div>
        )}
      </div>

      {/* ─── IV–IX: Adjustable Rate Details ─── */}
      <div className={`space-y-0 ${isFixed ? 'opacity-40 pointer-events-none' : ''}`}>
        {/* IV */}
        <div className="bg-muted/30 px-3 py-1.5 border-b border-foreground/20">
          <span className="text-xs font-bold text-foreground">IV. Initial Adjustable Rate in effect for</span>
        </div>
        <div className={ROW}>
          <div className="flex items-center gap-2 flex-1">
            <Input
              type="number"
              inputMode="numeric"
              value={getValue(FK.iv_adj_rate_months)}
              onChange={(e) => setValue(FK.iv_adj_rate_months, e.target.value)}
              disabled={adjustableSectionsDisabled}
              placeholder="0"
              className="h-8 text-xs w-20"
            />
            <span className="text-xs text-foreground">Months</span>
          </div>
        </div>

        {/* V */}
        <div className="bg-muted/30 px-3 py-1.5 border-b border-foreground/20 mt-2">
          <span className="text-xs font-bold text-foreground">V. Fully Indexed Interest Rate</span>
        </div>
        <div className={ROW}>
          <div className="relative w-24">
            <Input
              inputMode="decimal"
              value={getValue(FK.v_fully_indexed_rate)}
              onChange={(e) => setValue(FK.v_fully_indexed_rate, sanitizeInterestInput(e.target.value))}
              onBlur={() => { const v = normalizeInterestOnBlur(getValue(FK.v_fully_indexed_rate), 3); if (v !== getValue(FK.v_fully_indexed_rate)) setValue(FK.v_fully_indexed_rate, v); }}
              disabled={adjustableSectionsDisabled}
              placeholder="0.00"
              className="h-8 text-xs text-right pr-5"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">%</span>
          </div>
        </div>

        {/* VI */}
        <div className="bg-muted/30 px-3 py-1.5 border-b border-foreground/20 mt-2">
          <span className="text-xs font-bold text-foreground">VI. Maximum Interest Rate</span>
        </div>
        <div className={ROW}>
          <div className="relative w-24">
            <Input
              inputMode="decimal"
              value={getValue(FK.vi_max_interest_rate)}
              onChange={(e) => setValue(FK.vi_max_interest_rate, sanitizeInterestInput(e.target.value))}
              onBlur={() => { const v = normalizeInterestOnBlur(getValue(FK.vi_max_interest_rate), 3); if (v !== getValue(FK.vi_max_interest_rate)) setValue(FK.vi_max_interest_rate, v); }}
              disabled={adjustableSectionsDisabled}
              placeholder="0.00"
              className="h-8 text-xs text-right pr-5"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">%</span>
          </div>
        </div>

        {/* VII */}
        <div className="bg-muted/30 px-3 py-1.5 border-b border-foreground/20 mt-2">
          <span className="text-xs font-bold text-foreground">VII. Proposed Initial (Minimum) Loan Payment</span>
        </div>
        <div className={ROW}>
          <div className="flex items-center gap-3 flex-1">
            <div className={FIELD_W}>
              <CurrencyInput
                value={getValue(FK.vii_payment_amount)}
                onChange={(v) => setValue(FK.vii_payment_amount, v)}
                disabled={adjustableSectionsDisabled}
              />
            </div>
            <span className="text-xs text-foreground">Monthly</span>
          </div>
        </div>

        {/* VIII */}
        <div className="bg-muted/30 px-3 py-1.5 border-b border-foreground/20 mt-2">
          <span className="text-xs font-bold text-foreground">VIII. Interest Rate can Increase</span>
        </div>
        <div className={ROW}>
          <div className="flex items-center gap-2 flex-1 flex-wrap">
            <div className="relative w-20">
              <Input
                inputMode="decimal"
                value={getValue(FK.viii_rate_increase_pct)}
                onChange={(e) => setValue(FK.viii_rate_increase_pct, sanitizeInterestInput(e.target.value))}
                onBlur={() => { const v = normalizeInterestOnBlur(getValue(FK.viii_rate_increase_pct), 3); if (v !== getValue(FK.viii_rate_increase_pct)) setValue(FK.viii_rate_increase_pct, v); }}
                disabled={adjustableSectionsDisabled}
                placeholder="0.00"
                className="h-8 text-xs text-right pr-5"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">%</span>
            </div>
            <span className="text-xs text-foreground">each</span>
            <Input
              type="number"
              inputMode="numeric"
              value={getValue(FK.viii_rate_increase_months)}
              onChange={(e) => setValue(FK.viii_rate_increase_months, e.target.value)}
              disabled={adjustableSectionsDisabled}
              placeholder="0"
              className="h-8 text-xs w-20"
            />
            <span className="text-xs text-foreground">Months</span>
          </div>
        </div>

        {/* IX */}
        <div className="bg-muted/30 px-3 py-1.5 border-b border-foreground/20 mt-2">
          <span className="text-xs font-bold text-foreground">IX. Payment Options end after</span>
        </div>
        <div className={ROW}>
          <div className="flex items-center gap-2 flex-1 flex-wrap">
            <Input
              type="number"
              inputMode="numeric"
              value={getValue(FK.ix_payment_end_months)}
              onChange={(e) => setValue(FK.ix_payment_end_months, e.target.value)}
              disabled={adjustableSectionsDisabled}
              placeholder="0"
              className="h-8 text-xs w-20"
            />
            <span className="text-xs text-foreground">Months or</span>
            <div className="relative w-20">
              <Input
                inputMode="decimal"
                value={getValue(FK.ix_payment_end_pct)}
                onChange={(e) => setValue(FK.ix_payment_end_pct, e.target.value.replace(/[^0-9.]/g, ''))}
                disabled={adjustableSectionsDisabled}
                placeholder="0.00"
                className="h-8 text-xs text-right pr-5"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">%</span>
            </div>
            <span className="text-xs text-foreground italic">of Original Balance, whichever comes first</span>
          </div>
        </div>
      </div>

      {/* ─── X. Balloon Payment ─── */}
      <div className="space-y-0">
        <div className="bg-muted/30 px-3 py-1.5 border-b border-foreground/20">
          <span className="text-xs font-bold text-foreground">X. Balloon Payment</span>
        </div>
        <div className={ROW}>
          <div className="flex items-center gap-3 flex-1 flex-wrap">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <Checkbox
                checked={getBoolValue(FK.x_balloon_has)}
                onCheckedChange={(c) => setBoolValue(FK.x_balloon_has, !!c)}
                disabled={disabled}
                className="h-3.5 w-3.5"
              />
              <span className="text-xs text-foreground">This loan contains a balloon payment</span>
            </label>
          </div>
        </div>
        {getBoolValue(FK.x_balloon_has) && (
          <div className={ROW}>
            <div className="flex items-center gap-2 flex-1 flex-wrap">
              <span className="text-xs text-foreground">Balloon payment of</span>
              <div className="w-[140px] flex-shrink-0">
                <CurrencyInput
                  value={getValue(FK.x_balloon_amount)}
                  onChange={(v) => setValue(FK.x_balloon_amount, v)}
                  disabled={disabled}
                />
              </div>
              <span className="text-xs text-foreground">due in</span>
              <Input
                type="number"
                inputMode="numeric"
                value={getValue(FK.x_balloon_due_months)}
                onChange={(e) => setValue(FK.x_balloon_due_months, e.target.value)}
                disabled={disabled}
                placeholder="0"
                className="h-8 text-xs w-20"
              />
              <span className="text-xs text-foreground">months from the date of the loan.</span>
            </div>
          </div>
        )}
      </div>

      {/* ─── XI. Negative Amortization ─── */}
      <div className="space-y-0">
        <div className="bg-muted/30 px-3 py-1.5 border-b border-foreground/20">
          <span className="text-xs font-bold text-foreground">XI. Negative Amortization</span>
        </div>
        <div className={ROW}>
          <div className="flex items-center gap-1 flex-1 flex-wrap">
            <span className="text-xs text-foreground">If your loan contains negative amortization, at the time no additional negative amortization will accrue, your loan balance will be</span>
            <div className="w-[130px] flex-shrink-0">
              <CurrencyInput
                value={getValue(FK.xi_neg_amort_balance)}
                onChange={(v) => setValue(FK.xi_neg_amort_balance, v)}
                disabled={disabled}
              />
            </div>
            <span className="text-xs text-foreground">assuming minimum payments are made.</span>
          </div>
        </div>
      </div>

      {/* ─── XIV. Impound (Escrow) Account ─── */}
      <div className="space-y-0">
        <div className="bg-muted/30 px-3 py-1.5 border-b border-foreground/20">
          <span className="text-xs font-bold text-foreground">XIV. Impound (Escrow) Account</span>
        </div>
        <div className="px-3 py-3 space-y-3 border-b border-border/30">
          <div className="flex items-start gap-1 flex-wrap">
            <span className="text-xs text-foreground">If there is no impound (escrow) account you will have to plan for the payment of:</span>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Checkbox
                checked={getBoolValue(FK.impound_county_taxes)}
                onCheckedChange={(c) => setBoolValue(FK.impound_county_taxes, !!c)}
                disabled={disabled}
              />
              <Label className="text-xs cursor-pointer">County Property Taxes</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Checkbox
                checked={getBoolValue(FK.impound_hazard_ins)}
                onCheckedChange={(c) => setBoolValue(FK.impound_hazard_ins, !!c)}
                disabled={disabled}
              />
              <Label className="text-xs cursor-pointer">Hazard Insurance</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Checkbox
                checked={getBoolValue(FK.impound_mortgage_ins)}
                onCheckedChange={(c) => setBoolValue(FK.impound_mortgage_ins, !!c)}
                disabled={disabled}
              />
              <Label className="text-xs cursor-pointer">Mortgage Insurance</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Checkbox
                checked={getBoolValue(FK.impound_flood_ins)}
                onCheckedChange={(c) => setBoolValue(FK.impound_flood_ins, !!c)}
                disabled={disabled}
              />
              <Label className="text-xs cursor-pointer">Flood Insurance</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Checkbox
                checked={getBoolValue(FK.impound_other)}
                onCheckedChange={(c) => setBoolValue(FK.impound_other, !!c)}
                disabled={disabled}
              />
              <Label className="text-xs cursor-pointer">Other</Label>
              {getBoolValue(FK.impound_other) && (
                <Input
                  value={getValue(FK.impound_other_desc)}
                  onChange={(e) => setValue(FK.impound_other_desc, e.target.value)}
                  disabled={disabled}
                  placeholder="Specify..."
                  className="h-7 text-xs w-28"
                />
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-foreground">of approximately</span>
            <div className="w-[130px]">
              <CurrencyInput
                value={getValue(FK.impound_approx_amount)}
                onChange={(v) => setValue(FK.impound_approx_amount, v)}
                disabled={disabled}
              />
            </div>
            <span className="text-xs text-foreground">per year.</span>
          </div>
        </div>
      </div>

      {/* ─── XVII. Prepayment Penalty (from Loan → Article 7) ─── */}
      <div className="space-y-0">
        <div className="bg-muted/30 px-3 py-1.5 border-b border-foreground/20">
          <span className="text-xs font-bold text-foreground">XVII. Prepayment Penalty</span>
        </div>
        <div className="px-3 py-1 text-[10px] italic text-muted-foreground border-b border-border/30">
          Auto-populated from Loan → Article 7 (Pre-payment Penalty). User can override.
        </div>
        <div className={ROW}>
          <span className={LBL}>Does this loan contain a prepayment penalty?</span>
          <div className="flex items-center gap-3 flex-shrink-0">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <Checkbox
                checked={getBoolValue(FK.xvii_prepay_has)}
                onCheckedChange={(c) => setBoolValue(FK.xvii_prepay_has, !!c)}
                disabled={disabled}
                className="h-3.5 w-3.5"
              />
              <span className="text-xs text-foreground">Yes</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <Checkbox
                checked={!getBoolValue(FK.xvii_prepay_has)}
                onCheckedChange={(c) => { if (c) setBoolValue(FK.xvii_prepay_has, false); }}
                disabled={disabled}
                className="h-3.5 w-3.5"
              />
              <span className="text-xs text-foreground">No</span>
            </label>
          </div>
        </div>
        {getBoolValue(FK.xvii_prepay_has) && (
          <>
            <div className={ROW}>
              <span className={LBL}>Penalty Amount</span>
              <div className={FIELD_W}>
                <CurrencyInput
                  value={getValue(FK.xvii_prepay_amount)}
                  onChange={(v) => setValue(FK.xvii_prepay_amount, v)}
                  disabled={disabled}
                />
              </div>
            </div>
            <div className={ROW}>
              <span className={LBL}>Penalty Period (months)</span>
              <div className={FIELD_W}>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={getValue(FK.xvii_prepay_term_months)}
                  onChange={(e) => setValue(FK.xvii_prepay_term_months, e.target.value)}
                  disabled={disabled}
                  placeholder="0"
                  className="h-8 text-xs text-right"
                />
              </div>
            </div>
            <div className={ROW}>
              <span className={LBL}>Penalty % of outstanding balance</span>
              <div className={FIELD_W}>
                <div className="relative">
                  <Input
                    inputMode="decimal"
                    value={getValue(FK.xvii_prepay_pct)}
                    onChange={(e) => setValue(FK.xvii_prepay_pct, sanitizeInterestInput(e.target.value))}
                    onBlur={() => { const v = normalizeInterestOnBlur(getValue(FK.xvii_prepay_pct), 3); if (v !== getValue(FK.xvii_prepay_pct)) setValue(FK.xvii_prepay_pct, v); }}
                    disabled={disabled}
                    placeholder="0.00"
                    className="h-8 text-xs text-right pr-5"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">%</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ─── XVIII. Loan Documentation Type (from Loan → Limited/No Doc) ─── */}
      <div className="space-y-0">
        <div className="bg-muted/30 px-3 py-1.5 border-b border-foreground/20">
          <span className="text-xs font-bold text-foreground">XVIII. Loan Documentation Type</span>
        </div>
        <div className="px-3 py-1 text-[10px] italic text-muted-foreground border-b border-border/30">
          Auto-populated from Loan → Limited / No Documentation. User can override.
        </div>
        <div className="px-3 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border/30">
          {DOC_TYPE_OPTIONS.map(opt => (
            <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer">
              <Checkbox
                checked={getValue(FK.xviii_doc_type) === opt.value}
                onCheckedChange={(c) => { if (c) setValue(FK.xviii_doc_type, opt.value); }}
                disabled={disabled}
                className="h-3.5 w-3.5"
              />
              <span className="text-xs text-foreground">{opt.label}</span>
            </label>
          ))}
          {getValue(FK.xviii_doc_type) === 'other' && (
            <Input
              value={getValue(FK.xviii_doc_type_other)}
              onChange={(e) => setValue(FK.xviii_doc_type_other, e.target.value)}
              disabled={disabled}
              placeholder="Specify..."
              className="h-7 text-xs w-40"
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default RE885ProposedLoanTerms;
