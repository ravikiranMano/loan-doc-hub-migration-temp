import React, { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { sanitizeInterestInput, normalizeInterestOnBlur } from '@/lib/interestValidation';
import { formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';

const FK = {
  proposed_loan_amount: 'origination_fees.re885_proposed_loan_amount',
  initial_fees_page1: 'origination_fees.re885_initial_fees_page1',
  other_obligations: 'origination_fees.re885_other_obligations',
  credit_life_insurance: 'origination_fees.re885_credit_life_insurance',
  additional_obligation_1: 'origination_fees.re885_additional_obligation_1',
  additional_obligation_2: 'origination_fees.re885_additional_obligation_2',
  subtotal_deductions: 'origination_fees.re885_subtotal_deductions',
  cash_at_closing_option: 'origination_fees.re885_cash_at_closing_option',
  cash_at_closing_amount: 'origination_fees.re885_cash_at_closing_amount',
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
  xi_neg_amort_balance: 'origination_fees.re885_xi_neg_amort_balance',
  impound_county_taxes: 'origination_fees.re885_impound_county_taxes',
  impound_hazard_ins: 'origination_fees.re885_impound_hazard_ins',
  impound_mortgage_ins: 'origination_fees.re885_impound_mortgage_ins',
  impound_flood_ins: 'origination_fees.re885_impound_flood_ins',
  impound_other: 'origination_fees.re885_impound_other',
  impound_other_desc: 'origination_fees.re885_impound_other_desc',
  impound_approx_amount: 'origination_fees.re885_impound_approx_amount',
};

interface RE885Props {
  getValue: (key: string) => string;
  setValue: (key: string, value: string) => void;
  getBoolValue: (key: string) => boolean;
  setBoolValue: (key: string, value: boolean) => void;
  parseNumber: (val: string) => number;
  disabled: boolean;
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
}) => {
  const isFixed = getBoolValue(FK.rate_type_fixed);
  const isAdjustable = getBoolValue(FK.rate_type_adjustable);
  const adjustableSectionsDisabled = disabled || isFixed;

  // Auto-calculate subtotal
  const subtotal = useMemo(() => {
    const fees = parseNumber(getValue(FK.initial_fees_page1));
    const otherObl = parseNumber(getValue(FK.other_obligations));
    const insurance = parseNumber(getValue(FK.credit_life_insurance));
    const add1 = parseNumber(getValue(FK.additional_obligation_1));
    const add2 = parseNumber(getValue(FK.additional_obligation_2));
    return fees + otherObl + insurance + add1 + add2;
  }, [
    getValue(FK.initial_fees_page1),
    getValue(FK.other_obligations),
    getValue(FK.credit_life_insurance),
    getValue(FK.additional_obligation_1),
    getValue(FK.additional_obligation_2),
  ]);

  // Auto-calculate cash at closing
  const cashAtClosing = useMemo(() => {
    const loanAmt = parseNumber(getValue(FK.proposed_loan_amount));
    return loanAmt - subtotal;
  }, [getValue(FK.proposed_loan_amount), subtotal]);

  // Write computed values
  React.useEffect(() => {
    if (subtotal > 0) setValue(FK.subtotal_deductions, formatCurrencyDisplay(subtotal.toFixed(2)));
  }, [subtotal]);

  React.useEffect(() => {
    const abs = Math.abs(cashAtClosing);
    if (abs > 0) {
      setValue(FK.cash_at_closing_amount, formatCurrencyDisplay(abs.toFixed(2)));
      setValue(FK.cash_at_closing_option, cashAtClosing >= 0 ? 'payable_to_you' : 'you_must_pay');
    }
  }, [cashAtClosing]);

  const closingOption = getValue(FK.cash_at_closing_option);
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

        <div className={ROW}>
          <span className={LBL}>Initial Commissions, Fees, Costs and Expenses Summarized on Page 1</span>
          <div className={FIELD_W}>
            <CurrencyInput value={getValue(FK.initial_fees_page1)} onChange={(v) => setValue(FK.initial_fees_page1, v)} disabled={disabled} />
          </div>
        </div>

        <div className="bg-muted/20 px-3 py-1 border-b border-border/30">
          <span className="text-xs font-semibold text-foreground">Payment of Other Obligations (List)</span>
        </div>

        <div className={ROW}>
          <span className={LBL}>Credit Life and/or Disability Insurance (see XIV below)</span>
          <div className={FIELD_W}>
            <CurrencyInput value={getValue(FK.credit_life_insurance)} onChange={(v) => setValue(FK.credit_life_insurance, v)} disabled={disabled} />
          </div>
        </div>

        <div className={ROW}>
          <span className={LBL}>Payment of Other Obligations</span>
          <div className={FIELD_W}>
            <CurrencyInput value={getValue(FK.other_obligations)} onChange={(v) => setValue(FK.other_obligations, v)} disabled={disabled} />
          </div>
        </div>

        <div className={ROW}>
          <span className={LBL}>Additional Obligation Line 1</span>
          <div className={FIELD_W}>
            <CurrencyInput value={getValue(FK.additional_obligation_1)} onChange={(v) => setValue(FK.additional_obligation_1, v)} disabled={disabled} />
          </div>
        </div>

        <div className={ROW}>
          <span className={LBL}>Additional Obligation Line 2</span>
          <div className={FIELD_W}>
            <CurrencyInput value={getValue(FK.additional_obligation_2)} onChange={(v) => setValue(FK.additional_obligation_2, v)} disabled={disabled} />
          </div>
        </div>

        {/* Subtotal */}
        <div className="flex items-center justify-between gap-4 py-2 border-t border-foreground/30 border-b border-border/30">
          <span className="text-xs font-bold text-foreground flex-1">Subtotal of All Deductions</span>
          <div className={FIELD_W}>
            <CurrencyInput value={subtotal > 0 ? formatCurrencyDisplay(subtotal.toFixed(2)) : ''} onChange={() => {}} readOnly disabled />
          </div>
        </div>

        {/* Estimated Cash at Closing */}
        <div className="flex items-center justify-between gap-4 py-2 border-b border-border/30">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <span className="text-xs font-bold text-foreground whitespace-nowrap">Estimated Cash at Closing</span>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="re885_closing_option"
                  checked={closingOption === 'payable_to_you'}
                  onChange={() => setValue(FK.cash_at_closing_option, 'payable_to_you')}
                  disabled={disabled}
                  className="h-3 w-3"
                />
                <span className="text-xs text-foreground">Payable to You</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="re885_closing_option"
                  checked={closingOption === 'you_must_pay'}
                  onChange={() => setValue(FK.cash_at_closing_option, 'you_must_pay')}
                  disabled={disabled}
                  className="h-3 w-3"
                />
                <span className="text-xs text-foreground">You Must Pay</span>
              </label>
            </div>
          </div>
          <div className={FIELD_W}>
            <CurrencyInput value={Math.abs(cashAtClosing) > 0 ? formatCurrencyDisplay(Math.abs(cashAtClosing).toFixed(2)) : ''} onChange={() => {}} readOnly disabled />
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
                onBlur={() => { const v = normalizeInterestOnBlur(getValue(FK.interest_rate), 2); if (v !== getValue(FK.interest_rate)) setValue(FK.interest_rate, v); }}
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
              onBlur={() => { const v = normalizeInterestOnBlur(getValue(FK.v_fully_indexed_rate), 2); if (v !== getValue(FK.v_fully_indexed_rate)) setValue(FK.v_fully_indexed_rate, v); }}
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
              onBlur={() => { const v = normalizeInterestOnBlur(getValue(FK.vi_max_interest_rate), 2); if (v !== getValue(FK.vi_max_interest_rate)) setValue(FK.vi_max_interest_rate, v); }}
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
                onBlur={() => { const v = normalizeInterestOnBlur(getValue(FK.viii_rate_increase_pct), 2); if (v !== getValue(FK.viii_rate_increase_pct)) setValue(FK.viii_rate_increase_pct, v); }}
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

      {/* ─── Impound (Escrow) Account ─── */}
      <div className="space-y-0">
        <div className="bg-muted/30 px-3 py-1.5 border-b border-foreground/20">
          <span className="text-xs font-bold text-foreground">Impound (Escrow) Account</span>
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
    </div>
  );
};

export default RE885ProposedLoanTerms;
