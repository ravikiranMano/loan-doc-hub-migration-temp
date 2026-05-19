import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, parseISO, isValid } from 'date-fns';
import type { FieldDefinition } from '@/hooks/useDealFields';
import type { CalculationResult } from '@/lib/calculationEngine';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';
import { DistributionOtherSelect } from './DistributionOtherSelect';
import { sanitizeInterestInput, normalizeInterestOnBlur } from '@/lib/interestValidation';
import {
  numericKeyDown, numericPaste,
  integerKeyDown, integerPaste,
  formatCurrencyDisplay, unformatCurrencyDisplay,
  formatPercentageDisplay
} from '@/lib/numericInputFilter';
import { roundPctForStorage, formatPercentDisplay, sumPercents, toDecimal } from '@/lib/precisionFormat';

// --- Reusable typed input wrappers ---

const PenaltyCurrencyInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}> = ({ value, onChange, disabled, className }) => {
  const [isFocused, setIsFocused] = useState(false);
  const displayValue = isFocused ? unformatCurrencyDisplay(value || '') : formatCurrencyDisplay(value || '');

  return (
    <div className="relative">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">$</span>
      <Input
        value={displayValue}
        onChange={(e) => onChange(e.target.value.replace(/,/g, ''))}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          if (value) {
            const num = parseFloat(value.replace(/,/g, ''));
            if (!isNaN(num)) onChange(num.toFixed(2));
          }
        }}
        onKeyDown={numericKeyDown}
        onPaste={(e) => numericPaste(e, onChange)}
        disabled={disabled}
        inputMode="decimal"
        placeholder="$0.00"
        className={cn('h-7 text-sm pl-5 text-right', className)}
      />
    </div>
  );
};

const PenaltyPercentInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  onBlur?: () => void;
}> = ({ value, onChange, disabled, className, onBlur }) => {
  const [isFocused, setIsFocused] = useState(false);
  // Late charge / prepayment penalty %: max 3 decimals on display per platform standard.
  const displayValue = isFocused ? (value || '') : formatPercentDisplay(value || '', 3);

  return (
    <div className="relative">
      <Input
        value={displayValue}
        onChange={(e) => {
          const raw = e.target.value.replace(/%/g, '').trim();
          onChange(raw);
        }}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          if (value) {
            const num = parseFloat(value);
            if (!isNaN(num)) {
              const clamped = Math.min(100, Math.max(0, num));
              // Store percent at 4 decimal places (platform-wide standard).
              onChange(roundPctForStorage(clamped));
            }
          }
          onBlur?.();
        }}
        onKeyDown={numericKeyDown}
        onPaste={(e) => numericPaste(e, onChange)}
        disabled={disabled}
        inputMode="decimal"
        placeholder="0%"
        className={cn('h-7 text-sm pr-6 text-right', className)}
      />
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">%</span>
    </div>
  );
};

const PenaltyIntegerInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}> = ({ value, onChange, disabled, className }) => (
  <Input
    value={value || ''}
    onChange={(e) => onChange(e.target.value)}
    onKeyDown={integerKeyDown}
    onPaste={(e) => integerPaste(e, onChange)}
    disabled={disabled}
    inputMode="numeric"
    placeholder="0"
    className={cn('h-7 text-sm', className)}
  />
);

interface LoanTermsPenaltiesFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

const TRIGGERED_BY_OPTIONS = [
  { value: 'late_payment_only', label: 'Late Payment Only' },
  { value: 'late_payment_maturity', label: 'Late Payment & Maturity' },
  { value: 'maturity_only', label: 'Maturity Only' },
];

const PRINCIPAL_PAYDOWN_TYPE_OPTIONS = [
  { value: 'Original', label: 'Original' },
  { value: 'Unpaid', label: 'Unpaid' },
];

