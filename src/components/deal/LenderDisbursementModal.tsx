import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { CalendarIcon } from 'lucide-react';
import { formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dateOnly';
import { cn } from '@/lib/utils';
import { AccountIdSearch } from './AccountIdSearch';
import { ModalSaveConfirmation } from './ModalSaveConfirmation';
import { numericKeyDown, numericPaste, formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';

export interface DisbursementFormData {
  accountId: string;
  name: string;
  debitPercent: string;
  debitOf: 'Payment' | 'Interest' | 'Principal' | 'NA' | '';
  plusAmount: string;
  minimumAmount: string;
  maximumAmount: string;
  startDate: string;
  debitThrough: 'date' | 'amount' | 'payments' | 'payoff' | '';
  debitThroughDate: string;
  debitThroughAmount: string;
  debitThroughPayments: string;
  from: 'Payment' | 'Interest' | 'Principal' | 'NA' | '';
  calculatedAmount: string;
  comments: string;
  overrideEnabled?: boolean;
  overrideReason?: string;
  overrideAmount?: string;
}

const emptyForm = (): DisbursementFormData => ({
  accountId: '',
  name: '',
  debitPercent: '',
  debitOf: '',
  plusAmount: '',
  minimumAmount: '',
  maximumAmount: '',
  startDate: '',
  debitThrough: '',
  debitThroughDate: '',
  debitThroughAmount: '',
  debitThroughPayments: '',
  from: '',
  calculatedAmount: '',
  comments: '',
  overrideEnabled: false,
  overrideReason: '',
  overrideAmount: '',
});

interface ExistingDisbursementRef {
  accountId: string;
  debitThrough?: string;
  calculatedAmount?: string;
  amount?: string;
}

interface LenderDisbursementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: DisbursementFormData) => void;
  editData?: DisbursementFormData | null;
  isEditing?: boolean;
  paymentShare?: number;
  interestShare?: number;
  principalShare?: number;
  /** Other disbursements already configured for this lender row. */
  existingDisbursements?: ExistingDisbursementRef[];
  /** Index of the disbursement being edited (excluded from duplicate / total checks). */
  editingIndex?: number | null;
  /** Maximum total disbursement amount allowed (e.g., lender's per-period payment). */
  availablePayment?: number;
  /** Loan origination date (yyyy-MM-dd). Start Date cannot precede this. */
  loanOriginationDate?: string;
  /** Loan maturity date (yyyy-MM-dd). Start Date cannot exceed this. */
  loanMaturityDate?: string;
}

const parseNum = (s: string): number => parseFloat((s || '').toString().replace(/[$,]/g, '')) || 0;

