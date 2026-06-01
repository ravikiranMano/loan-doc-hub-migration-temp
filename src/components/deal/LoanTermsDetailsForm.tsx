import React, { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { TypableDateField } from '@/components/ui/typable-date-field';
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

import { LOAN_TERMS_DETAILS_KEYS, LOAN_TERMS_BALANCES_KEYS } from '@/lib/fieldKeyMap';

// Use central field key map
const FIELD_KEYS = LOAN_TERMS_DETAILS_KEYS;
// Terms field keys live on the Balances key map; reused here so the Loan Details
// tab reads/writes the exact same storage location (placement-only change).
const TERMS_KEYS = LOAN_TERMS_BALANCES_KEYS;


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
// Hold Reason values — preserve legacy value codes where labels are compatible
// so previously saved data continues to display correctly. New code 'pending_payoff'
// is added for V3 spec.
const HOLD_REASON_OPTIONS = [
  { value: 'w9_document_needed', label: 'Document Needed' },
  { value: 'fraud_red_flag', label: 'Fraud / Red Flag' },
  { value: 'pending_payoff', label: 'Pending Payoff' },
  { value: 'occupancy_concern', label: 'Occupancy Concern' },
  { value: 'pending_workout', label: 'Pending Workout' },
  { value: 'other', label: 'Other' },
];
const CLOSED_REASON_OPTIONS = [
  { value: 'paid', label: 'Paid' },
  { value: 'transfer_out_customer', label: 'Transfer Out (Customer)' },
  { value: 'transfer_out_company', label: 'Transfer Out (Company)' },
  { value: 'dead', label: 'Dead' },
  { value: 'charged_off', label: 'Charged Off' },
  { value: 'other', label: 'Other' },
];

// New V3 field keys — stored directly in deal_section_values JSONB,
// no schema changes required.
const NEW_KEYS = {
  projectNumber: 'loan.project_number',
  paidOffDate: 'loan.paid_off_date',
  typeSection32: 'loan.type_section32',
  typeArticle7: 'loan.type_article7',
  typeOnPull: 'loan.type_on_pull',
  sendCouponBook: 'loan.send_coupon_book',
  sendCouponBookLastSent: 'loan.send_coupon_book_last_sent',
  sendPmtStatement: 'loan.send_pmt_statement',
  sendPmtStatementLastSent: 'loan.send_pmt_statement_last_sent',
  sendLateNotice: 'loan.send_late_notice',
  sendLateNoticeLastSent: 'loan.send_late_notice_last_sent',
  sendBalloonNotice: 'loan.send_balloon_notice',
  sendBalloonNoticeLastSent: 'loan.send_balloon_notice_last_sent',
  nsfPrev12mo: 'loan.nsf_prev_12mo',
  thirtyDaysPlus: 'loan.thirty_days_plus',
} as const;

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

  // Derive Current Rate from Rate Structure inputs.
  // FRM  -> Note Rate
  // ARM  -> Index + Margin, then clamp to [Floor, Maximum Interest Rate]
  // GTM  -> Step Rate Product? Scheduled Period Rate : Note Rate
  useEffect(() => {
    const structure = values[FIELD_KEYS.rateStructure] || '';
    const toNum = (v?: string) => {
      const n = parseFloat((v || '').toString());
      return isNaN(n) ? null : n;
    };
    const noteRate = toNum(values['loan_terms.note_rate']);
    let derived: number | null = null;

    if (structure === 'frm_fixed_rate') {
      derived = noteRate;
    } else if (structure === 'arm_adjustable_rate') {
      const idx = toNum(values[FIELD_KEYS.armIndexRate]);
      const margin = toNum(values[FIELD_KEYS.armMargin]);
      if (idx !== null && margin !== null) {
        derived = idx + margin;
        const floor = toNum(values[FIELD_KEYS.armRateFloor]);
        const cap = toNum(values[FIELD_KEYS.adjMaxInterestRate]);
        if (floor !== null && derived < floor) derived = floor;
        if (cap !== null && derived > cap) derived = cap;
      }
    } else if (structure === 'gtm_graduated_terms') {
      const isStep = values[FIELD_KEYS.gtmStepRateProduct] === 'true';
      derived = isStep ? toNum(values[FIELD_KEYS.gtmScheduledPeriodRate]) : noteRate;
    }

    if (derived === null || isNaN(derived)) return;
    const stored = roundPctForStorage(String(derived));
    if (stored === '') return;
    const current = (values['loan_terms.current_rate'] || '').toString();
    if (current !== stored) {
      onValueChange('loan_terms.current_rate', stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    values[FIELD_KEYS.rateStructure],
    values['loan_terms.note_rate'],
    values[FIELD_KEYS.armIndexRate],
    values[FIELD_KEYS.armMargin],
    values[FIELD_KEYS.armRateFloor],
    values[FIELD_KEYS.adjMaxInterestRate],
    values[FIELD_KEYS.gtmStepRateProduct],
    values[FIELD_KEYS.gtmScheduledPeriodRate],
  ]);

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
  const [maturityText, setMaturityText] = useState<string | null>(null);
  const [maturityTouched, setMaturityTouched] = useState<boolean>(false);

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
        <div className="flex-1">
          <TypableDateField
            value={getValue(fieldKey) || ''}
            onChange={(iso) => setValue(fieldKey, iso)}
            disabled={disabled}
            inputClassName="h-8 text-xs"
          />
        </div>
      </div>
    </DirtyFieldWrapper>
  );

  // Maturity Date: typable MM/DD/YYYY input + calendar icon popover trigger.
  // Keeps existing validation (validateMaturityDate) and stores yyyy-MM-dd.
  const renderMaturityDateField = (fieldKey: string, label: string) => {
    const stored = getValue(fieldKey);
    const parsedStored = safeParseDateStr(stored);
    const displayFromStored = parsedStored ? format(parsedStored, 'MM/dd/yyyy') : '';
    const localText = maturityText ?? displayFromStored;
    const error = showValidation || maturityTouched
      ? validateMaturityDate(localText, stored)
      : null;

    const commitText = (raw: string) => {
      const trimmed = (raw || '').trim();
      if (!trimmed) { setValue(fieldKey, ''); return; }
      const parsed = parse(trimmed, 'MM/dd/yyyy', new Date());
      if (isValid(parsed) && format(parsed, 'MM/dd/yyyy') === trimmed) {
        setValue(fieldKey, format(parsed, 'yyyy-MM-dd'));
      }
    };

    return (
      <DirtyFieldWrapper fieldKey={fieldKey}>
        <div className="flex items-start gap-2">
          <Label className="w-[130px] shrink-0 text-xs pt-2">{label}</Label>
          <div className="flex-1">
            <div className="relative">
              <Input
                type="text"
                inputMode="numeric"
                value={localText}
                placeholder="MM/DD/YYYY"
                disabled={disabled}
                onChange={(e) => {
                  const input = e.target as HTMLInputElement;
                  const rawValue = input.value;
                  const selStart = input.selectionStart ?? rawValue.length;
                  // Count digits before caret in raw input
                  const digitsBeforeCaret = rawValue.slice(0, selStart).replace(/\D/g, '').length;
                  // Build masked string
                  const digits = rawValue.replace(/\D/g, '').slice(0, 8);
                  let out = digits;
                  if (digits.length > 4) out = `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4)}`;
                  else if (digits.length > 2) out = `${digits.slice(0,2)}/${digits.slice(2)}`;
                  // Map digitsBeforeCaret to position in masked output
                  let newCaret = 0;
                  let dCount = 0;
                  while (newCaret < out.length && dCount < digitsBeforeCaret) {
                    if (/\d/.test(out[newCaret])) dCount++;
                    newCaret++;
                  }
                  // If next char is a slash and we just finished a digit group, step past it
                  while (newCaret < out.length && out[newCaret] === '/' && dCount === digitsBeforeCaret && digitsBeforeCaret > 0 && (digitsBeforeCaret === 2 || digitsBeforeCaret === 4)) {
                    newCaret++;
                    break;
                  }
                  setMaturityText(out);
                  setMaturityTouched(true);
                  // Restore caret after React commits the value
                  requestAnimationFrame(() => {
                    try { input.setSelectionRange(newCaret, newCaret); } catch {}
                  });
                  if (out.length === 10) commitText(out);
                }}
                onBlur={() => {
                  setMaturityTouched(true);
                  commitText(localText);
                }}
                className={cn('h-8 text-xs pr-9', error && 'border-destructive focus-visible:ring-destructive')}
              />
              <Popover
                open={datePickerStates[fieldKey] || false}
                onOpenChange={(open) => setDatePickerStates(prev => ({ ...prev, [fieldKey]: open }))}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label="Open calendar"
                    className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <CalendarIcon className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                  <EnhancedCalendar
                    mode="single"
                    selected={safeParseDateStr(getValue(fieldKey))}
                    onSelect={(date) => {
                      if (date) {
                        const iso = format(date, 'yyyy-MM-dd');
                        setValue(fieldKey, iso);
                        setMaturityText(format(date, 'MM/dd/yyyy'));
                        setMaturityTouched(true);
                      }
                      setDatePickerStates(prev => ({ ...prev, [fieldKey]: false }));
                    }}
                    onClear={() => {
                      setValue(fieldKey, '');
                      setMaturityText('');
                      setMaturityTouched(true);
                      setDatePickerStates(prev => ({ ...prev, [fieldKey]: false }));
                    }}
                    onToday={() => {
                      const t = new Date();
                      setValue(fieldKey, format(t, 'yyyy-MM-dd'));
                      setMaturityText(format(t, 'MM/dd/yyyy'));
                      setMaturityTouched(true);
                      setDatePickerStates(prev => ({ ...prev, [fieldKey]: false }));
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            {error && (
              <p className="text-[10px] text-destructive mt-0.5">{error}</p>
            )}
          </div>
        </div>
      </DirtyFieldWrapper>
    );
  };

  const validateMaturityDate = (rawText: string, storedIso: string): string | null => {
    const trimmed = (rawText || '').trim();
    if (!trimmed) return 'Maturity Date is required.';
    const parsed = parse(trimmed, 'MM/dd/yyyy', new Date());
    if (!isValid(parsed) || format(parsed, 'MM/dd/yyyy') !== trimmed) {
      return 'Please enter a valid Maturity Date.';
    }
    // Future date (compare by date only)
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (parsed <= today) return 'Maturity Date must be a future date.';

    const noteDate = safeParseDateStr(getValue(FIELD_KEYS.origination));
    if (noteDate && parsed <= noteDate) return 'Maturity Date must be later than the Note Date.';

    const firstPayment = safeParseDateStr(getValue('loan_terms.first_payment'));
    if (firstPayment && parsed <= firstPayment) return 'Maturity Date must be later than the First Payment Due Date.';

    // Max term: 480 months from Note Date (or today as fallback)
    const baseForTerm = noteDate || today;
    const maxAllowed = new Date(baseForTerm);
    maxAllowed.setMonth(maxAllowed.getMonth() + 480);
    if (parsed > maxAllowed) return 'Loan term exceeds the maximum allowed duration.';

    return null;
  };

  const ManualDateInput: React.FC<{
    fieldKey: string;
    label: string;
    validate?: (rawText: string, storedIso: string) => string | null;
    required?: boolean;
  }> = ({ fieldKey, label, validate, required }) => {
    const stored = getValue(fieldKey);
    const display = (() => {
      const d = safeParseDateStr(stored);
      return d ? format(d, 'MM/dd/yyyy') : stored || '';
    })();
    const [text, setText] = React.useState(display);
    React.useEffect(() => { setText(display); }, [stored]);
    const error = validationErrors[fieldKey];
    const runValidate = (val: string, iso: string) => {
      if (!validate) return;
      setValidationErrors(prev => ({ ...prev, [fieldKey]: validate(val, iso) }));
    };
    const handleChange = (raw: string) => {
      const digits = raw.replace(/\D/g, '').slice(0, 8);
      let out = digits;
      if (digits.length > 4) out = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
      else if (digits.length > 2) out = `${digits.slice(0, 2)}/${digits.slice(2)}`;
      setText(out);
      if (out.length === 10) {
        const parsed = parse(out, 'MM/dd/yyyy', new Date());
        if (isValid(parsed)) {
          const iso = format(parsed, 'yyyy-MM-dd');
          if (iso !== stored) setValue(fieldKey, iso);
          runValidate(out, iso);
          return;
        }
      }
      runValidate(out, stored);
    };
    const handleBlur = () => {
      if (!text.trim()) {
        if (stored) setValue(fieldKey, '');
        runValidate('', '');
        return;
      }
      const parsed = parse(text, 'MM/dd/yyyy', new Date());
      if (isValid(parsed)) {
        const iso = format(parsed, 'yyyy-MM-dd');
        if (iso !== stored) setValue(fieldKey, iso);
        const formatted = format(parsed, 'MM/dd/yyyy');
        setText(formatted);
        runValidate(formatted, iso);
      } else {
        runValidate(text, stored);
      }
    };
    return (
      <DirtyFieldWrapper fieldKey={fieldKey}>
        <div className="flex items-start gap-2">
          <Label className="w-[130px] shrink-0 text-xs pt-1.5">
            {label}{required && <span className="text-destructive ml-0.5">*</span>}
          </Label>
          <div className="flex-1">
            <Input
              value={text}
              onChange={(e) => handleChange(e.target.value)}
              onBlur={handleBlur}
              placeholder="MM/DD/YYYY"
              inputMode="numeric"
              maxLength={10}
              disabled={disabled}
              className={cn('h-8 text-xs w-full', error && 'border-destructive')}
              aria-invalid={!!error}
            />
            {error && <p className="text-destructive text-[10px] mt-0.5">{error}</p>}
          </div>
        </div>
      </DirtyFieldWrapper>
    );
  };

  const renderManualDateField = (
    fieldKey: string,
    label: string,
    opts?: { validate?: (rawText: string, storedIso: string) => string | null; required?: boolean }
  ) => (
    <ManualDateInput fieldKey={fieldKey} label={label} validate={opts?.validate} required={opts?.required} />
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

  const handleValidatedPaste = (e: React.ClipboardEvent<HTMLInputElement>, fieldKey: string, config: ValidationConfig, maxLength?: number) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').trim();
    let cleaned = pasted.split('').filter(ch => config.allowedPattern.test(ch)).join('');
    if (maxLength && cleaned.length > maxLength) cleaned = cleaned.slice(0, maxLength);
    setValue(fieldKey, cleaned);
  };

  const handleValidatedBlur = (fieldKey: string, config: ValidationConfig, mandatory?: boolean) => {
    const trimmed = getValue(fieldKey).trim();
    if (trimmed !== getValue(fieldKey)) setValue(fieldKey, trimmed);
    const error = config.validate(trimmed, mandatory);
    setValidationErrors(prev => ({ ...prev, [fieldKey]: error }));
  };

  const renderValidatedField = (fieldKey: string, label: string, configKey: string, maxLength?: number) => {
    const config = VALIDATION_CONFIGS[configKey];
    const error = validationErrors[fieldKey];
    const charClassSrc = config.allowedPattern.source.replace(/^\^/, '').replace(/\$$/, '');
    const charClassRe = new RegExp(charClassSrc, 'g');
    const sanitize = (raw: string) => {
      const matches = raw.match(charClassRe) || [];
      let out = matches.join('');
      if (maxLength && out.length > maxLength) out = out.slice(0, maxLength);
      return out;
    };
    return (
      <DirtyFieldWrapper fieldKey={fieldKey}>
        <div className="flex items-center gap-2">
          <Label className="w-[130px] shrink-0 text-xs">{label}</Label>
          <div className="flex-1">
            <Input
              id={fieldKey}
              value={getValue(fieldKey)}
              onChange={(e) => setValue(fieldKey, sanitize(e.target.value))}
              onKeyDown={(e) => handleValidatedKeyDown(e, config)}
              onPaste={(e) => handleValidatedPaste(e, fieldKey, config, maxLength)}
              onBlur={() => handleValidatedBlur(fieldKey, config)}
              disabled={disabled}
              maxLength={maxLength}
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

  // Helpers for new V3 fields
  const renderPlainTextField = (key: string, label: string) => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center gap-2">
        <Label className="w-[130px] shrink-0 text-xs">{label}</Label>
        <Input
          id={key}
          value={getValue(key)}
          onChange={(e) => setValue(key, e.target.value)}
          disabled={disabled}
          className="h-8 text-xs flex-1"
        />
      </div>
    </DirtyFieldWrapper>
  );

  const renderReadOnlyDateField = (key: string, label: string) => {
    const stored = getValue(key);
    const d = safeParseDateStr(stored);
    const display = d ? format(d, 'MM/dd/yyyy') : (stored || '');
    return (
      <Input
        value={display}
        readOnly
        disabled
        className="h-8 text-xs bg-muted/40 w-[110px]"
        aria-label={label}
        placeholder="—"
      />
    );
  };

  const renderReadOnlyNumberRow = (key: string, label: string) => (
    <div className="flex items-center gap-2">
      <Label className="flex-1 text-xs">{label}</Label>
      <Input
        value={getValue(key)}
        readOnly
        disabled
        className="h-8 text-xs bg-muted/40 w-[80px] text-right"
        aria-label={label}
      />
    </div>
  );

  // Loan Status conditional dropdown change handler — clears stale reason value
  const handleLoanStatusChange = (newStatus: string) => {
    const prev = getValue(FIELD_KEYS.loanStatus);
    if (prev !== newStatus) {
      // Clear opposite reason fields whenever status changes
      if (newStatus !== 'hold' && getValue(FIELD_KEYS.holdReason)) {
        setValue(FIELD_KEYS.holdReason, '');
      }
      if (newStatus !== 'closed' && getValue(FIELD_KEYS.closedReason)) {
        setValue(FIELD_KEYS.closedReason, '');
      }
    }
    setValue(FIELD_KEYS.loanStatus, newStatus);
  };

  const currentLoanStatus = getValue(FIELD_KEYS.loanStatus);

  return (
    <div className="p-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-6 gap-y-0">

        {/* Details Column */}
        <div className="space-y-1.5">
          <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2">Details</h3>
          {renderInlineField(FIELD_KEYS.companyId, 'Company ID')}
          {renderInlineField(FIELD_KEYS.previousLoanNumber, 'Previous Loan Number')}
          {/* Parent / Child Account — V3 spec: plain text only, no radio/checkbox */}
          {renderPlainTextField(FIELD_KEYS.parentAccountValue, 'Parent Account')}
          {renderPlainTextField(FIELD_KEYS.childAccountValue, 'Child Account')}
          {renderInlineSelect(FIELD_KEYS.lienPosition, 'Lien Position', LIEN_POSITION_OPTIONS, 'Select')}
          {renderInlineField(FIELD_KEYS.loanCode, 'Loan Code')}
          {renderPlainTextField(NEW_KEYS.projectNumber, 'Project Number')}
          {renderValidatedField(FIELD_KEYS.assignedCsr, 'Assigned CSR', 'assignedCsr')}
          {renderInlineSelect(FIELD_KEYS.originatingVendor, 'Originating Vendor', brokerOptions, 'Select Originating Vendor')}
          {renderInlineCurrencyField(FIELD_KEYS.originalBalance, 'Original Loan Amount')}
          {renderInlineSelect(FIELD_KEYS.loanPurpose, 'Loan Purpose', LOAN_PURPOSE_OPTIONS, 'Select')}
          {renderInlineDateField(FIELD_KEYS.recordingDate, 'Recording Date')}
          {renderInlineField(FIELD_KEYS.recordingNumber, 'Recording Number')}
          {renderInlineDateField(FIELD_KEYS.boarding, 'Boarding Date')}
          {renderMaturityDateField(FIELD_KEYS.maturityDate, 'Maturity / DIF')}
          {renderInlineDateField(NEW_KEYS.paidOffDate, 'Paid Off / Closed')}

          {/* Existing fields kept — not in V3 spec, retained at bottom */}
          {renderValidatedField(FIELD_KEYS.loanNumber, 'Loan Number', 'loanNumber', 14)}
          {renderInlineDateField(FIELD_KEYS.origination, 'Origination Date')}
          {renderInlineField(FIELD_KEYS.previousAccountNumber, 'Previous Account Number')}
          {renderInlineField(FIELD_KEYS.overpaymentsAppliedTo, 'Overpayments Applied To')}
          {renderInlineField(FIELD_KEYS.relatedPartySearch, 'Related Party Search')}
        </div>

        {/* Loan Categories Column */}
        <div className="space-y-1.5">
          <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2">Loan Categories (can be multiple)</h3>
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
          {renderInlineCheckbox(NEW_KEYS.typeSection32, 'Section 32')}
          {renderInlineCheckbox(NEW_KEYS.typeArticle7, 'Article 7')}
          {renderInlineCheckbox(FIELD_KEYS.transferIn, 'Transfer In')}
          {renderInlineCheckbox(FIELD_KEYS.documentPrep, 'Document Prep')}
          {renderInlineCheckbox(FIELD_KEYS.statusMilitarySCRA, 'Military SCRA')}
          {renderInlineCheckbox(NEW_KEYS.typeOnPull, 'On Pull')}

          {/* Terms fields — placed directly below On Pull per V3 spec.
              Storage keys mirror LOAN_TERMS_BALANCES_KEYS so save/load is identical. */}
          <DirtyFieldWrapper fieldKey={TERMS_KEYS.dayDue}>
            <div className="flex items-center gap-2">
              <Label className="w-[130px] shrink-0 text-xs">Day Due</Label>
              <Input
                value={getValue(TERMS_KEYS.dayDue)}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
                  setValue(TERMS_KEYS.dayDue, digits);
                }}
                onBlur={() => {
                  const v = getValue(TERMS_KEYS.dayDue);
                  if (!v) return;
                  const n = parseInt(v, 10);
                  if (isNaN(n)) { setValue(TERMS_KEYS.dayDue, ''); return; }
                  const clamped = Math.max(1, Math.min(31, n));
                  setValue(TERMS_KEYS.dayDue, String(clamped));
                }}
                disabled={disabled}
                inputMode="numeric"
                placeholder="1-31"
                className="h-8 text-xs flex-1"
              />
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={TERMS_KEYS.currentRate}>
            <div className="flex items-center gap-2">
              <Label className="w-[130px] shrink-0 text-xs">Current Rate</Label>
              <div className="relative flex-1">
                <Input
                  value={getValue(TERMS_KEYS.currentRate) ? formatPercentDisplay(getValue(TERMS_KEYS.currentRate), 3) : ''}
                  readOnly
                  disabled
                  className="h-8 text-xs pr-5 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900"
                  placeholder="0.00"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">%</span>
              </div>
            </div>
          </DirtyFieldWrapper>

          {/* Terms dropdowns — moved here from Loan Status column per spec.
              Same storage bindings, no functional change. */}
          {renderInlineSelect(FIELD_KEYS.rateStructure, 'Rate Structure', RATE_STRUCTURE_OPTIONS, 'Select')}
          {renderInlineSelect(FIELD_KEYS.amortization, 'Amortization', AMORTIZATION_OPTIONS, 'Select')}
          {renderInlineSelect(FIELD_KEYS.interestCalculation, 'Interest Calculation', INTEREST_CALCULATION_OPTIONS, 'Select')}
          {renderInlineSelect(FIELD_KEYS.calculationPeriod, 'Calculation Period', CALCULATION_PERIOD_OPTIONS, 'Select')}
          {renderInlineSelect(FIELD_KEYS.processingUnpaidInterest, 'Processing Unpaid Interest', PROCESSING_UNPAID_INTEREST_OPTIONS, 'Select')}

        </div>


        {/* Loan Status Column */}
        <div className="space-y-1.5">
          <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2">Loan Status (can be multiple)</h3>

          {/* Loan Status dropdown — supports blank */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.loanStatus}>
            <div className="flex items-center gap-2">
              <Label className="w-[110px] shrink-0 text-xs">Loan Status</Label>
              <Select
                value={currentLoanStatus || undefined}
                onValueChange={(v) => handleLoanStatusChange(v === '__none__' ? '' : v)}
                disabled={disabled}
              >
                <SelectTrigger className="h-8 text-xs flex-1">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {LOAN_STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          {/* Conditional Hold Reason — visible only when status = hold */}
          {currentLoanStatus === 'hold' && (
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.holdReason}>
              <div className="flex items-center gap-2">
                <Label className="w-[110px] shrink-0 text-xs">Hold Reason</Label>
                <Select
                  value={getValue(FIELD_KEYS.holdReason) || undefined}
                  onValueChange={(v) => setValue(FIELD_KEYS.holdReason, v === '__none__' ? '' : v)}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {HOLD_REASON_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </DirtyFieldWrapper>
          )}

          {/* Conditional Closed Reason — visible only when status = closed */}
          {currentLoanStatus === 'closed' && (
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.closedReason}>
              <div className="flex items-center gap-2">
                <Label className="w-[110px] shrink-0 text-xs">Closed Reason</Label>
                <Select
                  value={getValue(FIELD_KEYS.closedReason) || undefined}
                  onValueChange={(v) => setValue(FIELD_KEYS.closedReason, v === '__none__' ? '' : v)}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {CLOSED_REASON_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </DirtyFieldWrapper>
          )}

          {/* V3 status checkboxes — Assignment removed per spec */}
          <div className="pt-1">
            {renderInlineCheckbox(FIELD_KEYS.statusBankruptcy, 'Bankruptcy')}
            {renderInlineCheckbox(FIELD_KEYS.statusForeclosure, 'Foreclosure')}
            {renderInlineCheckbox(FIELD_KEYS.statusModification, 'Modification')}
            {renderInlineCheckbox(FIELD_KEYS.statusForbearance, 'Forbearance')}
            {renderInlineCheckbox(FIELD_KEYS.statusLitigation, 'Litigation')}
          </div>

          {/* Send block */}
          <div className="pt-3">
            <h4 className="font-semibold text-xs text-foreground border-b border-border/50 pb-1 mb-2">Send:</h4>
            <div className="space-y-1.5">
              {[
                { cb: NEW_KEYS.sendCouponBook, last: NEW_KEYS.sendCouponBookLastSent, label: 'Coupon Book' },
                { cb: NEW_KEYS.sendPmtStatement, last: NEW_KEYS.sendPmtStatementLastSent, label: 'Payment Statement' },
                { cb: NEW_KEYS.sendLateNotice, last: NEW_KEYS.sendLateNoticeLastSent, label: 'Late Notice' },
                { cb: NEW_KEYS.sendBalloonNotice, last: NEW_KEYS.sendBalloonNoticeLastSent, label: 'Balloon / DIF Notice' },
              ].map((row) => (
                <div key={row.cb} className="flex items-center gap-2">
                  <DirtyFieldWrapper fieldKey={row.cb}>
                    <div className="flex items-center gap-2 flex-1">
                      <Checkbox
                        id={row.cb}
                        checked={getBoolValue(row.cb)}
                        onCheckedChange={(c) => setBoolValue(row.cb, !!c)}
                        disabled={disabled}
                        className="h-3.5 w-3.5"
                      />
                      <Label htmlFor={row.cb} className="font-normal cursor-pointer text-xs flex-1 whitespace-nowrap">
                        {row.label}
                      </Label>
                    </div>
                  </DirtyFieldWrapper>
                  <DirtyFieldWrapper fieldKey={row.last}>
                    <div className="w-[110px]">
                      <TypableDateField
                        value={getValue(row.last) || ''}
                        onChange={(iso) => setValue(row.last, iso)}
                        disabled={disabled}
                        inputClassName="h-8 text-xs"
                        aria-label={`${row.label} Last Sent`}
                      />
                    </div>
                  </DirtyFieldWrapper>
                </div>
              ))}
            </div>
          </div>

          {/* NSF / 30-days Plus — read-only system-calculated */}
          <div className="pt-3 space-y-1.5">
            {renderReadOnlyNumberRow(NEW_KEYS.nsfPrev12mo, 'NSF Previous 12 Months')}
            {renderReadOnlyNumberRow(NEW_KEYS.thirtyDaysPlus, '30-days Plus')}
          </div>



        </div>
      </div>


      {/* Adjustable / Graduated Loan Details - shown for ARM or GTM */}
      {(getValue(FIELD_KEYS.rateStructure) === 'arm_adjustable_rate' || getValue(FIELD_KEYS.rateStructure) === 'gtm_graduated_terms') && (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-3">Adjustable / Graduated Loan Details</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2">
            {getValue(FIELD_KEYS.rateStructure) === 'arm_adjustable_rate' && (
              <>
                {renderAdjPercentField(FIELD_KEYS.armIndexRate, 'Index Rate')}
                {renderAdjPercentField(FIELD_KEYS.armMargin, 'Margin')}
                {renderAdjPercentField(FIELD_KEYS.armRateFloor, 'Rate Floor')}
              </>
            )}
            {getValue(FIELD_KEYS.rateStructure) === 'gtm_graduated_terms' && (
              <>
                {renderInlineCheckbox(FIELD_KEYS.gtmStepRateProduct, 'Step Rate Product')}
                {getBoolValue(FIELD_KEYS.gtmStepRateProduct) && (
                  renderAdjPercentField(FIELD_KEYS.gtmScheduledPeriodRate, 'Scheduled Period Rate')
                )}
              </>
            )}
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
