import React, { useState, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { EnhancedCalendar } from "@/components/ui/enhanced-calendar";
import { CalendarIcon } from "lucide-react";
import { format, parse, isValid } from "date-fns";
import { cn } from "@/lib/utils";
import type { FieldDefinition } from "@/hooks/useDealFields";
import type { CalculationResult } from "@/lib/calculationEngine";
import { DirtyFieldWrapper } from "./DirtyFieldWrapper";
import { sanitizeInterestInput, normalizeInterestOnBlur } from "@/lib/interestValidation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useDealNavigationOptional } from "@/contexts/DealNavigationContext";
import type { LoanTermsSubSection } from "./LoanTermsSubNavigation";


interface LoanTermsBalancesFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

import { LOAN_TERMS_BALANCES_KEYS } from "@/lib/fieldKeyMap";
import { formatPercentDisplay as smartPercentDisplay, roundPctForStorage } from "@/lib/precisionFormat";

// Use central field key map
const FIELD_KEYS = LOAN_TERMS_BALANCES_KEYS;

const PAYMENT_FREQUENCY_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "bi_weekly", label: "Bi-Weekly" },
  { value: "weekly", label: "Weekly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annually", label: "Annually" },
  { value: "semi_annually", label: "Semi-Annually" },
];

const ACCRUAL_METHOD_OPTIONS = [
  { value: "30_360", label: "30/360" },
  { value: "actual_360", label: "Actual/360" },
  { value: "actual_365", label: "Actual/365" },
  { value: "actual_actual", label: "Actual/Actual" },
];

const LABEL_CLASS = "text-sm text-muted-foreground w-[140px] min-w-[140px] max-w-[140px] text-left shrink-0 leading-tight break-words";

