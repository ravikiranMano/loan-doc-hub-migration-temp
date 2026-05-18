import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ZipInput } from '@/components/ui/zip-input';
import type { FieldDefinition } from '@/hooks/useDealFields';
import type { CalculationResult } from '@/lib/calculationEngine';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';
import { validateSSN, formatSSN, maskSSN } from '@/lib/tinValidation';

import { BORROWER_TAX_DETAIL_KEYS, BORROWER_PRIMARY_KEYS, BORROWER_GUARANTOR_KEYS } from '@/lib/fieldKeyMap';

// Use central field key map
const FIELD_KEYS = BORROWER_TAX_DETAIL_KEYS;

import { STATE_OPTIONS } from '@/lib/usStates';

const DESIGNATED_RECIPIENT_OPTIONS = [
  { value: 'primary', label: 'Borrower' },
  { value: 'co-borrower', label: 'Co-borrower' },
  { value: 'additional_guarantor', label: 'Additional Guarantor' },
  { value: 'other', label: 'Other' },
];

const TIN_TYPE_OPTIONS = [
  { value: '2', label: 'SSN' },
];

// Maps for auto-populating from entity data
const PRIMARY_SOURCE_MAP = {
  name: BORROWER_PRIMARY_KEYS.fullName,
  address: BORROWER_PRIMARY_KEYS.primaryStreet,
  city: BORROWER_PRIMARY_KEYS.primaryCity,
  state: BORROWER_PRIMARY_KEYS.primaryState,
  zip: BORROWER_PRIMARY_KEYS.primaryZip,
  tin: BORROWER_PRIMARY_KEYS.tin,
  tinType: BORROWER_PRIMARY_KEYS.taxIdType,
} as const;

const COBORROWER_SOURCE_MAP = {
  name: 'coborrower.full_name',
  address: 'coborrower.primary_address.street',
  city: 'coborrower.primary_address.city',
  state: 'coborrower.primary_address.state',
  zip: 'coborrower.primary_address.zip',
  tin: 'coborrower.tin',
  tinType: 'coborrower.tax_id_type',
} as const;

const GUARANTOR_SOURCE_MAP = {
  name: BORROWER_GUARANTOR_KEYS.fullName,
  address: BORROWER_GUARANTOR_KEYS.primaryStreet,
  city: BORROWER_GUARANTOR_KEYS.primaryCity,
  state: BORROWER_GUARANTOR_KEYS.primaryState,
  zip: BORROWER_GUARANTOR_KEYS.primaryZip,
  tin: BORROWER_GUARANTOR_KEYS.tin,
  tinType: BORROWER_GUARANTOR_KEYS.taxIdType,
} as const;

interface BorrowerTaxDetailFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

