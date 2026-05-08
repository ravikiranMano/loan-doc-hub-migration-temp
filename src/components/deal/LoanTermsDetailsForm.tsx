import React, { useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { CalendarIcon } from 'lucide-react';
import { format, parse, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import type { FieldDefinition } from '@/hooks/useDealFields';
import type { CalculationResult } from '@/lib/calculationEngine';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';
import { roundPctForStorage, formatPercentDisplay } from '@/lib/precisionFormat';

interface LoanTermsDetailsFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

import { LOAN_TERMS_DETAILS_KEYS } from '@/lib/fieldKeyMap';

// Use central field key map
const FIELD_KEYS = LOAN_TERMS_DETAILS_KEYS;

const LIEN_POSITION_OPTIONS = [
  { value: '1st', label: '1st' }, { value: '2nd', label: '2nd' },
  { value: '3rd', label: '3rd' }, { value: 'other', label: 'Other' },
];
const LOAN_PURPOSE_OPTIONS = [
  { value: 'consumer', label: 'Consumer' }, { value: 'business', label: 'Business' },
];
const RATE_STRUCTURE_OPTIONS = [
  { value: 'frm_fixed_rate', label: 'FRM – Fixed Rate' },
  { value: 'arm_adjustable_rate', label: 'ARM – Adjustable Rate' },
  { value: 'gtm_graduated_terms', label: 'GTM – Graduated Terms' },
  { value: 'other', label: 'Other' },
];
const AMORTIZATION_OPTIONS = [
  { value: 'fully_amortized', label: 'Fully Amortized' },
  { value: 'partially_amortized', label: 'Partially Amortized' },
  { value: 'interest_only', label: 'Interest Only' },
  { value: 'constant_amortization', label: 'Constant Amortization' },
  { value: 'add_on_interest', label: 'Add-On Interest' },
  { value: 'other', label: 'Other' },
];
const INTEREST_CALCULATION_OPTIONS = [
  { value: '360_day_period', label: '360 Day Period' },
  { value: '365_day_period', label: '365 Day Period' },
];
const SHORT_PAYMENTS_OPTIONS = [
  { value: 'principal_balance', label: 'Principal Balance' },
  { value: 'unpaid_interest', label: 'Unpaid Interest' },
];
const PROCESSING_UNPAID_INTEREST_OPTIONS = [
  { value: 'include_when_calculating_interest', label: 'Include when Calculating Interest' },
  { value: 'pay_automatically', label: 'Pay Automatically' },
  { value: 'both', label: 'Both' },
];
const CALCULATION_PERIOD_OPTIONS = [
  { value: 'regular_period', label: 'Regular Period (Due Date to Due Date)' },
  { value: 'actual_days_due_date', label: 'Actual Days (Due Date to Due Date)' },
  { value: 'actual_days_received_date', label: 'Actual Days (Received Date to Received Date)' },
];

// Validation configs
type ValidationConfig = {
  allowedPattern: RegExp;
  validate: (val: string, mandatory?: boolean) => string | null;
};

const VALIDATION_CONFIGS: Record<string, ValidationConfig> = {
  company: {
    allowedPattern: /^[A-Za-z0-9 &.,\-]$/,
    validate: (val) => {
      if (!val) return null;
      if (val.length < 2) return 'Enter a valid company name';
      if (/[@#$%]/.test(val)) return 'Enter a valid company name';
      return null;
    },
  },
  loanNumber: {
    allowedPattern: /^[A-Za-z0-9\-]$/,
    validate: (val) => {
      if (!val) return null;
      if (/\s/.test(val) || !/^[A-Za-z0-9\-]+$/.test(val))
        return 'Enter a valid loan number (alphanumeric, no spaces)';
      return null;
    },
  },
  assignedCsr: {
    allowedPattern: /^[A-Za-z ]$/,
    validate: (val) => {
      if (!val) return null;
      if (!/^[A-Za-z ]+$/.test(val)) return 'Enter a valid name (alphabets only)';
      return null;
    },
  },
  accountNumber: {
    allowedPattern: /^[A-Za-z0-9\-]$/,
    validate: (val, mandatory) => {
      if (!val) return mandatory ? 'Enter a valid account number' : null;
      if (!/^[A-Za-z0-9\-]+$/.test(val)) return 'Enter a valid account number';
      if (val.length < 6 || val.length > 15) return 'Enter a valid account number (6–15 characters)';
      return null;
    },
  },
};

export const LoanTermsDetailsForm: React.FC<LoanTermsDetailsFormProps> = ({
  values,
  onValueChange,
  showValidation = false,
  disabled = false,
}) => {
  const getValue = (key: string) => values[key] || '';
  const setValue = (key: string, value: string) => onValueChange(key, value);
  const getBoolValue = (key: string) => values[key] === 'true';
  const setBoolValue = (key: string, value: boolean) => onValueChange(key, String(value));

  const [validationErrors, setValidationErrors] = useState<Record<string, string | null>>({});

  const [focusedCurrencyField, setFocusedCurrencyField] = useState<string | null>(null);

  const formatCurrencyDisplay = useCallback((val: string) => {
    if (!val) return '';
    const num = parseFloat(val);
    if (isNaN(num)) return val;
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  }, []);

  const handleCurrencyChange = useCallback((key: string, raw: string) => {
    const cleaned = raw.replace(/[^0-9.]/g, '');
    setValue(key, cleaned);
  }, []);

  const handleCurrencyBlur = useCallback((key: string) => {
    setFocusedCurrencyField(null);
    const val = getValue(key);
    if (!val) return;
    const num = parseFloat(val);
    if (!isNaN(num)) {
      setValue(key, num.toFixed(2));
    }
  }, [values]);

  const renderInlineCurrencyField = (fieldKey: string, label: string) => {
    const isFocused = focusedCurrencyField === fieldKey;
    const rawValue = getValue(fieldKey);
    const displayValue = isFocused ? rawValue.replace(/,/g, '') : formatCurrencyDisplay(rawValue);
    return (
      <DirtyFieldWrapper fieldKey={fieldKey}>
        <div className="flex items-center gap-2">
          <Label className="w-[130px] shrink-0 text-xs">{label}</Label>
          <div className="relative flex-1">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
            <Input
              id={fieldKey}
              value={displayValue}
              onChange={(e) => handleCurrencyChange(fieldKey, e.target.value)}
              onFocus={() => setFocusedCurrencyField(fieldKey)}
              onBlur={() => handleCurrencyBlur(fieldKey)}
              disabled={disabled}
              className="h-8 text-xs flex-1 pl-5"
              placeholder="0.00"
            />
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

  const renderInlineDateField = (fieldKey: string, label: string) => (
    <DirtyFieldWrapper fieldKey={fieldKey}>
      <div className="flex items-center gap-2">
        <Label className="w-[130px] shrink-0 text-xs">{label}</Label>
        <Popover open={datePickerStates[fieldKey] || false} onOpenChange={(open) => setDatePickerStates(prev => ({ ...prev, [fieldKey]: open }))}>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn('h-8 text-xs w-[220px] 3xl:w-[280px] justify-start text-left font-normal', !getValue(fieldKey) && 'text-muted-foreground')} disabled={disabled}>
              {getValue(fieldKey) ? format(safeParseDateStr(getValue(fieldKey))!, 'MM/dd/yyyy') : 'MM/DD/YYYY'}
              <CalendarIcon className="ml-auto h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 z-[9999]" align="start">
            <EnhancedCalendar
              mode="single"
              selected={safeParseDateStr(getValue(fieldKey))}
              onSelect={(date) => { if (date) setValue(fieldKey, format(date, 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, [fieldKey]: false })); }}
              onClear={() => { setValue(fieldKey, ''); setDatePickerStates(prev => ({ ...prev, [fieldKey]: false })); }}
              onToday={() => { setValue(fieldKey, format(new Date(), 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, [fieldKey]: false })); }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
    </DirtyFieldWrapper>
  );

  const renderInlineField = (fieldKey: string, label: string) => (
    <DirtyFieldWrapper fieldKey={fieldKey}>
      <div className="flex items-center gap-2">
        <Label className="w-[130px] shrink-0 text-xs">{label}</Label>
        <Input id={fieldKey} value={getValue(fieldKey)} onChange={(e) => setValue(fieldKey, e.target.value)} disabled={disabled} className="h-8 text-xs flex-1" />
      </div>
    </DirtyFieldWrapper>
  );

  const handleValidatedKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, config: ValidationConfig) => {
    if (e.ctrlKey || e.metaKey || e.altKey || ['Backspace', 'Delete', 'Tab', 'Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    if (e.key.length === 1 && !config.allowedPattern.test(e.key)) {
      e.preventDefault();
    }
  };

  const handleValidatedPaste = (e: React.ClipboardEvent<HTMLInputElement>, fieldKey: string, config: ValidationConfig) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text');
    const cleaned = pasted.split('').filter(ch => config.allowedPattern.test(ch)).join('');
    setValue(fieldKey, cleaned);
  };

  const handleValidatedBlur = (fieldKey: string, config: ValidationConfig, mandatory?: boolean) => {
    const trimmed = getValue(fieldKey).trim();
    if (trimmed !== getValue(fieldKey)) setValue(fieldKey, trimmed);
    const error = config.validate(trimmed, mandatory);
    setValidationErrors(prev => ({ ...prev, [fieldKey]: error }));
  };

  const renderValidatedField = (fieldKey: string, label: string, configKey: string) => {
    const config = VALIDATION_CONFIGS[configKey];
    const error = validationErrors[fieldKey];
    return (
      <DirtyFieldWrapper fieldKey={fieldKey}>
        <div className="flex items-center gap-2">
          <Label className="w-[130px] shrink-0 text-xs">{label}</Label>
          <div className="flex-1">
            <Input
              id={fieldKey}
              value={getValue(fieldKey)}
              onChange={(e) => setValue(fieldKey, e.target.value)}
              onKeyDown={(e) => handleValidatedKeyDown(e, config)}
              onPaste={(e) => handleValidatedPaste(e, fieldKey, config)}
              onBlur={() => handleValidatedBlur(fieldKey, config)}
              disabled={disabled}
              className={cn('h-8 text-xs w-full', error && 'border-destructive')}
            />
            {error && <p className="text-destructive text-[10px] mt-0.5">{error}</p>}
          </div>
        </div>
      </DirtyFieldWrapper>
    );
  };

  const renderInlineSelect = (fieldKey: string, label: string, options: { value: string; label: string }[], placeholder: string) => (
    <DirtyFieldWrapper fieldKey={fieldKey}>
      <div className="flex items-center gap-2">
        <Label className="w-[130px] shrink-0 text-xs">{label}</Label>
        <Select value={getValue(fieldKey)} onValueChange={(value) => setValue(fieldKey, value)} disabled={disabled}>
          <SelectTrigger id={fieldKey} className="h-8 text-xs flex-1">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map(option => (<SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
    </DirtyFieldWrapper>
  );

  const renderAdjIntegerField = (fieldKey: string, label: string, suffix: string) => (
    <DirtyFieldWrapper fieldKey={fieldKey}>
      <div className="flex items-center gap-2">
        <Label className="shrink-0 text-xs">{label}</Label>
        <Input
          value={getValue(fieldKey)}
          onChange={(e) => setValue(fieldKey, e.target.value.replace(/\D/g, ''))}
          disabled={disabled}
          className="h-8 text-xs w-[70px]"
          inputMode="numeric"
          placeholder="0"
        />
        <Label className="shrink-0 text-xs">{suffix}</Label>
      </div>
    </DirtyFieldWrapper>
  );

  const renderAdjPercentField = (fieldKey: string, label: string) => (
    <DirtyFieldWrapper fieldKey={fieldKey}>
      <div className="flex items-center gap-2">
        <Label className="shrink-0 text-xs">{label}</Label>
        <div className="relative w-[100px]">
          <Input
            value={getValue(fieldKey)}
            onChange={(e) => {
              const cleaned = e.target.value.replace(/[^0-9.]/g, '');
              setValue(fieldKey, cleaned);
            }}
            onBlur={() => {
              const val = getValue(fieldKey);
              if (val) { const num = parseFloat(val); if (!isNaN(num)) setValue(fieldKey, num.toFixed(2)); }
            }}
            disabled={disabled}
            className="h-8 text-xs pr-5"
            inputMode="decimal"
              placeholder="0.00"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">%</span>
        </div>
      </div>
    </DirtyFieldWrapper>
  );

  const renderAdjCurrencyField = (fieldKey: string, label: string, suffix: string) => (
    <DirtyFieldWrapper fieldKey={fieldKey}>
      <div className="flex items-center gap-2">
        <Label className="shrink-0 text-xs">{label}</Label>
        <div className="relative w-[120px]">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
          <Input
            value={focusedCurrencyField === fieldKey ? getValue(fieldKey).replace(/,/g, '') : formatCurrencyDisplay(getValue(fieldKey))}
            onChange={(e) => handleCurrencyChange(fieldKey, e.target.value)}
            onFocus={() => setFocusedCurrencyField(fieldKey)}
            onBlur={() => handleCurrencyBlur(fieldKey)}
            disabled={disabled}
            className="h-8 text-xs pl-5"
            placeholder="0.00"
          />
        </div>
        <Label className="shrink-0 text-xs">{suffix}</Label>
      </div>
    </DirtyFieldWrapper>
  );

  return (
    <div className="p-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-6 gap-y-0">
        
        {/* Details Column */}
        <div className="space-y-1.5">
          <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2">Details</h3>
          {renderValidatedField(FIELD_KEYS.company, 'Company', 'company')}
          {renderValidatedField(FIELD_KEYS.loanNumber, 'Loan Number', 'loanNumber')}
          {renderValidatedField(FIELD_KEYS.assignedCsr, 'Assigned CSR', 'assignedCsr')}
          {renderInlineDateField(FIELD_KEYS.origination, 'Origination')}
          {renderInlineDateField(FIELD_KEYS.boarding, 'Boarding')}
          {renderInlineDateField(FIELD_KEYS.maturityDate, 'Maturity Date')}
          {/* LTV Ratio – computed read-only field */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.loanToValueRatio}>
            <div className="flex items-center gap-2">
              <Label className="w-[130px] shrink-0 text-xs">LTV Ratio</Label>
              <div className="relative flex-1">
                <Input
                  id={FIELD_KEYS.loanToValueRatio}
                  value={(() => {
                    const loanAmtKey = 'loan_terms.loan_amount';
                    const appraisedKey = 'property1.appraised_value';
                    const loanRaw = values[loanAmtKey] || '';
                    const appraisedRaw = values[appraisedKey] || '';
                    const loan = parseFloat(loanRaw.replace(/[,$]/g, ''));
                    const appraised = parseFloat(appraisedRaw.replace(/[,$]/g, ''));
                    if (isNaN(loan) || isNaN(appraised) || appraised === 0) return '';
                    return ((loan / appraised) * 100).toFixed(2);
                  })()}
                  disabled
                  className="h-8 text-xs flex-1 bg-muted pr-7"
                  placeholder="—"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">%</span>
              </div>
            </div>
          </DirtyFieldWrapper>
        </div>

        {/* Middle Column */}
        <div className="space-y-1.5">
          <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2">&nbsp;</h3>
          {renderInlineSelect(FIELD_KEYS.lienPosition, 'Lien Position', LIEN_POSITION_OPTIONS, 'Select')}
          {renderInlineSelect(FIELD_KEYS.loanPurpose, 'Loan Purpose', LOAN_PURPOSE_OPTIONS, 'Select')}
          {renderInlineSelect(FIELD_KEYS.rateStructure, 'Rate Structure', RATE_STRUCTURE_OPTIONS, 'Select')}
          {getValue(FIELD_KEYS.rateStructure) === 'other' && (
            renderInlineField(FIELD_KEYS.rateStructureOther, 'Other (specify)')
          )}
          {renderInlineSelect(FIELD_KEYS.amortization, 'Amortization', AMORTIZATION_OPTIONS, 'Select')}
          {renderInlineSelect(FIELD_KEYS.interestCalculation, 'Interest Calc', INTEREST_CALCULATION_OPTIONS, 'Select')}
          {renderInlineSelect(FIELD_KEYS.shortPaymentsAppliedTo, 'Apply Short Payments', SHORT_PAYMENTS_OPTIONS, 'Select')}
          {renderInlineSelect(FIELD_KEYS.processingUnpaidInterest, 'Unpaid Interest', PROCESSING_UNPAID_INTEREST_OPTIONS, 'Select')}
          {renderInlineSelect(FIELD_KEYS.calculationPeriod, 'Calc Period', CALCULATION_PERIOD_OPTIONS, 'Select')}
        </div>

        {/* Loan Type Column */}
        <div className="space-y-1.5">
          <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2">Loan Type (can be multiple)</h3>
          {[
            { key: FIELD_KEYS.sellerCarry, label: 'Seller Carry' },
            { key: FIELD_KEYS.aitdWrap, label: 'AITD / Wrap' },
            { key: FIELD_KEYS.rehabConstruction, label: 'Rehab / Construction' },
            { key: FIELD_KEYS.variableArm, label: 'Variable / ARM' },
            { key: FIELD_KEYS.respa, label: 'RESPA' },
            { key: FIELD_KEYS.unsecured, label: 'Unsecured' },
            { key: FIELD_KEYS.crossCollateral, label: 'Cross Collateral' },
            { key: FIELD_KEYS.limitedNoDoc, label: 'Limited / No Doc' },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center space-x-2">
              <Checkbox id={key} checked={getBoolValue(key)} onCheckedChange={(checked) => setBoolValue(key, !!checked)} disabled={disabled} className="h-3.5 w-3.5" />
              <Label htmlFor={key} className="font-normal cursor-pointer text-xs">{label}</Label>
            </div>
          ))}
          <div className="flex items-center space-x-2">
            <Checkbox id={FIELD_KEYS.balloonPayment} checked={getBoolValue(FIELD_KEYS.balloonPayment)} onCheckedChange={(checked) => setBoolValue(FIELD_KEYS.balloonPayment, !!checked)} disabled={disabled} className="h-3.5 w-3.5" />
            <Label htmlFor={FIELD_KEYS.balloonPayment} className="font-normal cursor-pointer text-xs">Balloon Payment</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id={FIELD_KEYS.subordinationProvision} checked={getBoolValue(FIELD_KEYS.subordinationProvision)} onCheckedChange={(checked) => setBoolValue(FIELD_KEYS.subordinationProvision, !!checked)} disabled={disabled} className="h-3.5 w-3.5" />
            <Label htmlFor={FIELD_KEYS.subordinationProvision} className="font-normal cursor-pointer text-xs">Subordination Provision</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id={FIELD_KEYS.loanProvisions} checked={getBoolValue(FIELD_KEYS.loanProvisions)} onCheckedChange={(checked) => setBoolValue(FIELD_KEYS.loanProvisions, !!checked)} disabled={disabled} className="h-3.5 w-3.5" />
            <Label htmlFor={FIELD_KEYS.loanProvisions} className="font-normal cursor-pointer text-xs">Loan Provisions</Label>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id={FIELD_KEYS.parentAccount} checked={getBoolValue(FIELD_KEYS.parentAccount)} onCheckedChange={(checked) => {
              setBoolValue(FIELD_KEYS.parentAccount, !!checked);
              if (!checked) setValidationErrors(prev => ({ ...prev, [FIELD_KEYS.parentAccountValue]: null }));
            }} disabled={disabled} className="h-3.5 w-3.5 mt-2" />
            <Label htmlFor={FIELD_KEYS.parentAccount} className="font-normal cursor-pointer text-xs min-w-[90px] shrink-0 mt-1.5">Parent Account</Label>
            <div>
              <Input
                value={getValue(FIELD_KEYS.parentAccountValue)}
                onChange={(e) => setValue(FIELD_KEYS.parentAccountValue, e.target.value)}
                onKeyDown={(e) => handleValidatedKeyDown(e, VALIDATION_CONFIGS.accountNumber)}
                onPaste={(e) => handleValidatedPaste(e, FIELD_KEYS.parentAccountValue, VALIDATION_CONFIGS.accountNumber)}
                onBlur={() => handleValidatedBlur(FIELD_KEYS.parentAccountValue, VALIDATION_CONFIGS.accountNumber, getBoolValue(FIELD_KEYS.parentAccount))}
                disabled={disabled || !getBoolValue(FIELD_KEYS.parentAccount)}
                className={cn('h-8 text-xs w-[120px]', validationErrors[FIELD_KEYS.parentAccountValue] && 'border-destructive')}
              />
              {validationErrors[FIELD_KEYS.parentAccountValue] && <p className="text-destructive text-[10px] mt-0.5">{validationErrors[FIELD_KEYS.parentAccountValue]}</p>}
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id={FIELD_KEYS.childAccount} checked={getBoolValue(FIELD_KEYS.childAccount)} onCheckedChange={(checked) => {
              setBoolValue(FIELD_KEYS.childAccount, !!checked);
              if (!checked) setValidationErrors(prev => ({ ...prev, [FIELD_KEYS.childAccountValue]: null }));
            }} disabled={disabled} className="h-3.5 w-3.5 mt-2" />
            <Label htmlFor={FIELD_KEYS.childAccount} className="font-normal cursor-pointer text-xs min-w-[90px] shrink-0 mt-1.5">Child Account</Label>
            <div>
              <Input
                value={getValue(FIELD_KEYS.childAccountValue)}
                onChange={(e) => setValue(FIELD_KEYS.childAccountValue, e.target.value)}
                onKeyDown={(e) => handleValidatedKeyDown(e, VALIDATION_CONFIGS.accountNumber)}
                onPaste={(e) => handleValidatedPaste(e, FIELD_KEYS.childAccountValue, VALIDATION_CONFIGS.accountNumber)}
                onBlur={() => handleValidatedBlur(FIELD_KEYS.childAccountValue, VALIDATION_CONFIGS.accountNumber, getBoolValue(FIELD_KEYS.childAccount))}
                disabled={disabled || !getBoolValue(FIELD_KEYS.childAccount)}
                className={cn('h-8 text-xs w-[120px]', validationErrors[FIELD_KEYS.childAccountValue] && 'border-destructive')}
              />
              {validationErrors[FIELD_KEYS.childAccountValue] && <p className="text-destructive text-[10px] mt-0.5">{validationErrors[FIELD_KEYS.childAccountValue]}</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Adjustable / Graduated Loan Details - shown for ARM or GTM */}
      {(getValue(FIELD_KEYS.rateStructure) === 'arm_adjustable_rate' || getValue(FIELD_KEYS.rateStructure) === 'gtm_graduated_terms') && (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-3">Adjustable / Graduated Loan Details</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2">
            {renderAdjIntegerField(FIELD_KEYS.adjInitialRateMonths, 'Initial Adjustable Rate in effect for', 'Months')}
            {renderAdjPercentField(FIELD_KEYS.adjFullyIndexedRate, 'Fully Indexed Interest Rate')}
            {renderAdjPercentField(FIELD_KEYS.adjMaxInterestRate, 'Maximum Interest Rate')}
            {renderAdjCurrencyField(FIELD_KEYS.adjProposedInitialPayment, 'Proposed Initial (Minimum) Loan Payment', 'Monthly')}

            <DirtyFieldWrapper fieldKey={FIELD_KEYS.adjRateIncreasePercent}>
              <div className="flex items-center gap-2">
                <Label className="shrink-0 text-xs">Interest Rate can Increase</Label>
                <div className="relative w-[90px]">
                  <Input
                    value={getValue(FIELD_KEYS.adjRateIncreasePercent)}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/[^0-9.]/g, '');
                      setValue(FIELD_KEYS.adjRateIncreasePercent, cleaned);
                    }}
                    onBlur={() => {
                      const val = getValue(FIELD_KEYS.adjRateIncreasePercent);
                      if (val) { const num = parseFloat(val); if (!isNaN(num)) setValue(FIELD_KEYS.adjRateIncreasePercent, num.toFixed(2)); }
                    }}
                    disabled={disabled}
                    className="h-8 text-xs pr-5"
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">%</span>
                </div>
                <Label className="shrink-0 text-xs">each</Label>
                <Input
                  value={getValue(FIELD_KEYS.adjRateIncreaseMonths)}
                  onChange={(e) => setValue(FIELD_KEYS.adjRateIncreaseMonths, e.target.value.replace(/\D/g, ''))}
                  disabled={disabled}
                  className="h-8 text-xs w-[70px]"
                  inputMode="numeric"
                  placeholder="0"
                />
                <Label className="shrink-0 text-xs">Months</Label>
              </div>
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={FIELD_KEYS.adjPaymentOptionsEndMonths}>
              <div className="flex items-center gap-2">
                <Label className="shrink-0 text-xs">Payment Options end after</Label>
                <Input
                  value={getValue(FIELD_KEYS.adjPaymentOptionsEndMonths)}
                  onChange={(e) => setValue(FIELD_KEYS.adjPaymentOptionsEndMonths, e.target.value.replace(/\D/g, ''))}
                  disabled={disabled}
                  className="h-8 text-xs w-[70px]"
                  inputMode="numeric"
                  placeholder="0"
                />
                <Label className="shrink-0 text-xs">Months or</Label>
                <div className="relative w-[90px]">
                  <Input
                    value={getValue(FIELD_KEYS.adjPaymentOptionsEndPercent)}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/[^0-9.]/g, '');
                      setValue(FIELD_KEYS.adjPaymentOptionsEndPercent, cleaned);
                    }}
                    onBlur={() => {
                      const val = getValue(FIELD_KEYS.adjPaymentOptionsEndPercent);
                      if (val) { const num = parseFloat(val); if (!isNaN(num)) setValue(FIELD_KEYS.adjPaymentOptionsEndPercent, num.toFixed(2)); }
                    }}
                    disabled={disabled}
                    className="h-8 text-xs pr-5"
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">%</span>
                </div>
                <Label className="shrink-0 text-xs">of Original Balance</Label>
              </div>
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={FIELD_KEYS.adjFinalPaymentAmount}>
              <div className="flex items-center gap-2">
                <Label className="shrink-0 text-xs">Borrower must then make principal and interest payments of</Label>
                <div className="relative w-[120px]">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                  <Input
                    value={focusedCurrencyField === FIELD_KEYS.adjFinalPaymentAmount ? getValue(FIELD_KEYS.adjFinalPaymentAmount).replace(/,/g, '') : formatCurrencyDisplay(getValue(FIELD_KEYS.adjFinalPaymentAmount))}
                    onChange={(e) => handleCurrencyChange(FIELD_KEYS.adjFinalPaymentAmount, e.target.value)}
                    onFocus={() => setFocusedCurrencyField(FIELD_KEYS.adjFinalPaymentAmount)}
                    onBlur={() => handleCurrencyBlur(FIELD_KEYS.adjFinalPaymentAmount)}
                    disabled={disabled}
                    className="h-8 text-xs pl-5"
                    placeholder="0.00"
                  />
                </div>
                <Label className="shrink-0 text-xs">for the remaining</Label>
                <Input
                  value={getValue(FIELD_KEYS.adjFinalPaymentMonths)}
                  onChange={(e) => setValue(FIELD_KEYS.adjFinalPaymentMonths, e.target.value.replace(/\D/g, ''))}
                  disabled={disabled}
                  className="h-8 text-xs w-[70px]"
                  inputMode="numeric"
                  placeholder="0"
                />
                <Label className="shrink-0 text-xs">months.</Label>
              </div>
            </DirtyFieldWrapper>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoanTermsDetailsForm;