export const LenderDisbursementModal: React.FC<LenderDisbursementModalProps> = ({
  open,
  onOpenChange,
  onSubmit,
  editData,
  isEditing = false,
  paymentShare = 0,
  interestShare = 0,
  principalShare = 0,
  existingDisbursements = [],
  editingIndex = null,
  availablePayment,
  loanOriginationDate,
  loanMaturityDate,
}) => {
  const [formData, setFormData] = useState<DisbursementFormData>(emptyForm());
  const [showConfirm, setShowConfirm] = useState(false);
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [debitDateOpen, setDebitDateOpen] = useState(false);
  const [showAllErrors, setShowAllErrors] = useState(false);

  // Only re-initialize the form when the modal transitions from closed -> open.
  const wasOpenRef = React.useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setFormData(editData ? { ...emptyForm(), ...editData } : emptyForm());
      setShowAllErrors(false);
    }
    wasOpenRef.current = open;
  }, [open, editData]);

  const handleChange = (field: keyof DisbursementFormData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value as any }));
  };

  // Auto-default Type to "NA" when % <= 0; clear "NA" when % becomes > 0
  const debitPercentNum = parseNum(formData.debitPercent);
  const isPercentZeroOrLess = debitPercentNum <= 0;
  useEffect(() => {
    if (isPercentZeroOrLess) {
      if (formData.debitOf !== 'NA') {
        setFormData(prev => ({ ...prev, debitOf: 'NA' }));
      }
    } else if (formData.debitOf === 'NA') {
      setFormData(prev => ({ ...prev, debitOf: '' }));
    }
  }, [isPercentZeroOrLess, formData.debitOf]);

  // Live auto-calculation (preserves existing formula; Rule 5)
  const autoCalculatedAmount = useMemo(() => {
    let base = 0;
    if (formData.debitOf === 'Payment') base = paymentShare;
    else if (formData.debitOf === 'Interest') base = interestShare;
    else if (formData.debitOf === 'Principal') base = principalShare;
    const pct = parseNum(formData.debitPercent);
    const plus = parseNum(formData.plusAmount);
    const min = formData.minimumAmount ? parseNum(formData.minimumAmount) : null;
    const max = formData.maximumAmount ? parseNum(formData.maximumAmount) : null;
    let calc = base * (pct / 100) + plus;
    if (min !== null && calc < min) calc = min;
    if (max !== null && calc > max) calc = max;
    return calc;
  }, [formData.debitOf, formData.debitPercent, formData.plusAmount, formData.minimumAmount, formData.maximumAmount, paymentShare, interestShare, principalShare]);

  // Effective amount: override value if enabled, else auto-calc (Rule 13/14)
  const effectiveAmount = formData.overrideEnabled
    ? parseNum(formData.overrideAmount || '')
    : autoCalculatedAmount;

  // Sync calculatedAmount into form for persistence
  useEffect(() => {
    setFormData(prev => ({ ...prev, calculatedAmount: effectiveAmount.toFixed(2) }));
  }, [effectiveAmount]);

  // ---- Per-rule validation ----
  const startDateValue = parseDateOnly(formData.startDate);
  const debitDateValue = parseDateOnly(formData.debitThroughDate);
  const origDate = loanOriginationDate ? parseDateOnly(loanOriginationDate) : null;
  const matDate = loanMaturityDate ? parseDateOnly(loanMaturityDate) : null;

  const minNum = formData.minimumAmount ? parseNum(formData.minimumAmount) : null;
  const maxNum = formData.maximumAmount ? parseNum(formData.maximumAmount) : null;
  const plusNum = parseNum(formData.plusAmount);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    // Rule 1
    if (!formData.accountId) e.accountId = 'Payee is required.';
    // Rule 3
    if (formData.debitPercent !== '' && debitPercentNum < 0) e.debitPercent = 'Debit percentage cannot be negative.';
    else if (debitPercentNum > 100) e.debitPercent = 'Debit percentage cannot exceed 100%.';
    // Rule 4
    if (debitPercentNum > 0 && !formData.debitOf) e.debitOf = 'Please select Debit Through option.';
    if (!formData.debitThrough) e.debitThrough = 'Please select Debit Through option.';
    // Rule 8
    if (formData.plusAmount !== '' && plusNum < 0) e.plusAmount = 'Plus amount cannot be negative.';
    // Min/Max sanity
    if (minNum !== null && maxNum !== null && minNum > maxNum) e.minMax = 'Minimum must be ≤ Maximum.';
    // Rule 6 / 7 — only meaningful when override is on (auto-calc clamps already)
    if (formData.overrideEnabled) {
      if (minNum !== null && effectiveAmount < minNum) e.amount = 'Calculated amount cannot be less than minimum amount.';
      else if (maxNum !== null && effectiveAmount > maxNum) e.amount = 'Calculated amount cannot exceed maximum amount.';
    }
    // Rule 9
    if (!formData.startDate) e.startDate = 'Invalid disbursement start date.';
    else if (!startDateValue || isNaN(startDateValue.getTime())) e.startDate = 'Invalid disbursement start date.';
    else if (origDate && startDateValue < origDate) e.startDate = 'Invalid disbursement start date.';
    else if (matDate && startDateValue > matDate) e.startDate = 'Invalid disbursement start date.';
    // Rule 10 — duplicate (same payee + same debitThrough)
    if (formData.accountId && formData.debitThrough) {
      const dupe = existingDisbursements.some((d, idx) =>
        idx !== editingIndex &&
        d.accountId === formData.accountId &&
        (d.debitThrough || '') === formData.debitThrough
      );
      if (dupe) e.duplicate = 'Duplicate disbursement configuration already exists.';
    }
    // Rule 11 — total disbursements vs available payment
    if (typeof availablePayment === 'number' && availablePayment > 0) {
      const others = existingDisbursements.reduce((sum, d, idx) => {
        if (idx === editingIndex) return sum;
        return sum + parseNum(d.calculatedAmount || d.amount || '');
      }, 0);
      if (others + effectiveAmount > availablePayment + 0.005) {
        e.total = 'Total disbursement exceeds available payment amount.';
      }
    }
    // Rule 14 — override reason required
    if (formData.overrideEnabled && !(formData.overrideReason || '').trim()) {
      e.overrideReason = 'Override reason is required.';
    }
    // debitThrough sub-field requirements
    if (formData.debitThrough === 'date' && !formData.debitThroughDate) e.debitThroughDate = 'Date is required.';
    if (formData.debitThrough === 'amount' && !formData.debitThroughAmount) e.debitThroughAmount = 'Amount is required.';
    if (formData.debitThrough === 'payments' && !formData.debitThroughPayments) e.debitThroughPayments = '# Payments is required.';
    return e;
  }, [formData, debitPercentNum, plusNum, minNum, maxNum, effectiveAmount, startDateValue, origDate, matDate, existingDisbursements, editingIndex, availablePayment]);

  const minMaxError = !!errors.minMax;
  const isValid = Object.keys(errors).length === 0;

  // (error-display helpers removed; each error is rendered inline with its own visibility predicate)

  const handleSaveClick = () => {
    if (!isValid) {
      setShowAllErrors(true);
      const firstErr = Object.entries(errors)[0];
      if (firstErr) console.warn('[disbursement-validate]', { field: firstErr[0], message: firstErr[1] });
      return;
    }
    setShowConfirm(true);
  };
  const handleConfirmSave = () => {
    setShowConfirm(false);
    onSubmit({ ...formData, from: formData.debitOf });
    onOpenChange(false);
  };

  const handleCancel = () => onOpenChange(false);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[560px] p-0 gap-0 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 pr-10">
            <span className="text-xs font-bold">Lender Disbursements</span>
          </div>

          <div className="px-3 py-3 space-y-2">
            {/* Payee */}
            <div className="flex items-center gap-1">
              <Label className="text-[11px] font-bold min-w-[80px] shrink-0">Payee</Label>
              <AccountIdSearch
                value={formData.accountId}
                onChange={(accountId, name) => {
                  setFormData(prev => ({
                    ...prev,
                    accountId,
                    ...(name ? { name } : {}),
                  }));
                }}
                className="h-6 text-[11px]"
              />
            </div>
            {errFor('accountId', !!formData.accountId === false && showAllErrors) && (
              <p className="text-[10px] text-destructive font-medium pl-[84px]">{errors.accountId}</p>
            )}

            {/* Name (read-only when linked to a payee — Rule 2) */}
            <div className="flex items-center gap-1">
              <Label className="text-[11px] font-bold min-w-[80px] shrink-0">Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                readOnly={!!formData.accountId}
                className={cn('h-6 text-[11px]', formData.accountId && 'bg-muted/30')}
              />
            </div>

            {/* Debit ___% of [Type] */}
            <div className="flex items-center gap-1">
              <Label className="text-[11px] font-bold min-w-[80px] shrink-0">Debit</Label>
              <div className="relative w-[70px]">
                <Input
                  value={formData.debitPercent}
                  onChange={(e) => {
                    // Allow digits + single decimal point + up to 4 decimals, clamp <= 100
                    let v = e.target.value.replace(/[^0-9.]/g, '');
                    const parts = v.split('.');
                    if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
                    const m = v.match(/^(\d{0,3})(?:\.(\d{0,4}))?$/);
                    if (!m && v !== '') return;
                    if (parseFloat(v) > 100) v = '100';
                    handleChange('debitPercent', v);
                  }}
                  onKeyDown={numericKeyDown}
                  className="h-6 text-[11px] pr-5"
                  inputMode="decimal"
                />
                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">%</span>
              </div>
              <span className="text-[11px] text-muted-foreground">of</span>
              <Select
                value={formData.debitOf || undefined}
                onValueChange={(val) => handleChange('debitOf', val)}
                disabled={isPercentZeroOrLess}
              >
                <SelectTrigger className="h-6 text-[11px] w-[110px]">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="!z-[9999]" position="popper" sideOffset={4}>
                  <SelectItem value="Payment">Payment</SelectItem>
                  <SelectItem value="Interest">Interest</SelectItem>
                  <SelectItem value="Principal">Principal</SelectItem>
                  <SelectItem value="NA">NA</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {errors.debitPercent && (showAllErrors || formData.debitPercent !== '') && (
              <p className="text-[10px] text-destructive font-medium pl-[84px]">{errors.debitPercent}</p>
            )}
            {errors.debitOf && showAllErrors && (
              <p className="text-[10px] text-destructive font-medium pl-[84px]">{errors.debitOf}</p>
            )}

            {/* Plus */}
            <div className="flex items-center gap-1">
              <Label className="text-[11px] font-bold min-w-[80px] shrink-0">Plus</Label>
              <div className="relative flex-1">
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span>
                <Input
                  value={formData.plusAmount}
                  onChange={(e) => handleChange('plusAmount', e.target.value.replace(/[^0-9.]/g, ''))}
                  onKeyDown={numericKeyDown}
                  onPaste={(e) => numericPaste(e, (val) => handleChange('plusAmount', val))}
                  onBlur={() => { if (formData.plusAmount) handleChange('plusAmount', formatCurrencyDisplay(formData.plusAmount)); }}
                  onFocus={() => { if (formData.plusAmount) handleChange('plusAmount', unformatCurrencyDisplay(formData.plusAmount)); }}
                  className="h-6 text-[11px] pl-4"
                  inputMode="decimal"
                  placeholder="-"
                />
              </div>
            </div>
            {errors.plusAmount && (
              <p className="text-[10px] text-destructive font-medium pl-[84px]">{errors.plusAmount}</p>
            )}

            {/* Minimum */}
            <div className="flex items-center gap-1">
              <Label className="text-[11px] font-bold min-w-[80px] shrink-0">Minimum</Label>
              <div className="relative flex-1">
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span>
                <Input
                  value={formData.minimumAmount}
                  onChange={(e) => handleChange('minimumAmount', e.target.value.replace(/[^0-9.]/g, ''))}
                  onKeyDown={numericKeyDown}
                  onPaste={(e) => numericPaste(e, (val) => handleChange('minimumAmount', val))}
                  onBlur={() => { if (formData.minimumAmount) handleChange('minimumAmount', formatCurrencyDisplay(formData.minimumAmount)); }}
                  onFocus={() => { if (formData.minimumAmount) handleChange('minimumAmount', unformatCurrencyDisplay(formData.minimumAmount)); }}
                  className="h-6 text-[11px] pl-4"
                  inputMode="decimal"
                  placeholder="-"
                />
              </div>
            </div>

            {/* Maximum */}
            <div className="flex items-center gap-1">
              <Label className="text-[11px] font-bold min-w-[80px] shrink-0">Maximum</Label>
              <div className="relative flex-1">
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span>
                <Input
                  value={formData.maximumAmount}
                  onChange={(e) => handleChange('maximumAmount', e.target.value.replace(/[^0-9.]/g, ''))}
                  onKeyDown={numericKeyDown}
                  onPaste={(e) => numericPaste(e, (val) => handleChange('maximumAmount', val))}
                  onBlur={() => { if (formData.maximumAmount) handleChange('maximumAmount', formatCurrencyDisplay(formData.maximumAmount)); }}
                  onFocus={() => { if (formData.maximumAmount) handleChange('maximumAmount', unformatCurrencyDisplay(formData.maximumAmount)); }}
                  className="h-6 text-[11px] pl-4"
                  inputMode="decimal"
                  placeholder="-"
                />
              </div>
            </div>
            {minMaxError && (
              <p className="text-[10px] text-destructive font-medium pl-[84px]">{errors.minMax}</p>
            )}

            {/* Calculated Amount (read-only unless override enabled — Rule 13/14) */}
            <div className="flex items-center gap-1">
              <Label className="text-[11px] font-bold min-w-[80px] shrink-0">Amount</Label>
              <div className="relative flex-1">
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span>
                <Input
                  value={
                    formData.overrideEnabled
                      ? (formData.overrideAmount || '')
                      : formatCurrencyDisplay(autoCalculatedAmount.toFixed(2))
                  }
                  readOnly={!formData.overrideEnabled}
                  onChange={(e) => handleChange('overrideAmount', e.target.value.replace(/[^0-9.]/g, ''))}
                  onKeyDown={numericKeyDown}
                  onBlur={() => { if (formData.overrideEnabled && formData.overrideAmount) handleChange('overrideAmount', formatCurrencyDisplay(formData.overrideAmount)); }}
                  onFocus={() => { if (formData.overrideEnabled && formData.overrideAmount) handleChange('overrideAmount', unformatCurrencyDisplay(formData.overrideAmount)); }}
                  className={cn('h-6 text-[11px] pl-4 font-semibold', !formData.overrideEnabled && 'bg-muted/30')}
                />
              </div>
            </div>
            {formData.overrideEnabled && (
              <p className="text-[10px] text-muted-foreground pl-[84px]">
                Auto-calculated: ${formatCurrencyDisplay(autoCalculatedAmount.toFixed(2))}
              </p>
            )}
            {errors.amount && (
              <p className="text-[10px] text-destructive font-medium pl-[84px]">{errors.amount}</p>
            )}

            {/* Manual override toggle (Rule 14) */}
            <div className="flex items-center gap-2 pl-[84px]">
              <input
                id="disb-override"
                type="checkbox"
                checked={!!formData.overrideEnabled}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setFormData(prev => ({
                    ...prev,
                    overrideEnabled: enabled,
                    overrideAmount: enabled ? (prev.overrideAmount || autoCalculatedAmount.toFixed(2)) : '',
                    overrideReason: enabled ? prev.overrideReason : '',
                  }));
                }}
                className="h-3 w-3"
              />
              <Label htmlFor="disb-override" className="text-[11px] cursor-pointer select-none">
                Manual override
              </Label>
            </div>
            {formData.overrideEnabled && (
              <>
                <div className="flex items-center gap-1">
                  <Label className="text-[11px] font-bold min-w-[80px] shrink-0">Reason</Label>
                  <Input
                    value={formData.overrideReason || ''}
                    onChange={(e) => handleChange('overrideReason', e.target.value)}
                    placeholder="Required when override is enabled"
                    className="h-6 text-[11px]"
                  />
                </div>
                {errors.overrideReason && (showAllErrors || (formData.overrideReason || '') !== '') && (
                  <p className="text-[10px] text-destructive font-medium pl-[84px]">{errors.overrideReason}</p>
                )}
              </>
            )}

            {errors.duplicate && (
              <p className="text-[10px] text-destructive font-medium pl-[84px]">{errors.duplicate}</p>
            )}
            {errors.total && (
              <p className="text-[10px] text-destructive font-medium pl-[84px]">{errors.total}</p>
            )}


            {/* Start Date */}
            <div className="flex items-center gap-1 pt-1 border-t border-border mt-2">
              <Label className="text-[11px] font-bold min-w-[80px] shrink-0">Start Date</Label>
              <Popover open={startDateOpen} onOpenChange={setStartDateOpen} modal={false}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('h-6 text-[11px] flex-1 justify-start text-left font-normal', !startDateValue && 'text-muted-foreground')}>
                    {startDateValue && !isNaN(startDateValue.getTime()) ? formatDateOnly(startDateValue, 'MM/dd/yyyy') : 'MM/DD/YYYY'}
                    <CalendarIcon className="ml-auto h-3 w-3" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                  <EnhancedCalendar
                    mode="single"
                    selected={startDateValue}
                    onSelect={(d) => { handleChange('startDate', d ? formatDateOnly(d) : ''); setStartDateOpen(false); }}
                    onClear={() => { handleChange('startDate', ''); setStartDateOpen(false); }}
                    onToday={() => { handleChange('startDate', todayDateOnly()); setStartDateOpen(false); }}
                    disabled={(d: Date) => {
                      if (origDate && d < origDate) return true;
                      if (matDate && d > matDate) return true;
                      return false;
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            {errors.startDate && (showAllErrors || !!formData.startDate) && (
              <p className="text-[10px] text-destructive font-medium pl-[84px]">{errors.startDate}</p>
            )}

            {/* Debit Through */}
            <div className="flex items-center gap-1">
              <Label className="text-[11px] font-bold min-w-[80px] shrink-0">Debit Through</Label>
              <Select value={formData.debitThrough || undefined} onValueChange={(val) => handleChange('debitThrough', val)}>
                <SelectTrigger className="h-6 text-[11px] flex-1">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="!z-[9999]" position="popper" sideOffset={4}>
                  <SelectItem value="date">Date</SelectItem>
                  <SelectItem value="amount">Amount</SelectItem>
                  <SelectItem value="payments">Number of Payments</SelectItem>
                  <SelectItem value="payoff">Payoff</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {errors.debitThrough && showAllErrors && (
              <p className="text-[10px] text-destructive font-medium pl-[84px]">{errors.debitThrough}</p>
            )}

            {/* Dynamic field based on selection */}
            {formData.debitThrough === 'date' && (
              <div className="flex items-center gap-1">
                <Label className="text-[11px] min-w-[80px] shrink-0">Date</Label>
                <Popover open={debitDateOpen} onOpenChange={setDebitDateOpen} modal={false}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn('h-6 text-[11px] flex-1 justify-start text-left font-normal', !debitDateValue && 'text-muted-foreground')}>
                      {debitDateValue && !isNaN(debitDateValue.getTime()) ? formatDateOnly(debitDateValue, 'MM/dd/yyyy') : 'MM/DD/YYYY'}
                      <CalendarIcon className="ml-auto h-3 w-3" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                    <EnhancedCalendar
                      mode="single"
                      selected={debitDateValue}
                      onSelect={(d) => { handleChange('debitThroughDate', d ? formatDateOnly(d) : ''); setDebitDateOpen(false); }}
                      onClear={() => { handleChange('debitThroughDate', ''); setDebitDateOpen(false); }}
                      onToday={() => { handleChange('debitThroughDate', todayDateOnly()); setDebitDateOpen(false); }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            )}
            {formData.debitThrough === 'amount' && (
              <div className="flex items-center gap-1">
                <Label className="text-[11px] min-w-[80px] shrink-0">Amount</Label>
                <div className="relative flex-1">
                  <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span>
                  <Input
                    value={formData.debitThroughAmount}
                    onChange={(e) => handleChange('debitThroughAmount', e.target.value.replace(/[^0-9.]/g, ''))}
                    onKeyDown={numericKeyDown}
                    onBlur={() => { if (formData.debitThroughAmount) handleChange('debitThroughAmount', formatCurrencyDisplay(formData.debitThroughAmount)); }}
                    onFocus={() => { if (formData.debitThroughAmount) handleChange('debitThroughAmount', unformatCurrencyDisplay(formData.debitThroughAmount)); }}
                    className="h-6 text-[11px] pl-4"
                    inputMode="decimal"
                    placeholder="-"
                  />
                </div>
              </div>
            )}
            {formData.debitThrough === 'payments' && (
              <div className="flex items-center gap-1">
                <Label className="text-[11px] min-w-[80px] shrink-0"># Payments</Label>
                <Input
                  value={formData.debitThroughPayments}
                  onChange={(e) => handleChange('debitThroughPayments', e.target.value.replace(/[^0-9]/g, ''))}
                  className="h-6 text-[11px] flex-1"
                  inputMode="numeric"
                  placeholder="-"
                />
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0 border-t border-border px-3 py-2">
            <Button variant="outline" size="sm" onClick={handleCancel}>Cancel</Button>
            <Button size="sm" onClick={handleSaveClick}>
              {isEditing ? 'Update' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ModalSaveConfirmation open={showConfirm} onConfirm={handleConfirmSave} onCancel={() => setShowConfirm(false)} />
    </>
  );
};

export default LenderDisbursementModal;