// Distribution fields component (always percent-based; Company is auto-calculated)
const DistributionFields: React.FC<{
  prefix: string;
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  disabled?: boolean;
  showValidation?: boolean;
}> = ({ prefix, values, onValueChange, disabled, showValidation }) => {
  const lendersRaw = values[`${prefix}.distribution.lenders`] || '';
  const vendorRaw = values[`${prefix}.distribution.origination_vendors`] || '';
  const otherRaw = values[`${prefix}.distribution.other`] || '';
  const lendersVal = parseFloat(lendersRaw) || 0;
  const vendorVal = parseFloat(vendorRaw) || 0;
  const otherVal = parseFloat(otherRaw) || 0;
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const lendersClamped = clamp(lendersVal);
  const vendorClamped = clamp(vendorVal);
  const otherClamped = clamp(otherVal);
  // Use Decimal arithmetic for distribution remainder/total so 33.3333×3 = 99.9999 (no float drift).
  const remainderDec = sumPercents([100, -lendersClamped, -vendorClamped, -otherClamped]);
  const remainder = Math.max(0, remainderDec.toNumber());
  const companyDisplay = disabled
    ? '0.00'
    : ((lendersRaw || vendorRaw || otherRaw) ? roundPctForStorage(remainder) : '');
  const totalDec = sumPercents([lendersClamped, vendorClamped, otherClamped, parseFloat(companyDisplay) || 0]);
  const totalDisplay = formatPercentDisplay(totalDec.toNumber(), 4);

  // Persist computed Company value
  const persistedCompany = values[`${prefix}.distribution.company`] || '';
  useEffect(() => {
    if (companyDisplay !== persistedCompany) {
      onValueChange(`${prefix}.distribution.company`, companyDisplay);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyDisplay]);

  // Force is_percent locked to true (always percent-based now)
  useEffect(() => {
    if (values[`${prefix}.distribution.is_percent`] !== 'true') {
      onValueChange(`${prefix}.distribution.is_percent`, 'true');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lendersIs100 = lendersClamped >= 100;

  // Allocation error UI removed per spec — keep state for compatibility but never show.
  const [lendersBlurred, setLendersBlurred] = useState(false);
  void lendersBlurred; void showValidation;
  const showError = false;

  // If Lenders hits 100, force Origination Vendor to 0 (Company auto = 0).
  useEffect(() => {
    if (lendersIs100 && vendorRaw !== '' && vendorClamped !== 0) {
      onValueChange(`${prefix}.distribution.origination_vendors`, '0.0000');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lendersIs100]);

  // Match Sold Rate sanitization: digits + single decimal point, hard cap at 100.
  const sanitizePct = (val: string) => {
    const cleaned = val.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    const normalized = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : cleaned;
    const n = parseFloat(normalized);
    if (!isNaN(n) && n > 100) return '100';
    return normalized;
  };

  const handleLendersChange = (val: string) => {
    const sanitized = sanitizePct(val);
    const newLenders = parseFloat(sanitized) || 0;
    onValueChange(`${prefix}.distribution.lenders`, sanitized);
    if (newLenders + vendorClamped + otherClamped > 100) {
      const newVendor = Math.max(0, 100 - newLenders - otherClamped);
      onValueChange(`${prefix}.distribution.origination_vendors`, roundPctForStorage(newVendor));
    }
  };

  const handleVendorChange = (val: string) => {
    const sanitized = sanitizePct(val);
    const newVendor = parseFloat(sanitized) || 0;
    const capped = Math.min(newVendor, Math.max(0, 100 - lendersClamped - otherClamped));
    const finalVal = capped === newVendor ? sanitized : roundPctForStorage(capped);
    onValueChange(`${prefix}.distribution.origination_vendors`, finalVal);
  };

  const handleOtherChange = (val: string) => {
    const sanitized = sanitizePct(val);
    const newOther = parseFloat(sanitized) || 0;
    const capped = Math.min(newOther, Math.max(0, 100 - lendersClamped - vendorClamped));
    const finalVal = capped === newOther ? sanitized : roundPctForStorage(capped);
    onValueChange(`${prefix}.distribution.other`, finalVal);
  };

  return (
    <div className="space-y-2 pt-3">
      <div className="flex items-center gap-2 border-b border-border pb-1">
        <h4 className="font-semibold text-sm text-foreground">Distribution</h4>
      </div>
      <div className="space-y-2">
        <DirtyFieldWrapper fieldKey={`${prefix}.distribution.lenders`}>
          <div className="flex items-center gap-3">
            <Label className="text-sm min-w-[160px] max-w-[160px]">Lenders</Label>
            <div className={cn("flex-1 min-w-0", showError && "[&_input]:border-destructive")}>
              <PenaltyPercentInput
                value={lendersRaw}
                onChange={handleLendersChange}
                onBlur={() => setLendersBlurred(true)}
                disabled={disabled}
              />
            </div>
          </div>
        </DirtyFieldWrapper>
        <DirtyFieldWrapper fieldKey={`${prefix}.distribution.origination_vendors`}>
          <div className="flex items-center gap-3">
            <Label className="text-sm min-w-[160px] max-w-[160px]">Origination Vendor</Label>
            <div className={cn("flex-1 min-w-0", showError && "[&_input]:border-destructive")}>
              <PenaltyPercentInput
                value={vendorRaw}
                onChange={handleVendorChange}
                disabled={disabled || lendersIs100}
              />
            </div>
          </div>
        </DirtyFieldWrapper>
        <DirtyFieldWrapper fieldKey={`${prefix}.distribution.company`}>
          <div className="flex items-center gap-3">
            <Label className="text-sm min-w-[160px] max-w-[160px]">Company</Label>
            <div className="flex-1 min-w-0">
              <PenaltyPercentInput
                value={companyDisplay}
                onChange={() => { /* auto-computed, read-only */ }}
                disabled
              />
            </div>
          </div>
        </DirtyFieldWrapper>
        <DirtyFieldWrapper fieldKey={`${prefix}.distribution.other`}>
          <div className="flex items-center gap-3">
            <div className="min-w-[160px] max-w-[160px]">
              <DistributionOtherSelect
                entityId={values[`${prefix}.distribution.other_entity_id`] || ''}
                entityType={values[`${prefix}.distribution.other_entity_type`] || ''}
                entityName={values[`${prefix}.distribution.other_entity_name`] || ''}
                disabled={disabled}
                hasError={otherClamped > 0 && !values[`${prefix}.distribution.other_entity_id`]}
                onChange={(sel) => {
                  onValueChange(`${prefix}.distribution.other_entity_id`, sel?.id || '');
                  onValueChange(`${prefix}.distribution.other_entity_type`, sel?.type || '');
                  onValueChange(`${prefix}.distribution.other_entity_name`, sel?.name || '');
                }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <PenaltyPercentInput
                value={otherRaw}
                onChange={handleOtherChange}
                disabled={disabled}
              />
            </div>
          </div>
        </DirtyFieldWrapper>
        <div className="flex items-center gap-3">
          <Label className="text-sm min-w-[160px] max-w-[160px] font-semibold">Total</Label>
          <div className="flex-1 min-w-0">
            <PenaltyPercentInput
              value={totalDisplay}
              onChange={() => { /* auto-computed, read-only */ }}
              disabled
            />
          </div>
        </div>
        {showError && (
          <p className="text-xs text-destructive w-full">Please allocate remaining percentage in subsequent fields</p>
        )}
      </div>
    </div>
  );
};

// Field row component for consistent layout
const FieldRow: React.FC<{
  label: string;
  children: React.ReactNode;
  fieldKey?: string;
  checkboxValue?: boolean;
  onCheckboxChange?: (checked: boolean) => void;
  disabled?: boolean;
}> = ({ label, children, fieldKey, checkboxValue, onCheckboxChange, disabled }) => {
  const content = (
    <div className="flex items-center gap-3">
      <Label className="text-sm min-w-[160px] max-w-[160px]">{label}</Label>
      {onCheckboxChange !== undefined && (
        <Checkbox
          checked={checkboxValue}
          onCheckedChange={(checked) => onCheckboxChange(!!checked)}
          disabled={disabled}
          className="h-4 w-4"
        />
      )}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
  if (fieldKey) {
    return <DirtyFieldWrapper fieldKey={fieldKey}>{content}</DirtyFieldWrapper>;
  }
  return content;
};

// Late Fee Column (I or II)
const LateFeeColumn: React.FC<{
  title: string;
  prefix: string;
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  disabled?: boolean;
  percentageLabel?: string;
  showValidation?: boolean;
}> = ({ title, prefix, values, onValueChange, disabled, percentageLabel = 'Percentage of Payment', showValidation }) => {
  const isEnabled = values[`${prefix}.enabled`] === 'true';

  return (
    <div className="space-y-2 p-4 border border-border rounded-lg bg-card">
      <DirtyFieldWrapper fieldKey={`${prefix}.enabled`}>
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <h3 className="font-semibold text-sm text-foreground">{title}</h3>
          <Checkbox
            checked={isEnabled}
            onCheckedChange={(checked) => {
              const next = !!checked;
              onValueChange(`${prefix}.enabled`, next ? 'true' : 'false');
              if (!next) {
                // Reset all fields in this Late Fee column to 0 / empty when unchecked
                onValueChange(`${prefix}.type`, '');
                onValueChange(`${prefix}.grace_period`, '0');
                onValueChange(`${prefix}.calendar_actual`, '0');
                onValueChange(`${prefix}.minimum_late_fee`, '0.00');
                onValueChange(`${prefix}.percentage_of_payment`, '0.00');
                onValueChange(`${prefix}.additional_daily_charge`, '0.00');
                onValueChange(`${prefix}.distribution.lenders`, '0.00');
                onValueChange(`${prefix}.distribution.origination_vendors`, '0.00');
                onValueChange(`${prefix}.distribution.company`, '0.00');
              }
            }}
            disabled={disabled}
            className="h-4 w-4"
          />
        </div>
      </DirtyFieldWrapper>

      <div className="space-y-2">
        <FieldRow label="Type" fieldKey={`${prefix}.type`}>
          {(() => {
            const LATE_FEE_TYPE_OPTIONS: { value: string; label: string }[] = [
              { value: 'fixed_amount', label: 'Fixed Amount' },
              { value: 'percentage_of_outstanding_balance', label: 'Percentage of Outstanding Balance' },
              { value: 'daily_fee', label: 'Daily Fee' },
              { value: 'one_time_fee', label: 'One-Time Fee' },
              { value: 'monthly_fee', label: 'Monthly Fee' },
            ];
            const raw = values[`${prefix}.type`] || '';
            // Legacy numeric values (e.g. "0.00") are not valid selections — treat as empty.
            const isLegacyNumeric = raw !== '' && !LATE_FEE_TYPE_OPTIONS.some(o => o.value === raw);
            const current = isLegacyNumeric ? '' : raw;
            const isDisabled = disabled || !isEnabled;
            return (
              <div className="flex items-center gap-1">
                <Select
                  value={current || undefined}
                  onValueChange={(v) => onValueChange(`${prefix}.type`, v)}
                  disabled={isDisabled}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="Select late fee type" />
                  </SelectTrigger>
                  <SelectContent className="z-[9999] bg-popover">
                    {LATE_FEE_TYPE_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {current && !isDisabled && (
                  <button
                    type="button"
                    aria-label="Clear late fee type"
                    onClick={() => onValueChange(`${prefix}.type`, '')}
                    className="text-muted-foreground hover:text-foreground text-xs px-1"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })()}
        </FieldRow>
        <FieldRow label="Grace Period" fieldKey={`${prefix}.grace_period`}>
          <PenaltyIntegerInput
            value={values[`${prefix}.grace_period`] || ''}
            onChange={(val) => onValueChange(`${prefix}.grace_period`, val)}
            disabled={disabled || !isEnabled}
          />
        </FieldRow>
        <FieldRow label="Calendar / Actual" fieldKey={`${prefix}.calendar_actual`}>
          <PenaltyIntegerInput
            value={values[`${prefix}.calendar_actual`] || ''}
            onChange={(val) => onValueChange(`${prefix}.calendar_actual`, val)}
            disabled={disabled || !isEnabled}
          />
        </FieldRow>
        <FieldRow label="Minimum Late Fee" fieldKey={`${prefix}.minimum_late_fee`}>
          <PenaltyCurrencyInput
            value={values[`${prefix}.minimum_late_fee`] || ''}
            onChange={(val) => onValueChange(`${prefix}.minimum_late_fee`, val)}
            disabled={disabled || !isEnabled}
          />
        </FieldRow>
        <FieldRow label={percentageLabel} fieldKey={`${prefix}.percentage_of_payment`}>
          <PenaltyPercentInput
            value={values[`${prefix}.percentage_of_payment`] || ''}
            onChange={(val) => onValueChange(`${prefix}.percentage_of_payment`, val)}
            disabled={disabled || !isEnabled}
          />
        </FieldRow>
        <FieldRow label="Additional Daily Charge" fieldKey={`${prefix}.additional_daily_charge`}>
          <PenaltyCurrencyInput
            value={values[`${prefix}.additional_daily_charge`] || ''}
            onChange={(val) => onValueChange(`${prefix}.additional_daily_charge`, val)}
            disabled={disabled || !isEnabled}
          />
        </FieldRow>
      </div>

      <DistributionFields
        prefix={prefix}
        values={values}
        onValueChange={onValueChange}
        disabled={disabled || !isEnabled}
        showValidation={showValidation && isEnabled}
      />
    </div>
  );
};

// Active Until date picker component
const ActiveUntilDatePicker: React.FC<{
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const selectedDate = value ? parseISO(value) : undefined;
  const isValidDate = selectedDate && isValid(selectedDate);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative w-full">
          <Input
            readOnly
            disabled={disabled}
            value={isValidDate ? format(selectedDate, 'MM/dd/yyyy') : ''}
            placeholder="MM/DD/YYYY"
            className={cn(
              'h-7 text-sm pr-8 cursor-pointer',
              disabled && 'bg-muted cursor-not-allowed'
            )}
          />
          <CalendarIcon className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <EnhancedCalendar
          mode="single"
          selected={isValidDate ? selectedDate : undefined}
          onSelect={(date: Date | undefined) => {
            if (date) {
              onChange(format(date, 'yyyy-MM-dd'));
            } else {
              onChange('');
            }
            setOpen(false);
          }}
          onClear={() => { onChange(''); setOpen(false); }}
          onToday={() => { onChange(format(new Date(), 'yyyy-MM-dd')); setOpen(false); }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
};

// Default Interest Column
const DefaultInterestColumn: React.FC<{
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  disabled?: boolean;
  showValidation?: boolean;
}> = ({ values, onValueChange, disabled, showValidation }) => {
  const prefix = 'loan_terms.penalties.default_interest';
  const isEnabled = values[`${prefix}.enabled`] === 'true';

  return (
    <div className="space-y-2 p-4 border border-border rounded-lg bg-card">
      <DirtyFieldWrapper fieldKey={`${prefix}.enabled`}>
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <h3 className="font-semibold text-sm text-foreground">Default Interest</h3>
          <Checkbox
            checked={isEnabled}
            onCheckedChange={(checked) => onValueChange(`${prefix}.enabled`, checked ? 'true' : 'false')}
            disabled={disabled}
            className="h-4 w-4"
          />
        </div>
      </DirtyFieldWrapper>

      <div className="space-y-2">
        <FieldRow label="Triggered By" fieldKey={`${prefix}.triggered_by`}>
          <Select
            value={values[`${prefix}.triggered_by`] || ''}
            onValueChange={(val) => onValueChange(`${prefix}.triggered_by`, val)}
            disabled={disabled || !isEnabled}
          >
            <SelectTrigger className="h-7 text-sm">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent className="bg-background border border-border z-50">
              {TRIGGERED_BY_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="Grace Period" fieldKey={`${prefix}.grace_period`}>
          <PenaltyIntegerInput
            value={values[`${prefix}.grace_period`] || ''}
            onChange={(val) => onValueChange(`${prefix}.grace_period`, val)}
            disabled={disabled || !isEnabled}
          />
        </FieldRow>
        <FieldRow
          label="Flat Rate"
          fieldKey={`${prefix}.flat_rate`}
          checkboxValue={values[`${prefix}.flat_rate_enabled`] === 'true'}
          onCheckboxChange={(checked) => onValueChange(`${prefix}.flat_rate_enabled`, checked ? 'true' : 'false')}
          disabled={disabled || !isEnabled}
        >
           <Input
            value={values[`${prefix}.flat_rate`] || ''}
            onChange={(e) => onValueChange(`${prefix}.flat_rate`, sanitizeInterestInput(e.target.value))}
            onBlur={() => { const v = normalizeInterestOnBlur(values[`${prefix}.flat_rate`] || '', 3); if (v !== (values[`${prefix}.flat_rate`] || '')) onValueChange(`${prefix}.flat_rate`, v); }}
            disabled={disabled || !isEnabled || values[`${prefix}.flat_rate_enabled`] !== 'true'}
            className="h-7 text-sm"
            inputMode="decimal"
            placeholder="0.00"
          />
        </FieldRow>
        <FieldRow
          label="Modifier"
          fieldKey={`${prefix}.modifier`}
          checkboxValue={values[`${prefix}.modifier_enabled`] === 'true'}
          onCheckboxChange={(checked) => onValueChange(`${prefix}.modifier_enabled`, checked ? 'true' : 'false')}
          disabled={disabled || !isEnabled}
        >
           <Input
            value={values[`${prefix}.modifier`] || ''}
            onChange={(e) => onValueChange(`${prefix}.modifier`, sanitizeInterestInput(e.target.value))}
            onBlur={() => { const v = normalizeInterestOnBlur(values[`${prefix}.modifier`] || '', 3); if (v !== (values[`${prefix}.modifier`] || '')) onValueChange(`${prefix}.modifier`, v); }}
            disabled={disabled || !isEnabled || values[`${prefix}.modifier_enabled`] !== 'true'}
            className="h-7 text-sm"
            inputMode="decimal"
            placeholder="0.00"
          />
        </FieldRow>
        <FieldRow label="Active Until" fieldKey={`${prefix}.active_until`}>
          <ActiveUntilDatePicker
            value={values[`${prefix}.active_until`] || ''}
            onChange={(val) => onValueChange(`${prefix}.active_until`, val)}
            disabled={disabled || !isEnabled}
          />
        </FieldRow>
        <FieldRow label="Additional Daily Charge" fieldKey={`${prefix}.additional_daily_charge`}>
          <PenaltyCurrencyInput
            value={values[`${prefix}.additional_daily_charge`] || ''}
            onChange={(val) => onValueChange(`${prefix}.additional_daily_charge`, val)}
            disabled={disabled || !isEnabled}
          />
        </FieldRow>
      </div>

      <DistributionFields
        prefix={prefix}
        values={values}
        onValueChange={onValueChange}
        disabled={disabled || !isEnabled}
        showValidation={showValidation && isEnabled}
      />
    </div>
  );
};

// Interest Guarantee Section
const InterestGuaranteeSection: React.FC<{
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  disabled?: boolean;
  showValidation?: boolean;
}> = ({ values, onValueChange, disabled, showValidation }) => {
  const prefix = 'loan_terms.penalties.interest_guarantee';
  const isEnabled = values[`${prefix}.enabled`] === 'true';

  return (
    <div className="space-y-2 p-4 border border-border rounded-lg bg-card">
      <DirtyFieldWrapper fieldKey={`${prefix}.enabled`}>
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <h3 className="font-semibold text-sm text-foreground">Interest Guarantee</h3>
          <Checkbox
            checked={isEnabled}
            onCheckedChange={(checked) => onValueChange(`${prefix}.enabled`, checked ? 'true' : 'false')}
            disabled={disabled}
            className="h-4 w-4"
          />
        </div>
      </DirtyFieldWrapper>

      <div className="space-y-2">
        <FieldRow
          label="Months"
          fieldKey={`${prefix}.months`}
          checkboxValue={values[`${prefix}.months_enabled`] === 'true'}
          onCheckboxChange={(checked) => onValueChange(`${prefix}.months_enabled`, checked ? 'true' : 'false')}
          disabled={disabled || !isEnabled}
        >
          <PenaltyIntegerInput
            value={values[`${prefix}.months`] || ''}
            onChange={(val) => onValueChange(`${prefix}.months`, val)}
            disabled={disabled || !isEnabled || values[`${prefix}.months_enabled`] !== 'true'}
          />
        </FieldRow>
        <FieldRow
          label="Include Odd Days Interest"
          fieldKey={`${prefix}.include_odd_days`}
          checkboxValue={values[`${prefix}.include_odd_days`] === 'true'}
          onCheckboxChange={(checked) => onValueChange(`${prefix}.include_odd_days`, checked ? 'true' : 'false')}
          disabled={disabled || !isEnabled}
        >
          <span />
        </FieldRow>
        <FieldRow
          label="Amount"
          fieldKey={`${prefix}.amount`}
          checkboxValue={values[`${prefix}.amount_enabled`] === 'true'}
          onCheckboxChange={(checked) => onValueChange(`${prefix}.amount_enabled`, checked ? 'true' : 'false')}
          disabled={disabled || !isEnabled}
        >
          <PenaltyCurrencyInput
            value={values[`${prefix}.amount`] || ''}
            onChange={(val) => onValueChange(`${prefix}.amount`, val)}
            disabled={disabled || !isEnabled || values[`${prefix}.amount_enabled`] !== 'true'}
          />
        </FieldRow>
      </div>

      <DistributionFields
        prefix={prefix}
        values={values}
        onValueChange={onValueChange}
        disabled={disabled || !isEnabled}
        showValidation={showValidation && isEnabled}
      />
    </div>
  );
};

// Pre-payment Penalty Section
const PrepaymentPenaltySection: React.FC<{
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  disabled?: boolean;
  showValidation?: boolean;
}> = ({ values, onValueChange, disabled, showValidation }) => {
  const prefix = 'loan_terms.penalties.prepayment';
  const isEnabled = values[`${prefix}.enabled`] === 'true';

  return (
    <div className="space-y-2 p-4 border border-border rounded-lg bg-card">
      <DirtyFieldWrapper fieldKey={`${prefix}.enabled`}>
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <h3 className="font-semibold text-sm text-foreground">Pre-payment Penalty</h3>
          <Checkbox
            checked={isEnabled}
            onCheckedChange={(checked) => onValueChange(`${prefix}.enabled`, checked ? 'true' : 'false')}
            disabled={disabled}
            className="h-4 w-4"
          />
        </div>
      </DirtyFieldWrapper>

        <div className="space-y-3">
          <DirtyFieldWrapper fieldKey={`${prefix}.principal_paydown_type`}>
            <div className="flex items-center gap-3">
              <Label className="text-sm min-w-[160px] max-w-[160px]">Principal Paydown Type</Label>
              <div className="flex-1 min-w-0">
                <Select
                  value={values[`${prefix}.principal_paydown_type`] || ''}
                  onValueChange={(val) => onValueChange(`${prefix}.principal_paydown_type`, val)}
                  disabled={disabled || !isEnabled}
                >
                  <SelectTrigger className="h-7 text-sm">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent className="bg-background border border-border z-50">
                    {PRINCIPAL_PAYDOWN_TYPE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={`${prefix}.first_years`}>
            <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
              <span className="whitespace-nowrap">A Principal paydown in the first</span>
              <PenaltyIntegerInput
                value={values[`${prefix}.first_years`] || ''}
                onChange={(val) => onValueChange(`${prefix}.first_years`, val)}
                disabled={disabled || !isEnabled}
                className="h-7 text-sm w-16 shrink-0"
              />
              <span className="whitespace-nowrap">years, greater than</span>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={`${prefix}.greater_than`}>
            <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
              <PenaltyIntegerInput
                value={values[`${prefix}.greater_than`] || ''}
                onChange={(val) => onValueChange(`${prefix}.greater_than`, val)}
                disabled={disabled || !isEnabled}
                className="h-7 text-sm w-16 shrink-0"
              />
              <span className="whitespace-nowrap">of the</span>
              <Select
                value={values[`${prefix}.of_the`] || ''}
                onValueChange={(val) => onValueChange(`${prefix}.of_the`, val)}
                disabled={disabled || !isEnabled}
              >
                <SelectTrigger className="h-7 text-sm w-28 shrink-0">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="bg-background border border-border z-50">
                  <SelectItem value="original">Original</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={`${prefix}.penalty_months`}>
            <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
              <span className="whitespace-nowrap">will result in a penalty of</span>
              <PenaltyIntegerInput
                value={values[`${prefix}.penalty_months`] || ''}
                onChange={(val) => onValueChange(`${prefix}.penalty_months`, val)}
                disabled={disabled || !isEnabled}
                className="h-7 text-sm w-16 shrink-0"
              />
            </div>
          </DirtyFieldWrapper>

          <p className="text-sm text-foreground">months of interest at note rate.</p>
        </div>

      <DistributionFields
        prefix={prefix}
        values={values}
        onValueChange={onValueChange}
        disabled={disabled || !isEnabled}
        showValidation={showValidation && isEnabled}
      />
    </div>
  );
};

// Maturity Section
const MaturitySection: React.FC<{
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  disabled?: boolean;
  showValidation?: boolean;
}> = ({ values, onValueChange, disabled, showValidation }) => {
  const prefix = 'loan_terms.penalties.maturity';
  const isEnabled = values[`${prefix}.enabled`] === 'true';

  return (
    <div className="space-y-2 p-4 border border-border rounded-lg bg-card">
      <DirtyFieldWrapper fieldKey={`${prefix}.enabled`}>
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <h3 className="font-semibold text-sm text-foreground">Maturity</h3>
          <Checkbox
            checked={isEnabled}
            onCheckedChange={(checked) => onValueChange(`${prefix}.enabled`, checked ? 'true' : 'false')}
            disabled={disabled}
            className="h-4 w-4"
          />
        </div>
      </DirtyFieldWrapper>

      <div className="space-y-2">
        <FieldRow label="Grace Period (Days)" fieldKey={`${prefix}.grace_period_days`}>
          <PenaltyIntegerInput
            value={values[`${prefix}.grace_period_days`] || ''}
            onChange={(val) => onValueChange(`${prefix}.grace_period_days`, val)}
            disabled={disabled || !isEnabled}
          />
        </FieldRow>
        <FieldRow
          label="Standard 10% of Payment Only"
          fieldKey={`${prefix}.standard_10_percent`}
          checkboxValue={values[`${prefix}.standard_10_percent`] === 'true'}
          onCheckboxChange={(checked) => onValueChange(`${prefix}.standard_10_percent`, checked ? 'true' : 'false')}
          disabled={disabled || !isEnabled}
        >
          <span />
        </FieldRow>
        <FieldRow
          label="Additional Flat Fee"
          fieldKey={`${prefix}.additional_flat_fee`}
          checkboxValue={values[`${prefix}.additional_flat_fee_enabled`] === 'true'}
          onCheckboxChange={(checked) => onValueChange(`${prefix}.additional_flat_fee_enabled`, checked ? 'true' : 'false')}
          disabled={disabled || !isEnabled}
        >
          <PenaltyCurrencyInput
            value={values[`${prefix}.additional_flat_fee`] || ''}
            onChange={(val) => onValueChange(`${prefix}.additional_flat_fee`, val)}
            disabled={disabled || !isEnabled || values[`${prefix}.additional_flat_fee_enabled`] !== 'true'}
          />
        </FieldRow>
      </div>

      <DistributionFields
        prefix={prefix}
        values={values}
        onValueChange={onValueChange}
        disabled={disabled || !isEnabled}
        showValidation={showValidation && isEnabled}
      />
    </div>
  );
};

export const LoanTermsPenaltiesForm: React.FC<LoanTermsPenaltiesFormProps> = ({
  fields,
  values,
  onValueChange,
  showValidation = false,
  disabled = false,
  calculationResults = {},
}) => {
  return (
    <div className="p-6 space-y-6">
      {/* Top Row - 3 columns: Late Fee I, Late Fee II, Default Interest */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <LateFeeColumn
          title="Late Fee I"
          prefix="loan_terms.penalties.late_charge_1"
          values={values}
          onValueChange={onValueChange}
          disabled={disabled}
          percentageLabel="Percentage of Payment"
          showValidation={showValidation}
        />
        <LateFeeColumn
          title="Late Fee II"
          prefix="loan_terms.penalties.late_charge_2"
          values={values}
          onValueChange={onValueChange}
          disabled={disabled}
          percentageLabel="Percentage of"
          showValidation={showValidation}
        />
        <DefaultInterestColumn
          values={values}
          onValueChange={onValueChange}
          disabled={disabled}
          showValidation={showValidation}
        />
      </div>

      {/* Bottom Row - 3 columns: Interest Guarantee, Pre-payment Penalty, Maturity */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <InterestGuaranteeSection
          values={values}
          onValueChange={onValueChange}
          disabled={disabled}
          showValidation={showValidation}
        />
        <PrepaymentPenaltySection
          values={values}
          onValueChange={onValueChange}
          disabled={disabled}
          showValidation={showValidation}
        />
        <MaturitySection
          values={values}
          onValueChange={onValueChange}
          disabled={disabled}
          showValidation={showValidation}
        />
      </div>
    </div>
  );
};

export default LoanTermsPenaltiesForm;