export const BorrowerTaxDetailForm: React.FC<BorrowerTaxDetailFormProps> = ({
  values,
  onValueChange,
  disabled = false,
}) => {
  const [tinFocused, setTinFocused] = useState(false);
  const [tinTouched, setTinTouched] = useState(false);
  const [acctFocused, setAcctFocused] = useState(false);
  const [cityTouched, setCityTouched] = useState(false);

  const getValue = (key: keyof typeof FIELD_KEYS): string => {
    return values[FIELD_KEYS[key]] || '';
  };

  const handleChange = (key: keyof typeof FIELD_KEYS, value: string) => {
    onValueChange(FIELD_KEYS[key], value);
  };

  const designatedRecipient = getValue('designatedRecipient');

  // Use refs to avoid stale closures in useEffect
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const onValueChangeRef = useRef(onValueChange);
  onValueChangeRef.current = onValueChange;

  // Auto-populate when designated recipient changes
  useEffect(() => {
    const currentValues = valuesRef.current;
    const fireChange = (key: keyof typeof FIELD_KEYS, value: string) => {
      onValueChangeRef.current(FIELD_KEYS[key], value);
    };

    if (!designatedRecipient || designatedRecipient === 'other') {
      if (designatedRecipient === 'other') {
        fireChange('name', '');
        fireChange('address', '');
        fireChange('city', '');
        fireChange('state', '');
        fireChange('zip', '');
        fireChange('tin', '');
        fireChange('tinType', '');
      }
      return;
    }

    let sourceMap: Record<string, string>;
    if (designatedRecipient === 'primary') {
      sourceMap = PRIMARY_SOURCE_MAP;
    } else if (designatedRecipient === 'co-borrower') {
      sourceMap = COBORROWER_SOURCE_MAP;
    } else if (designatedRecipient === 'additional_guarantor') {
      sourceMap = GUARANTOR_SOURCE_MAP;
    } else {
      return;
    }

    fireChange('name', currentValues[sourceMap.name] || '');
    fireChange('address', currentValues[sourceMap.address] || '');
    fireChange('city', currentValues[sourceMap.city] || '');
    fireChange('state', currentValues[sourceMap.state] || '');
    fireChange('zip', currentValues[sourceMap.zip] || '');
    fireChange('tin', currentValues[sourceMap.tin] || '');
    fireChange('tinType', currentValues[sourceMap.tinType] || '');
  }, [designatedRecipient]);

  // --- SSN handling ---
  const rawTin = getValue('tin');
  const tinDigits = rawTin.replace(/\D/g, '');

  const handleTinChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 9);
    handleChange('tin', digits);
  }, []);

  const tinDisplay = tinFocused ? formatSSN(tinDigits) : (tinDigits ? maskSSN(tinDigits) : '');
  const tinValid = !tinDigits || validateSSN(tinDigits);
  const showTinError = tinTouched && tinDigits.length > 0 && !tinValid;

  // --- Account Number masking ---
  const rawAcct = getValue('accountNumber');
  const maskAccount = (val: string): string => {
    if (!val || val.length <= 4) return val;
    return '*'.repeat(val.length - 4) + val.slice(-4);
  };
  const acctDisplay = acctFocused ? rawAcct : maskAccount(rawAcct);

  // --- City validation (alphabets + spaces only) ---
  const handleCityChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^a-zA-Z\s]/g, '');
    handleChange('city', val);
  }, []);
  const cityVal = getValue('city');
  const cityValid = !cityVal || /^[a-zA-Z\s]+$/.test(cityVal);
  const showCityError = cityTouched && cityVal.length > 0 && !cityValid;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="border-b border-border pb-2 mb-4">
        <span className="font-semibold text-base text-foreground">1098</span>
      </div>

      <div className="max-w-[700px] space-y-3">
        {/* Designated Recipient + Dropdown Populates */}
        <DirtyFieldWrapper fieldKey={FIELD_KEYS.designatedRecipient}>
          <div className="flex items-center gap-3">
            <Label className="text-sm text-foreground whitespace-nowrap min-w-[140px]">Designated Recipient <span className="text-destructive">*</span></Label>
            <Select
              value={getValue('designatedRecipient')}
              onValueChange={(value) => handleChange('designatedRecipient', value)}
              disabled={disabled}
            >
              <SelectTrigger className="h-7 text-sm flex-1 max-w-[200px] bg-background">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent className="bg-background z-50">
                {DESIGNATED_RECIPIENT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </DirtyFieldWrapper>

        <DirtyFieldWrapper fieldKey={FIELD_KEYS.name}>
          <div className="flex items-center gap-3">
            <Label className="text-sm text-foreground whitespace-nowrap min-w-[140px]">Name <span className="text-destructive">*</span></Label>
            <Input
              value={getValue('name')}
              onChange={(e) => handleChange('name', e.target.value.replace(/[^a-zA-Z\s.,'-]/g, ''))}
              disabled={disabled}
              maxLength={150}
              className="h-7 text-sm flex-1"
            />
          </div>
        </DirtyFieldWrapper>

        <div className="grid grid-cols-2 gap-4">
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.address}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-foreground whitespace-nowrap min-w-[140px]">Address <span className="text-destructive">*</span></Label>
              <Input value={getValue('address')} onChange={(e) => handleChange('address', e.target.value)} disabled={disabled} maxLength={200} className="h-7 text-sm flex-1" />
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.accountNumber}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-foreground whitespace-nowrap min-w-[120px]">Account Number</Label>
              <Input
                value={acctDisplay}
                onChange={(e) => handleChange('accountNumber', e.target.value.slice(0, 20))}
                onFocus={() => setAcctFocused(true)}
                onBlur={() => setAcctFocused(false)}
                disabled={disabled}
                maxLength={20}
                className="h-7 text-sm flex-1"
              />
            </div>
          </DirtyFieldWrapper>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.city}>
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-3">
                <Label className="text-sm text-foreground whitespace-nowrap min-w-[140px]">City <span className="text-destructive">*</span></Label>
                <Input
                  value={getValue('city')}
                  onChange={handleCityChange}
                  onBlur={() => setCityTouched(true)}
                  disabled={disabled}
                  className="h-7 text-sm flex-1"
                />
              </div>
              {showCityError && <span className="text-[10px] text-destructive ml-[152px]">Enter valid city</span>}
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.tinType}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-foreground whitespace-nowrap min-w-[120px]">TIN Type <span className="text-destructive">*</span></Label>
              <Select value={getValue('tinType') || undefined} onValueChange={(value) => handleChange('tinType', value)} disabled={disabled}>
                <SelectTrigger className="h-7 text-sm flex-1 bg-background"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="bg-background z-50">
                  {TIN_TYPE_OPTIONS.map((opt) => (<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.state}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-foreground whitespace-nowrap min-w-[140px]">State <span className="text-destructive">*</span></Label>
              <Select value={getValue('state')} onValueChange={(value) => handleChange('state', value)} disabled={disabled}>
                <SelectTrigger className="h-7 text-sm flex-1 bg-background"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="bg-background z-50 max-h-60">
                  {STATE_OPTIONS.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.tin}>
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-3">
                <Label className="text-sm text-foreground whitespace-nowrap min-w-[120px]">TIN (SSN) <span className="text-destructive">*</span></Label>
                <Input
                  value={tinDisplay}
                  onChange={handleTinChange}
                  onFocus={() => setTinFocused(true)}
                  onBlur={() => { setTinFocused(false); setTinTouched(true); }}
                  disabled={disabled}
                  maxLength={11}
                  inputMode="numeric"
                  placeholder="XXX-XX-XXXX"
                  className={`h-7 text-sm flex-1 ${showTinError ? 'border-destructive' : ''}`}
                />
              </div>
              {showTinError && <span className="text-[10px] text-destructive ml-[132px]">Enter valid SSN</span>}
            </div>
          </DirtyFieldWrapper>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.zip}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-foreground whitespace-nowrap min-w-[140px]">ZIP <span className="text-destructive">*</span></Label>
              <ZipInput
                value={getValue('zip')}
                onValueChange={(val) => handleChange('zip', val)}
                disabled={disabled}
                className="h-7 text-sm flex-1"
              />
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.send1098}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-foreground whitespace-nowrap min-w-[120px]">Send 1098</Label>
              <Checkbox checked={getValue('send1098') === 'true'} onCheckedChange={(checked) => handleChange('send1098', checked === true ? 'true' : 'false')} disabled={disabled} />
            </div>
          </DirtyFieldWrapper>
        </div>
      </div>
    </div>
  );
};

export default BorrowerTaxDetailForm;
