import React, { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
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
  { value: 'standard_due_to_due', label: 'Standard Due Date to Due Date' },
  { value: 'actual_due_to_due', label: 'Actual Due Date to Due Date' },
  { value: 'received_to_received', label: 'Received Date to Received Date' },
];
const ACCRUAL_METHOD_OPTIONS = [
  { value: '30_360', label: '30/360' },
  { value: 'actual_360', label: 'Actual/360' },
  { value: 'actual_365', label: 'Actual/365' },
  { value: 'actual_actual', label: 'Actual/Actual' },
];
const LOAN_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'hold', label: 'Hold' },
  { value: 'closed', label: 'Closed' },
];
const HOLD_REASON_OPTIONS = [
  { value: 'w9_document_needed', label: 'W-9 / Document Needed' },
  { value: 'fraud_red_flag', label: 'Fraud / Red Flag' },
  { value: 'payment_issue', label: 'Payment Issue' },
  { value: 'occupancy_concern', label: 'Occupancy Concern' },
  { value: 'pending_workout', label: 'Pending Workout' },
  { value: 'other', label: 'Other' },
];
const CLOSED_REASON_OPTIONS = [
  { value: 'paid', label: 'Paid' },
  { value: 'transfer_out_customer', label: 'Transfer Out (Customer)' },
  { value: 'transfer_out_company', label: 'Transfer Out (Company)' },
  { value: 'dead', label: 'Dead' },
  { value: 'reo', label: 'REO' },
  { value: 'charged_off', label: 'Charged Off' },
  { value: 'other', label: 'Other' },
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
    allowedPattern: /^[A-Za-z0-9]$/,
    validate: (val) => {
      const trimmed = (val || '').trim();
      if (!trimmed) return null;
      if (!/^[A-Za-z0-9]{14}$/.test(trimmed))
        return 'Loan Number must be exactly 14 alphanumeric characters.';
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

  // Brokers list for "Originating Vendor" dropdown — sourced from contacts master (contact_type='broker')
  const [brokerOptions, setBrokerOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, full_name, first_name, last_name, company, contact_id')
        .eq('contact_type', 'broker')
        .order('full_name', { ascending: true });
      if (cancelled || error || !data) return;
      const opts = data.map((c: any) => {
        const name = (c.full_name && c.full_name.trim())
          || `${c.first_name || ''} ${c.last_name || ''}`.trim()
          || c.company
          || c.contact_id
          || 'Unnamed Broker';
        return { value: c.id as string, label: name as string };
      });
      setBrokerOptions(opts);
    })();
    return () => { cancelled = true; };
  }, []);


  const [focusedCurrencyField, setFocusedCurrencyField] = useState<string | null>(null);
  const [focusedPercentField, setFocusedPercentField] = useState<string | null>(null);

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
            <Button variant="outline" className={cn('h-8 text-xs flex-1 justify-start text-left font-normal', !getValue(fieldKey) && 'text-muted-foreground')} disabled={disabled}>
              {(() => { const d = safeParseDateStr(getValue(fieldKey)); return d ? format(d, 'MM/dd/yyyy') : 'MM/DD/YYYY'; })()}
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

  const renderAdjPercentField = (fieldKey: string, label: string) => {
    const isFocused = focusedPercentField === fieldKey;
    const raw = getValue(fieldKey);
    const display = isFocused ? raw : (raw ? formatPercentDisplay(raw, 3) : '');
    return (
      <DirtyFieldWrapper fieldKey={fieldKey}>
        <div className="flex items-center gap-2">
          <Label className="w-[130px] shrink-0 text-xs">{label}</Label>
          <div className="relative flex-1">
            <Input
              value={display}
              onChange={(e) => {
                const cleaned = e.target.value.replace(/[^0-9.]/g, '');
                setValue(fieldKey, cleaned);
              }}
              onFocus={() => setFocusedPercentField(fieldKey)}
              onBlur={() => {
                setFocusedPercentField(null);
                const val = getValue(fieldKey);
                if (val) { const stored = roundPctForStorage(val); if (stored !== '') setValue(fieldKey, stored); }
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
  };

  // Variant of renderAdjPercentField that reads from `primaryKey` (preferring it
  // when set) but falls back to `legacyKey` for old data, and writes back to the
  // primary key only. Used by Sold Rate so Loan Details and Terms & Balances
  // share a single storage location (`loan_terms.sold_rate_company`) while
  // still honouring values previously stored under `loan_terms.sold_rate`.
  const renderAdjPercentFieldMirrored = (primaryKey: string, legacyKey: string, label: string) => {
    const fieldKey = primaryKey;
    const isFocused = focusedPercentField === fieldKey;
    const raw = getValue(primaryKey) || getValue(legacyKey);
    const display = isFocused ? raw : (raw ? formatPercentDisplay(raw, 3) : '');
    return (
      <DirtyFieldWrapper fieldKey={fieldKey}>
        <div className="flex items-center gap-2">
          <Label className="w-[130px] shrink-0 text-xs">{label}</Label>
          <div className="relative flex-1">
            <Input
              value={display}
              onChange={(e) => {
                const cleaned = e.target.value.replace(/[^0-9.]/g, '');
                setValue(primaryKey, cleaned);
              }}
              onFocus={() => setFocusedPercentField(fieldKey)}
              onBlur={() => {
                setFocusedPercentField(null);
                const val = getValue(primaryKey);
                if (val) { const stored = roundPctForStorage(val); if (stored !== '') setValue(primaryKey, stored); }
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
  };

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

  const renderInlineCheckbox = (key: string, label: string) => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center space-x-2">
        <Checkbox id={key} checked={getBoolValue(key)} onCheckedChange={(c) => setBoolValue(key, !!c)} disabled={disabled} className="h-3.5 w-3.5" />
        <Label htmlFor={key} className="font-normal cursor-pointer text-xs">{label}</Label>
      </div>
    </DirtyFieldWrapper>
  );

  const renderAccountRow = (cbKey: string, valKey: string, label: string) => (
    <div className="flex items-start gap-2">
      <div className="w-[130px] shrink-0 flex items-center gap-2 mt-1.5">
        <Checkbox id={cbKey} checked={getBoolValue(cbKey)} onCheckedChange={(c) => {
          setBoolValue(cbKey, !!c);
          if (!c) setValidationErrors(prev => ({ ...prev, [valKey]: null }));
        }} disabled={disabled} className="h-3.5 w-3.5" />
        <Label htmlFor={cbKey} className="font-normal cursor-pointer text-xs">{label}</Label>
      </div>
      <div className="flex-1">
        <Input
          value={getValue(valKey)}
          onChange={(e) => setValue(valKey, e.target.value)}
          onKeyDown={(e) => handleValidatedKeyDown(e, VALIDATION_CONFIGS.accountNumber)}
          onPaste={(e) => handleValidatedPaste(e, valKey, VALIDATION_CONFIGS.accountNumber)}
          onBlur={() => handleValidatedBlur(valKey, VALIDATION_CONFIGS.accountNumber, getBoolValue(cbKey))}
          disabled={disabled || !getBoolValue(cbKey)}
          className={cn('h-8 text-xs w-full', validationErrors[valKey] && 'border-destructive')}
        />
        {validationErrors[valKey] && <p className="text-destructive text-[10px] mt-0.5">{validationErrors[valKey]}</p>}
      </div>
    </div>
  );

  return (
    <div className="p-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-0">

        {/* Details Column */}
        <div className="space-y-1.5">
          <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2">Details</h3>
          {renderInlineField(FIELD_KEYS.companyId, 'Company ID')}
          {renderValidatedField(FIELD_KEYS.loanNumber, 'Loan Number', 'loanNumber')}
          {renderInlineField(FIELD_KEYS.previousLoanNumber, 'Previous Loan Number')}
          {renderInlineField(FIELD_KEYS.loanCode, 'Loan Code')}
          {renderValidatedField(FIELD_KEYS.assignedCsr, 'Assigned CSR', 'assignedCsr')}
          {renderInlineSelect(FIELD_KEYS.originatingVendor, 'Originating Vendor', brokerOptions, 'Select Originating Vendor')}
          {renderInlineCurrencyField(FIELD_KEYS.originalBalance, 'Original Balance')}
          {renderInlineDateField(FIELD_KEYS.origination, 'Origination Date')}
          {renderInlineSelect(FIELD_KEYS.lienPosition, 'Lien Position', LIEN_POSITION_OPTIONS, 'Select')}
          {renderInlineDateField(FIELD_KEYS.recordingDate, 'Recording Date')}
          {renderInlineField(FIELD_KEYS.recordingNumber, 'Recording Number')}
          {renderInlineDateField(FIELD_KEYS.boarding, 'Boarding Date')}
          {renderInlineDateField('loan_terms.first_payment', 'First Payment Due')}
          {renderInlineDateField(FIELD_KEYS.maturityDate, 'Maturity')}
          {renderInlineField(FIELD_KEYS.previousAccountNumber, 'Previous Account Number')}
          {renderInlineField(FIELD_KEYS.overpaymentsAppliedTo, 'Overpayments Applied To')}
          {renderInlineField(FIELD_KEYS.relatedPartySearch, 'Related Party Search')}
          <div className="pt-2">
            {renderAccountRow(FIELD_KEYS.parentAccount, FIELD_KEYS.parentAccountValue, 'Parent Account')}
          </div>
          {renderAccountRow(FIELD_KEYS.childAccount, FIELD_KEYS.childAccountValue, 'Child Account')}
        </div>

        {/* Terms Column */}
        <div className="space-y-1.5">
          <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2">Terms</h3>
          {renderInlineDateField('loan_terms.day_due', 'Day Due')}
          {renderAdjPercentField('loan_terms.note_rate', 'Note Rate')}
          {/* Sold Rate is a single source of truth shared with Terms & Balances.
              Both screens read/write `loan_terms.sold_rate_company` (the value
              users actually enter on Balances). `loan_terms.sold_rate` is kept
              as a legacy fallback for older deals that wrote to that key, but
              new writes go to sold_rate_company so the two screens stay in sync
              and the funding modal sees one truthful value. */}
          {renderAdjPercentFieldMirrored(
            'loan_terms.sold_rate_company',
            'loan_terms.sold_rate',
            'Sold Rate'
          )}
          {renderAdjPercentField('loan_terms.current_rate', 'Current Rate')}
          {renderInlineField('loan_terms.interest_split', 'Interest Split')}
          {renderInlineCurrencyField('loan_terms.unearned_discount_balance', 'Unearned Discount Balance')}
          {renderInlineSelect(FIELD_KEYS.loanPurpose, 'Loan Purpose', LOAN_PURPOSE_OPTIONS, 'Select')}
          {renderInlineSelect(FIELD_KEYS.rateStructure, 'Rate Structure', RATE_STRUCTURE_OPTIONS, 'Select')}
          {getValue(FIELD_KEYS.rateStructure) === 'other' && (
            renderInlineField(FIELD_KEYS.rateStructureOther, 'Other (specify)')
          )}
          {renderInlineSelect(FIELD_KEYS.amortization, 'Amortization', AMORTIZATION_OPTIONS, 'Select')}
          {renderInlineSelect(FIELD_KEYS.interestCalculation, 'Interest Calculation', INTEREST_CALCULATION_OPTIONS, 'Select')}
          {renderInlineSelect(FIELD_KEYS.calculationPeriod, 'Calculation Period', CALCULATION_PERIOD_OPTIONS, 'Select')}
          {renderInlineSelect('loan_terms.accrual_method', 'Accrual Method', ACCRUAL_METHOD_OPTIONS, 'Select')}
          {renderInlineSelect(FIELD_KEYS.processingUnpaidInterest, 'Processing Unpaid Interest', PROCESSING_UNPAID_INTEREST_OPTIONS, 'Select')}
        </div>

        {/* Loan Type Column */}
        <div className="space-y-1.5">
          <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2">Loan Type (can be multiple)</h3>
          {renderInlineCheckbox(FIELD_KEYS.ownerOccupied, 'Owner Occupied')}
          {renderInlineCheckbox(FIELD_KEYS.multiLender, 'Multi-lender')}
          {renderInlineCheckbox(FIELD_KEYS.sellerCarry, 'Seller Carry')}
          {renderInlineCheckbox(FIELD_KEYS.aitdWrap, 'AITD / Wrap')}
          {renderInlineCheckbox(FIELD_KEYS.rehabConstruction, 'Rehab / Construction')}
          {renderInlineCheckbox(FIELD_KEYS.variableArm, 'Variable / ARM')}
          {renderInlineCheckbox(FIELD_KEYS.respa, 'RESPA / Consumer')}
          {renderInlineCheckbox(FIELD_KEYS.unsecured, 'Unsecured')}
          {renderInlineCheckbox(FIELD_KEYS.crossCollateral, 'Cross Collateral')}
          {renderInlineCheckbox(FIELD_KEYS.limitedNoDoc, 'Limited / No Documentation')}
          {renderInlineCheckbox(FIELD_KEYS.balloonPayment, 'Balloon Payment')}
          {renderInlineCheckbox(FIELD_KEYS.subordinationProvision, 'Subordination Provision')}
          {renderInlineCheckbox(FIELD_KEYS.passThrough, 'Pass Through')}
        </div>

        {/* Status Categories Column */}
        <div className="space-y-1.5">
          <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2">Status Categories (can be multiple)</h3>
          {renderInlineSelect(FIELD_KEYS.loanStatus, 'Loan Status', LOAN_STATUS_OPTIONS, 'Select')}
          {renderInlineSelect(FIELD_KEYS.holdReason, 'Hold Reason', HOLD_REASON_OPTIONS, 'Select')}
          {renderInlineSelect(FIELD_KEYS.closedReason, 'Closed Reason', CLOSED_REASON_OPTIONS, 'Select')}
          {renderInlineCheckbox(FIELD_KEYS.documentPrep, 'Document Prep')}
          {renderInlineCheckbox(FIELD_KEYS.transferIn, 'Transfer In')}
          {renderInlineCheckbox(FIELD_KEYS.statusBankruptcy, 'Bankruptcy')}
          {renderInlineCheckbox(FIELD_KEYS.statusForeclosure, 'Foreclosure')}
          {renderInlineCheckbox(FIELD_KEYS.statusModification, 'Modification')}
          {renderInlineCheckbox(FIELD_KEYS.statusForbearance, 'Forbearance')}
          {renderInlineCheckbox(FIELD_KEYS.statusAssignment, 'Assignment')}
          {renderInlineCheckbox(FIELD_KEYS.statusLitigation, 'Litigation')}
          {renderInlineCheckbox(FIELD_KEYS.statusMilitarySCRA, 'Military SCRA')}
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
                      if (val) { const stored = roundPctForStorage(val); if (stored !== '') setValue(FIELD_KEYS.adjRateIncreasePercent, stored); }
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
                      if (val) { const stored = roundPctForStorage(val); if (stored !== '') setValue(FIELD_KEYS.adjPaymentOptionsEndPercent, stored); }
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