export const LoanTermsBalancesForm: React.FC<LoanTermsBalancesFormProps> = ({
  values,
  onValueChange,
  showValidation = false,
  disabled = false,
}) => {
  const nav = useDealNavigationOptional();
  const [otherSchedPmtsOpen, setOtherSchedPmtsOpen] = useState(false);
  const [lendersBlurred, setLendersBlurred] = useState(false);

  const navigateToSubSection = (sub: LoanTermsSubSection) => {
    nav?.setSubSection('loan_terms', sub);
  };

  const getValue = (key: string) => values[key] || "";
  const setValue = (key: string, value: string) => onValueChange(key, value);
  const isChecked = (key: string) => getValue(key) === "true";
  const toggleCheck = (key: string) => setValue(key, isChecked(key) ? "" : "true");

  const parseNum = (key: string) => {
    const v = getValue(key).replace(/[^0-9.\-]/g, '');
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  };

  // Auto-calculated values
  const calculatedTotalPayment = useMemo(() => {
    return (
      parseNum(FIELD_KEYS.regularPayment) +
      parseNum(FIELD_KEYS.additionalPrincipal) +
      parseNum(FIELD_KEYS.servicingFees) +
      parseNum(FIELD_KEYS.otherScheduledPayments) +
      parseNum(FIELD_KEYS.toEscrowImpounds) +
      parseNum(FIELD_KEYS.defaultInterest)
    );
  }, [
    values[FIELD_KEYS.regularPayment], values[FIELD_KEYS.additionalPrincipal],
    values[FIELD_KEYS.servicingFees], values[FIELD_KEYS.otherScheduledPayments],
    values[FIELD_KEYS.toEscrowImpounds], values[FIELD_KEYS.defaultInterest],
  ]);

  const calculatedAmountToReinstate = useMemo(() => {
    return (
      parseNum(FIELD_KEYS.principal) +
      parseNum(FIELD_KEYS.unpaidLateCharges) +
      parseNum(FIELD_KEYS.accruedLateCharges) +
      parseNum(FIELD_KEYS.unpaidInterest) +
      parseNum(FIELD_KEYS.accruedInterest) +
      parseNum(FIELD_KEYS.interestGuarantee) +
      parseNum(FIELD_KEYS.unpaidDefaultInterest) +
      parseNum(FIELD_KEYS.accruedDefaultInterest) +
      parseNum(FIELD_KEYS.chargesOwed) +
      parseNum(FIELD_KEYS.chargesInterest) +
      parseNum(FIELD_KEYS.unpaidOther)
    );
  }, [
    values[FIELD_KEYS.principal], values[FIELD_KEYS.unpaidLateCharges],
    values[FIELD_KEYS.accruedLateCharges], values[FIELD_KEYS.unpaidInterest],
    values[FIELD_KEYS.accruedInterest], values[FIELD_KEYS.interestGuarantee],
    values[FIELD_KEYS.unpaidDefaultInterest], values[FIELD_KEYS.accruedDefaultInterest],
    values[FIELD_KEYS.chargesOwed], values[FIELD_KEYS.chargesInterest],
    values[FIELD_KEYS.unpaidOther],
  ]);

  const calculatedTotalBalanceDue = useMemo(() => {
    return (
      parseNum(FIELD_KEYS.principal) +
      parseNum(FIELD_KEYS.unpaidInterest) +
      parseNum(FIELD_KEYS.accruedInterest) +
      parseNum(FIELD_KEYS.chargesOwed) +
      parseNum(FIELD_KEYS.chargesInterest) +
      parseNum(FIELD_KEYS.unpaidOther)
    );
  }, [
    values[FIELD_KEYS.principal], values[FIELD_KEYS.unpaidInterest],
    values[FIELD_KEYS.accruedInterest], values[FIELD_KEYS.chargesOwed],
    values[FIELD_KEYS.chargesInterest], values[FIELD_KEYS.unpaidOther],
  ]);

  const calculatedEstimatedBalloon = useMemo(() => {
    const loanAmount = parseNum(FIELD_KEYS.loanAmount);
    const noteRate = parseNum(FIELD_KEYS.noteRate);
    const oneMonthInterest = loanAmount * (noteRate / 100) / 12;
    return calculatedTotalBalanceDue + oneMonthInterest;
  }, [calculatedTotalBalanceDue, values[FIELD_KEYS.loanAmount], values[FIELD_KEYS.noteRate]]);

  const renderReadOnlyCurrencyField = (value: number, label: string, labelClassName?: string) => {
    const displayValue = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
    return (
      <div className="flex items-center gap-3">
        <Label className={labelClassName || LABEL_CLASS}>{label}</Label>
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
          <Input
            value={displayValue}
            disabled
            className="h-8 text-sm pl-7 bg-muted/50"
            readOnly
          />
        </div>
      </div>
    );
  };

  const [focusedCurrencyField, setFocusedCurrencyField] = useState<string | null>(null);

  const formatCurrencyDisplay = useCallback((val: string) => {
    if (!val) return "";
    const num = parseFloat(val);
    if (isNaN(num)) return val;
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  }, []);

  const handleCurrencyChange = useCallback((key: string, raw: string) => {
    // Strip everything except digits and decimal (no negative values)
    const cleaned = raw.replace(/[^0-9.]/g, "");
    setValue(key, cleaned);
  }, []);

  const handleCurrencyBlur = useCallback(
    (key: string) => {
      setFocusedCurrencyField(null);
      const val = getValue(key);
      if (!val) return;
      const num = parseFloat(val);
      if (!isNaN(num)) {
        setValue(key, num.toFixed(2));
      }
    },
    [values],
  );

  const renderCurrencyField = (key: string, label: string, labelClassName?: string) => {
    const isFocused = focusedCurrencyField === key;
    const rawValue = getValue(key);
    const displayValue = isFocused ? rawValue : formatCurrencyDisplay(rawValue);

    return (
      <DirtyFieldWrapper fieldKey={key}>
        <div className="flex items-center gap-3">
          <Label className={labelClassName || LABEL_CLASS}>{label}</Label>
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
            <Input
              id={key}
              value={displayValue}
              onChange={(e) => handleCurrencyChange(key, e.target.value)}
              onFocus={() => setFocusedCurrencyField(key)}
              onBlur={() => handleCurrencyBlur(key)}
              disabled={disabled}
              className="h-8 text-sm pl-7"
              placeholder="0.00"
            />
          </div>
        </div>
      </DirtyFieldWrapper>
    );
  };

  const [focusedPercentField, setFocusedPercentField] = useState<string | null>(null);

  const formatPercentDisplay = useCallback((val: string) => {
    if (!val) return "";
    // Smart-trim: min 2dp, max 3dp for interest/sold rates (per platform standard).
    return smartPercentDisplay(val, 3);
  }, []);

  const renderPercentField = (key: string, label: string) => {
    const isFocused = focusedPercentField === key;
    const rawValue = getValue(key);
    const displayValue = isFocused ? rawValue : formatPercentDisplay(rawValue);
    return (
      <DirtyFieldWrapper fieldKey={key}>
        <div className="flex items-center gap-2">
          <Label className={LABEL_CLASS}>{label}</Label>
          <div className="relative flex-1">
            <Input
              type="text"
              value={displayValue}
              onChange={(e) => setValue(key, sanitizeInterestInput(e.target.value))}
              onFocus={() => setFocusedPercentField(key)}
              onBlur={() => {
                setFocusedPercentField(null);
                // Store rates at 4 decimal places (platform-wide standard).
                const stored = roundPctForStorage(getValue(key));
                if (stored !== getValue(key) && stored !== '') setValue(key, stored);
              }}
              disabled={disabled}
              className="h-8 text-sm pr-7"
              placeholder="0.00"
              inputMode="decimal"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">%</span>
          </div>
        </div>
      </DirtyFieldWrapper>
    );
  };

  const [datePickerStates, setDatePickerStates] = useState<Record<string, boolean>>({});

  const safeParseDateStr = (val: string): Date | undefined => {
    if (!val) return undefined;
    try {
      const d = parse(val, 'yyyy-MM-dd', new Date());
      return isValid(d) ? d : undefined;
    } catch { return undefined; }
  };

  const renderDateField = (key: string, label: string) => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center gap-3">
        <Label className={LABEL_CLASS}>{label}</Label>
        <Popover open={datePickerStates[key] || false} onOpenChange={(open) => setDatePickerStates(prev => ({ ...prev, [key]: open }))}>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn('h-8 text-sm flex-1 justify-start text-left font-normal', !getValue(key) && 'text-muted-foreground')} disabled={disabled}>
              {getValue(key) && safeParseDateStr(getValue(key)) ? format(safeParseDateStr(getValue(key))!, 'MM/dd/yyyy') : 'MM/DD/YYYY'}
              <CalendarIcon className="ml-auto h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 z-[9999]" align="start">
            <EnhancedCalendar
              mode="single"
              selected={safeParseDateStr(getValue(key))}
              onSelect={(date) => { if (date) setValue(key, format(date, 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, [key]: false })); }}
              onClear={() => { setValue(key, ''); setDatePickerStates(prev => ({ ...prev, [key]: false })); }}
              onToday={() => { setValue(key, format(new Date(), 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, [key]: false })); }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
    </DirtyFieldWrapper>
  );

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Terms Column */}
        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-foreground border-b border-border pb-2">Terms</h3>
          <div className="space-y-2">
            {renderCurrencyField(FIELD_KEYS.loanAmount, "Loan Amount")}
            {renderCurrencyField(FIELD_KEYS.originalAmount, "Original Amount")}
            {renderPercentField(FIELD_KEYS.noteRate, "Note Rate")}

            {/* Sold Rate with checkbox + single editable % field.
                When checked, the Sold Rate value (stored in soldRateCompany) becomes the
                Lender Rate prefill on every Funding row. The other allocation sub-fields
                (Origination Vendor / Company) are intentionally not shown for Sold Rate. */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 w-[140px] min-w-[140px] max-w-[140px] shrink-0">
                <Checkbox
                  id={`${FIELD_KEYS.soldRateEnabled}-cb`}
                  checked={isChecked(FIELD_KEYS.soldRateEnabled)}
                  onCheckedChange={() => {
                    const wasChecked = isChecked(FIELD_KEYS.soldRateEnabled);
                    toggleCheck(FIELD_KEYS.soldRateEnabled);
                    if (wasChecked) {
                      setValue(FIELD_KEYS.soldRateCompany, '');
                      setValue(FIELD_KEYS.soldRateOtherClient1, '');
                      setValue(FIELD_KEYS.soldRateOtherClient2, '');
                      setLendersBlurred(false);
                    }
                  }}
                  disabled={disabled}
                  className="h-3.5 w-3.5"
                />
                {isChecked(FIELD_KEYS.soldRateEnabled) ? (
                  <button
                    type="button"
                    onClick={() => nav?.setActiveTab('funding')}
                    className="text-sm text-primary font-medium underline-offset-2 hover:underline cursor-pointer bg-transparent p-0 border-0"
                    title="Open Funding grid"
                  >
                    Sold Rate
                  </button>
                ) : (
                  <Label htmlFor={`${FIELD_KEYS.soldRateEnabled}-cb`} className="text-sm text-primary font-medium">
                    Sold Rate
                  </Label>
                )}
              </div>
              <div className="relative flex-1">
                <Input
                  value={getValue(FIELD_KEYS.soldRateCompany)}
                  onChange={(e) => setValue(FIELD_KEYS.soldRateCompany, sanitizeInterestInput(e.target.value))}
                  onBlur={() => {
                    const v = normalizeInterestOnBlur(getValue(FIELD_KEYS.soldRateCompany), 2);
                    if (v !== getValue(FIELD_KEYS.soldRateCompany)) setValue(FIELD_KEYS.soldRateCompany, v);
                  }}
                  disabled={disabled}
                  className="h-8 text-sm pr-7"
                  placeholder="0.00"
                  inputMode="decimal"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">%</span>
              </div>
            </div>

            {/* Interest Split */}
            <div className="flex items-center gap-2 py-1">
              <Checkbox
                id={`${FIELD_KEYS.interestSplitEnabled}-cb`}
                checked={isChecked(FIELD_KEYS.interestSplitEnabled)}
                onCheckedChange={() => toggleCheck(FIELD_KEYS.interestSplitEnabled)}
                disabled={disabled}
                className="h-3.5 w-3.5"
              />
              <Label htmlFor={`${FIELD_KEYS.interestSplitEnabled}-cb`} className="text-sm text-primary font-medium">
                Interest Split
              </Label>
            </div>

            {/* Unearned Discount Balance */}
            <div className="flex items-center gap-3">
              <Label className={LABEL_CLASS}>Unearned Disc. Bal.</Label>
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                <Input
                  value={focusedCurrencyField === FIELD_KEYS.unearnedDiscountBalance ? getValue(FIELD_KEYS.unearnedDiscountBalance) : formatCurrencyDisplay(getValue(FIELD_KEYS.unearnedDiscountBalance))}
                  onChange={(e) => handleCurrencyChange(FIELD_KEYS.unearnedDiscountBalance, e.target.value)}
                  onFocus={() => setFocusedCurrencyField(FIELD_KEYS.unearnedDiscountBalance)}
                  onBlur={() => handleCurrencyBlur(FIELD_KEYS.unearnedDiscountBalance)}
                  disabled={disabled}
                  className="h-8 text-sm pl-7"
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Accrual Method */}
            <div className="flex items-center gap-3">
              <Label className={LABEL_CLASS}>Accrual Method</Label>
              <Select
                value={getValue(FIELD_KEYS.accrualMethod)}
                onValueChange={(value) => setValue(FIELD_KEYS.accrualMethod, value)}
                disabled={disabled}
              >
                <SelectTrigger className="h-8 text-sm flex-1">
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  {ACCRUAL_METHOD_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Prepaid Payments */}
            <div className="flex items-center gap-3">
              <div className="w-[140px] min-w-[140px] max-w-[140px] shrink-0">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`${FIELD_KEYS.prepaidPaymentsEnabled}-cb`}
                    checked={isChecked(FIELD_KEYS.prepaidPaymentsEnabled)}
                    onCheckedChange={() => toggleCheck(FIELD_KEYS.prepaidPaymentsEnabled)}
                    disabled={disabled}
                    className="h-3.5 w-3.5"
                  />
                  <Label htmlFor={`${FIELD_KEYS.prepaidPaymentsEnabled}-cb`} className="text-sm">
                    Prepaid Payments
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground pl-5">Months</p>
              </div>
              <Input
                value={getValue(FIELD_KEYS.prepaidPaymentsMonths)}
                onChange={(e) => setValue(FIELD_KEYS.prepaidPaymentsMonths, e.target.value)}
                disabled={disabled}
                className="h-8 text-sm flex-1"
              />
            </div>

            {/* Impounded Payments */}
            <div className="flex items-center gap-3">
              <div className="w-[140px] min-w-[140px] max-w-[140px] shrink-0">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`${FIELD_KEYS.impoundedPaymentsEnabled}-cb`}
                    checked={isChecked(FIELD_KEYS.impoundedPaymentsEnabled)}
                    onCheckedChange={() => toggleCheck(FIELD_KEYS.impoundedPaymentsEnabled)}
                    disabled={disabled}
                    className="h-3.5 w-3.5"
                  />
                  <Label htmlFor={`${FIELD_KEYS.impoundedPaymentsEnabled}-cb`} className="text-sm">
                    Impounded Payments
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground pl-5">Months</p>
              </div>
              <Input
                value={getValue(FIELD_KEYS.impoundedPaymentsMonths)}
                onChange={(e) => setValue(FIELD_KEYS.impoundedPaymentsMonths, e.target.value)}
                disabled={disabled}
                className="h-8 text-sm flex-1"
              />
            </div>

            {/* Funding Holdback */}
            <div className="flex items-center gap-3">
              <div className="w-[140px] min-w-[140px] max-w-[140px] shrink-0">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`${FIELD_KEYS.fundingHoldbackEnabled}-cb`}
                    checked={isChecked(FIELD_KEYS.fundingHoldbackEnabled)}
                    onCheckedChange={() => toggleCheck(FIELD_KEYS.fundingHoldbackEnabled)}
                    disabled={disabled}
                    className="h-3.5 w-3.5"
                  />
                  <Label htmlFor={`${FIELD_KEYS.fundingHoldbackEnabled}-cb`} className="text-sm">
                    Funding Holdback
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground pl-5">Held By</p>
              </div>
              <div className="relative w-[110px] shrink-0">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                <Input
                  value={focusedCurrencyField === FIELD_KEYS.fundingHoldbackAmount ? getValue(FIELD_KEYS.fundingHoldbackAmount) : formatCurrencyDisplay(getValue(FIELD_KEYS.fundingHoldbackAmount))}
                  onChange={(e) => handleCurrencyChange(FIELD_KEYS.fundingHoldbackAmount, e.target.value)}
                  onFocus={() => setFocusedCurrencyField(FIELD_KEYS.fundingHoldbackAmount)}
                  onBlur={() => handleCurrencyBlur(FIELD_KEYS.fundingHoldbackAmount)}
                  disabled={disabled}
                  className="h-8 text-sm pl-7"
                  placeholder="0.00"
                />
              </div>
              <Select
                value={getValue(FIELD_KEYS.fundingHoldbackHeldBy)}
                onValueChange={(value) => setValue(FIELD_KEYS.fundingHoldbackHeldBy, value)}
                disabled={disabled}
              >
                <SelectTrigger className="h-8 text-sm flex-1">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lender">Lender</SelectItem>
                  <SelectItem value="company">Company</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Shortpay / Overpay Handling */}
            <div className="pt-2">
              <h4 className="font-semibold text-xs text-foreground border-b border-border/50 pb-1 mb-2">Shortpay / Overpay Handling</h4>
              <div className="space-y-2">
                <DirtyFieldWrapper fieldKey={FIELD_KEYS.shortPaymentHandling}>
                  <div className="flex items-center gap-3">
                    <Label className={LABEL_CLASS}>Short Payment Handling</Label>
                    <Select
                      value={getValue(FIELD_KEYS.shortPaymentHandling) || undefined}
                      onValueChange={(value) => setValue(FIELD_KEYS.shortPaymentHandling, value)}
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-8 text-sm flex-1">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="do_not_accept">Do Not Accept</SelectItem>
                        <SelectItem value="deposit_to_suspense">Deposit to Suspense</SelectItem>
                        <SelectItem value="apply_to_payment">Apply to Payment</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </DirtyFieldWrapper>
                <DirtyFieldWrapper fieldKey={FIELD_KEYS.applyToPaymentParameters}>
                  <div className="flex items-center gap-3">
                    <Label className={LABEL_CLASS}>Apply to Pmt Params</Label>
                    <div className="flex items-center gap-3 flex-1">
                      <label className="flex items-center gap-1 text-sm cursor-pointer">
                        <Checkbox
                          checked={getValue(FIELD_KEYS.applyToPaymentParameters) === 'percent'}
                          onCheckedChange={(c) => setValue(FIELD_KEYS.applyToPaymentParameters, c ? 'percent' : '')}
                          disabled={disabled}
                          className="h-3.5 w-3.5"
                        />
                        <span>%</span>
                      </label>
                      <span className="text-xs text-muted-foreground">or</span>
                      <label className="flex items-center gap-1 text-sm cursor-pointer">
                        <Checkbox
                          checked={getValue(FIELD_KEYS.applyToPaymentParameters) === 'dollar'}
                          onCheckedChange={(c) => setValue(FIELD_KEYS.applyToPaymentParameters, c ? 'dollar' : '')}
                          disabled={disabled}
                          className="h-3.5 w-3.5"
                        />
                        <span>$</span>
                      </label>
                    </div>
                  </div>
                </DirtyFieldWrapper>
                <DirtyFieldWrapper fieldKey={FIELD_KEYS.applyShortPayment}>
                  <div className="flex items-center gap-3">
                    <Label className={LABEL_CLASS}>Apply Short Payment</Label>
                    <Select
                      value={getValue(FIELD_KEYS.applyShortPayment) || undefined}
                      onValueChange={(value) => setValue(FIELD_KEYS.applyShortPayment, value)}
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-8 text-sm flex-1">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="apply_short_pay">Apply Short Pay</SelectItem>
                        <SelectItem value="unpaid_interest">Unpaid Interest</SelectItem>
                        <SelectItem value="add_to_principal">Add to Principal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </DirtyFieldWrapper>
              </div>
            </div>

            {/* Unpaid Interest Processing */}
            <div className="pt-2">
              <h4 className="font-semibold text-xs text-foreground border-b border-border/50 pb-1 mb-2">Unpaid Interest Processing</h4>
              <div className="space-y-2">
                <DirtyFieldWrapper fieldKey={FIELD_KEYS.unpaidInterestProcessing}>
                  <div className="flex items-center gap-3">
                    <Label className={LABEL_CLASS}>Processing</Label>
                    <Select
                      value={getValue(FIELD_KEYS.unpaidInterestProcessing) || undefined}
                      onValueChange={(value) => setValue(FIELD_KEYS.unpaidInterestProcessing, value)}
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-8 text-sm flex-1">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pay_automatically">Pay Automatically</SelectItem>
                        <SelectItem value="manual">Manual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </DirtyFieldWrapper>
                <DirtyFieldWrapper fieldKey={FIELD_KEYS.payAutomatically}>
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id={`${FIELD_KEYS.payAutomatically}-cb`}
                      checked={isChecked(FIELD_KEYS.payAutomatically)}
                      onCheckedChange={() => toggleCheck(FIELD_KEYS.payAutomatically)}
                      disabled={disabled}
                      className="h-3.5 w-3.5"
                    />
                    <Label htmlFor={`${FIELD_KEYS.payAutomatically}-cb`} className="text-sm">Pay Automatically</Label>
                  </div>
                </DirtyFieldWrapper>
                <DirtyFieldWrapper fieldKey={FIELD_KEYS.calculateInterestOnInterest}>
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id={`${FIELD_KEYS.calculateInterestOnInterest}-cb`}
                      checked={isChecked(FIELD_KEYS.calculateInterestOnInterest)}
                      onCheckedChange={() => toggleCheck(FIELD_KEYS.calculateInterestOnInterest)}
                      disabled={disabled}
                      className="h-3.5 w-3.5"
                    />
                    <Label htmlFor={`${FIELD_KEYS.calculateInterestOnInterest}-cb`} className="text-sm">Calculate Interest on Interest</Label>
                  </div>
                </DirtyFieldWrapper>
              </div>
            </div>

            {/* Accept Short, Post-maturity, Auto-post, Override - part of Interest Split section */}
            <div className="space-y-2 pt-1">
              {/* Accept Short Payments */}
              <div>
                <div className="flex items-center gap-3">
                  <div className="w-[140px] min-w-[140px] max-w-[140px] shrink-0">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`${FIELD_KEYS.acceptShortPaymentsEnabled}-cb`}
                        checked={isChecked(FIELD_KEYS.acceptShortPaymentsEnabled)}
                        onCheckedChange={() => toggleCheck(FIELD_KEYS.acceptShortPaymentsEnabled)}
                        disabled={disabled}
                        className="h-3.5 w-3.5"
                      />
                      <Label htmlFor={`${FIELD_KEYS.acceptShortPaymentsEnabled}-cb`} className="text-sm">
                        Accept Short Payments
                      </Label>
                    </div>
                  </div>
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">{isChecked(FIELD_KEYS.acceptShortPaymentsOrPercent) ? '%' : '$'}</span>
                    <Input
                      value={
                        isChecked(FIELD_KEYS.acceptShortPaymentsOrPercent)
                          ? getValue(FIELD_KEYS.acceptShortPaymentsAmount)
                          : focusedCurrencyField === FIELD_KEYS.acceptShortPaymentsAmount
                            ? getValue(FIELD_KEYS.acceptShortPaymentsAmount)
                            : formatCurrencyDisplay(getValue(FIELD_KEYS.acceptShortPaymentsAmount))
                      }
                      onChange={(e) =>
                        isChecked(FIELD_KEYS.acceptShortPaymentsOrPercent)
                          ? setValue(FIELD_KEYS.acceptShortPaymentsAmount, e.target.value)
                          : handleCurrencyChange(FIELD_KEYS.acceptShortPaymentsAmount, e.target.value)
                      }
                      onFocus={() => { if (!isChecked(FIELD_KEYS.acceptShortPaymentsOrPercent)) setFocusedCurrencyField(FIELD_KEYS.acceptShortPaymentsAmount); }}
                      onBlur={() => { if (!isChecked(FIELD_KEYS.acceptShortPaymentsOrPercent)) handleCurrencyBlur(FIELD_KEYS.acceptShortPaymentsAmount); }}
                      disabled={disabled}
                      className="h-8 text-sm pl-7"
                      placeholder={isChecked(FIELD_KEYS.acceptShortPaymentsOrPercent) ? '-' : '0.00'}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-5 mt-0.5">
                  <span className="text-xs text-muted-foreground">Or</span>
                  <Checkbox
                    id={`${FIELD_KEYS.acceptShortPaymentsOrPercent}-cb`}
                    checked={isChecked(FIELD_KEYS.acceptShortPaymentsOrPercent)}
                    onCheckedChange={() => toggleCheck(FIELD_KEYS.acceptShortPaymentsOrPercent)}
                    disabled={disabled}
                    className="h-3.5 w-3.5"
                  />
                  <Label className="text-xs text-muted-foreground">Percent</Label>
                </div>
              </div>

              {/* Accept Post-maturity */}
              <div className="flex items-center gap-3">
                <Checkbox
                  id={`${FIELD_KEYS.acceptPostMaturity}-cb`}
                  checked={isChecked(FIELD_KEYS.acceptPostMaturity)}
                  onCheckedChange={() => toggleCheck(FIELD_KEYS.acceptPostMaturity)}
                  disabled={disabled}
                  className="h-3.5 w-3.5"
                />
                <Label
                  htmlFor={`${FIELD_KEYS.acceptPostMaturity}-cb`}
                  className="text-sm"
                >
                  Accept Post-maturity
                </Label>
              </div>

              {/* Auto-post Enabled */}
              <div className="flex items-center gap-3">
                <Checkbox
                  id={`${FIELD_KEYS.autoPostEnabled}-cb`}
                  checked={isChecked(FIELD_KEYS.autoPostEnabled)}
                  onCheckedChange={() => toggleCheck(FIELD_KEYS.autoPostEnabled)}
                  disabled={disabled}
                  className="h-3.5 w-3.5"
                />
                <Label
                  htmlFor={`${FIELD_KEYS.autoPostEnabled}-cb`}
                  className="text-sm"
                >
                  Auto-post Enabled
                </Label>
              </div>

              {/* Override Funds Held - last in section */}
              <div className="flex items-center gap-3">
                <div className="w-[140px] min-w-[140px] max-w-[140px] shrink-0">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`${FIELD_KEYS.overrideFundsHeld}-cb`}
                      checked={isChecked(FIELD_KEYS.overrideFundsHeld)}
                      onCheckedChange={() => toggleCheck(FIELD_KEYS.overrideFundsHeld)}
                      disabled={disabled}
                      className="h-3.5 w-3.5"
                    />
                    <Label htmlFor={`${FIELD_KEYS.overrideFundsHeld}-cb`} className="text-sm">
                      Override Funds Held
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground pl-5">Hold Days</p>
                </div>
                <Input
                  value={getValue(FIELD_KEYS.holdDays)}
                  onChange={(e) => setValue(FIELD_KEYS.holdDays, e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => { if (!/\d/.test(e.key) && !['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Home','End'].includes(e.key) && !e.ctrlKey && !e.metaKey) e.preventDefault(); }}
                  disabled={disabled}
                  className="h-8 text-sm flex-1"
                  inputMode="numeric"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Payments Column */}
        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-foreground border-b border-border pb-2">Payments</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Label className={LABEL_CLASS}>No. of Payments</Label>
              <Input
                value={getValue(FIELD_KEYS.numberOfPayments)}
                onChange={(e) => setValue(FIELD_KEYS.numberOfPayments, e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => { if (!/\d/.test(e.key) && !['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Home','End'].includes(e.key) && !e.ctrlKey && !e.metaKey) e.preventDefault(); }}
                disabled={disabled}
                className="h-8 text-sm flex-1"
                inputMode="numeric"
                placeholder="0"
              />
            </div>

            <div className="flex items-center gap-3">
              <Label className={LABEL_CLASS}>Payment Frequency</Label>
              <Select
                value={getValue(FIELD_KEYS.paymentFrequency)}
                onValueChange={(value) => setValue(FIELD_KEYS.paymentFrequency, value)}
                disabled={disabled}
              >
                <SelectTrigger className="h-8 text-sm flex-1">
                  <SelectValue placeholder="Select frequency" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_FREQUENCY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3">
              <Label className={LABEL_CLASS}>Payment Due Date</Label>
              <Input
                value={getValue(FIELD_KEYS.dayDue)}
                onChange={(e) => setValue(FIELD_KEYS.dayDue, e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => { if (!/\d/.test(e.key) && !['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Home','End'].includes(e.key) && !e.ctrlKey && !e.metaKey) e.preventDefault(); }}
                disabled={disabled}
                className="h-8 text-sm flex-1"
                inputMode="numeric"
              />
            </div>

            {renderDateField(FIELD_KEYS.firstPayment, "First Payment Due")}
            {renderDateField(FIELD_KEYS.lastPaymentReceived, "Last Pmt Received")}
            {renderDateField(FIELD_KEYS.paidTo, "Paid To Date")}
            {renderDateField(FIELD_KEYS.nextPayment, "Next Due Date")}
            {renderCurrencyField(FIELD_KEYS.regularPayment, "Regular P & I Payment")}
            {renderCurrencyField(FIELD_KEYS.addedToRegularPayment, "Added to Regular Payment")}
            {renderCurrencyField(FIELD_KEYS.additionalPrincipal, "Additional Principal")}

            {/* Servicing Fees - always currency, independent of Sales Tax */}
            {renderCurrencyField(FIELD_KEYS.servicingFees, "Borrower Servicing Fees")}

            {/* Sales Tax - percentage input */}
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.salesTaxPercent}>
              <div className="flex items-center gap-3">
                <Label className={LABEL_CLASS}>Sales Tax on Servicing Fees</Label>
                <div className="relative flex-1">
                  <Input
                    id={FIELD_KEYS.salesTaxPercent}
                    value={getValue(FIELD_KEYS.salesTaxPercent)}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9.]/g, '');
                      const num = parseFloat(raw);
                      if (raw === '' || raw === '.' || (!isNaN(num) && num <= 100)) {
                        setValue(FIELD_KEYS.salesTaxPercent, raw);
                        // Keep enabled flag in sync
                        if (raw && parseFloat(raw) > 0) {
                          if (!isChecked(FIELD_KEYS.salesTaxEnabled)) setValue(FIELD_KEYS.salesTaxEnabled, 'true');
                        } else {
                          if (isChecked(FIELD_KEYS.salesTaxEnabled)) setValue(FIELD_KEYS.salesTaxEnabled, '');
                        }
                      }
                    }}
                    onBlur={() => {
                      const v = getValue(FIELD_KEYS.salesTaxPercent);
                      if (!v) return;
                      const num = parseFloat(v);
                      if (!isNaN(num)) {
                        const clamped = Math.min(Math.max(num, 0), 100);
                        setValue(FIELD_KEYS.salesTaxPercent, roundPctForStorage(clamped));
                      }
                    }}
                    disabled={disabled}
                    className="h-8 text-sm pr-7"
                    placeholder="0.00"
                    inputMode="decimal"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">%</span>
                </div>
              </div>
            </DirtyFieldWrapper>
            <p className="text-xs text-muted-foreground ml-auto" style={{ maxWidth: 'calc(100% - 152px)', paddingLeft: '0' }}>Percent of Servicing Fees</p>

            {/* Other Scheduled Payments - clickable label opens modal */}
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.otherScheduledPayments}>
              <div className="flex items-center gap-3">
                <Label
                  className={cn(LABEL_CLASS, "text-primary font-medium cursor-pointer hover:underline")}
                  onClick={() => setOtherSchedPmtsOpen(true)}
                >
                  Other Sched. Pmts
                </Label>
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                  <Input
                    id={FIELD_KEYS.otherScheduledPayments}
                    value={focusedCurrencyField === FIELD_KEYS.otherScheduledPayments ? getValue(FIELD_KEYS.otherScheduledPayments) : formatCurrencyDisplay(getValue(FIELD_KEYS.otherScheduledPayments))}
                    onChange={(e) => handleCurrencyChange(FIELD_KEYS.otherScheduledPayments, e.target.value)}
                    onFocus={() => setFocusedCurrencyField(FIELD_KEYS.otherScheduledPayments)}
                    onBlur={() => handleCurrencyBlur(FIELD_KEYS.otherScheduledPayments)}
                    disabled={disabled}
                    className="h-8 text-sm pl-7"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </DirtyFieldWrapper>
            {/* To Escrow Impounds - clickable label navigates to Escrow Impound section */}
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.toEscrowImpounds}>
              <div className="flex items-center gap-3">
                <Label
                  className={cn(LABEL_CLASS, "text-primary font-medium cursor-pointer hover:underline")}
                  onClick={() => navigateToSubSection('escrow_impound')}
                >
                  To Escrow Impounds
                </Label>
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                  <Input
                    id={FIELD_KEYS.toEscrowImpounds}
                    value={focusedCurrencyField === FIELD_KEYS.toEscrowImpounds ? getValue(FIELD_KEYS.toEscrowImpounds) : formatCurrencyDisplay(getValue(FIELD_KEYS.toEscrowImpounds))}
                    onChange={(e) => handleCurrencyChange(FIELD_KEYS.toEscrowImpounds, e.target.value)}
                    onFocus={() => setFocusedCurrencyField(FIELD_KEYS.toEscrowImpounds)}
                    onBlur={() => handleCurrencyBlur(FIELD_KEYS.toEscrowImpounds)}
                    disabled={disabled}
                    className="h-8 text-sm pl-7"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </DirtyFieldWrapper>
            {renderCurrencyField(FIELD_KEYS.toReserves, "To Reserves")}
            {renderCurrencyField(FIELD_KEYS.defaultInterest, "Default Interest")}
            {renderCurrencyField(FIELD_KEYS.totalPayment, "Total Payment")}

            {/* Overpayments Applied To */}
            <div className="pt-3">
              <h4 className="font-semibold text-xs text-foreground border-b border-border/50 pb-1 mb-2">Overpayments Applied To</h4>
              <div className="space-y-2">
                {renderCurrencyField(FIELD_KEYS.overpaymentsUnpaidInterest, "Unpaid Interest")}
                {renderCurrencyField(FIELD_KEYS.overpaymentsShortPayments, "Short Payments")}
                {renderCurrencyField(FIELD_KEYS.overpaymentsProcessingUnpaidInterest, "Processing Unpaid Int.")}
              </div>
            </div>
          </div>
        </div>

        {/* Balances Column */}
        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-foreground border-b border-border pb-2">Balances</h3>
          <div className="space-y-2">
            {renderCurrencyField(FIELD_KEYS.principal, "Principal")}
            {renderCurrencyField(FIELD_KEYS.unpaidLateCharges, "Unpaid Late Charges")}
            {renderCurrencyField(FIELD_KEYS.accruedLateCharges, "Accrued Late Charges")}
            {renderCurrencyField(FIELD_KEYS.unpaidInterest, "Unpaid Interest")}
            {renderCurrencyField(FIELD_KEYS.accruedInterest, "Accrued Interest")}
            {renderCurrencyField(FIELD_KEYS.interestGuarantee, "Interest Guarantee")}
            {renderCurrencyField(FIELD_KEYS.unpaidDefaultInterest, "Unpaid Def. Interest")}
            {renderCurrencyField(FIELD_KEYS.accruedDefaultInterest, "Accrued Def. Interest")}
            {renderCurrencyField(FIELD_KEYS.chargesOwed, "Charges Owed")}
            {renderCurrencyField(FIELD_KEYS.chargesInterest, "Charges Interest")}
            {renderCurrencyField(FIELD_KEYS.unpaidOther, "Unpaid Other")}
            {renderReadOnlyCurrencyField(
              calculatedAmountToReinstate,
              "Amount to Reinstate",
              cn(LABEL_CLASS, "text-primary font-medium"),
            )}
            {/* Reserve Balance - clickable label navigates to Trust Ledger */}
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.reserveBalance}>
              <div className="flex items-center gap-3">
                <Label
                  className={cn(LABEL_CLASS, "text-primary font-medium cursor-pointer hover:underline")}
                  onClick={() => navigateToSubSection('trust_ledger')}
                >
                  Reserve Balance
                </Label>
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                  <Input
                    id={FIELD_KEYS.reserveBalance}
                    value={focusedCurrencyField === FIELD_KEYS.reserveBalance ? getValue(FIELD_KEYS.reserveBalance) : formatCurrencyDisplay(getValue(FIELD_KEYS.reserveBalance))}
                    onChange={(e) => handleCurrencyChange(FIELD_KEYS.reserveBalance, e.target.value)}
                    onFocus={() => setFocusedCurrencyField(FIELD_KEYS.reserveBalance)}
                    onBlur={() => handleCurrencyBlur(FIELD_KEYS.reserveBalance)}
                    disabled={disabled}
                    className="h-8 text-sm pl-7"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </DirtyFieldWrapper>
            {renderCurrencyField(
              FIELD_KEYS.escrowBalance,
              "Escrow Balance",
              cn(LABEL_CLASS, "text-primary font-medium"),
            )}
            {/* Suspense Funds - clickable label navigates to Trust Ledger */}
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.suspenseFunds}>
              <div className="flex items-center gap-3">
                <Label
                  className={cn(LABEL_CLASS, "text-primary font-medium cursor-pointer hover:underline")}
                  onClick={() => navigateToSubSection('trust_ledger')}
                >
                  Suspense Funds
                </Label>
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                  <Input
                    id={FIELD_KEYS.suspenseFunds}
                    value={focusedCurrencyField === FIELD_KEYS.suspenseFunds ? getValue(FIELD_KEYS.suspenseFunds) : formatCurrencyDisplay(getValue(FIELD_KEYS.suspenseFunds))}
                    onChange={(e) => handleCurrencyChange(FIELD_KEYS.suspenseFunds, e.target.value)}
                    onFocus={() => setFocusedCurrencyField(FIELD_KEYS.suspenseFunds)}
                    onBlur={() => handleCurrencyBlur(FIELD_KEYS.suspenseFunds)}
                    disabled={disabled}
                    className="h-8 text-sm pl-7"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </DirtyFieldWrapper>

            {/* Section 6: Total Balance Due & Estimated Balloon Payment */}
            <div className="pt-2 space-y-2">
              <div>
              {renderCurrencyField(
                FIELD_KEYS.totalBalanceDue,
                "Total Balance Due",
                cn(LABEL_CLASS, "text-primary font-medium"),
              )}
                <p className="text-xs text-muted-foreground mt-0.5" style={{ paddingLeft: "0px" }}>
                  * Does not include Close-out Fees
                </p>
              </div>
              <div>
                {renderCurrencyField(
                  FIELD_KEYS.estimatedBalloonPayment,
                  "Estimated Balloon Payment",
                  cn(LABEL_CLASS, "text-primary font-medium"),
                )}
                <p className="text-xs text-muted-foreground mt-0.5" style={{ paddingLeft: "0px" }}>
                  * Does not include Close-out Fees
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Other Scheduled Payments Modal */}
      <Dialog open={otherSchedPmtsOpen} onOpenChange={setOtherSchedPmtsOpen}>
        <DialogContent className="sm:max-w-[500px] z-[9999]" style={{ zIndex: 9999 }}>
          <DialogHeader>
            <DialogTitle>Other Scheduled Payments</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {renderCurrencyField(FIELD_KEYS.otherScheduledPayments, "Amount")}
          </div>
          <DialogFooter className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOtherSchedPmtsOpen(false)} className="flex-shrink-0">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LoanTermsBalancesForm;
