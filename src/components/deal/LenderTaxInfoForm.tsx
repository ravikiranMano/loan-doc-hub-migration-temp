import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ZipInput } from '@/components/ui/zip-input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FieldDefinition } from '@/hooks/useDealFields';
import type { CalculationResult } from '@/lib/calculationEngine';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';

interface LenderTaxInfoFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

const DESIGNATED_RECIPIENT_OPTIONS = [
  { value: 'lender', label: 'Lender' },
  { value: 'servicer', label: 'Servicer' },
  { value: 'broker', label: 'Broker' },
];

const TIN_TYPE_OPTIONS = [
  { value: '0', label: '0 – Unknown' },
  { value: '1', label: '1 – EIN' },
  { value: '2', label: '2 – SSN' },
];

import { STATE_OPTIONS } from '@/lib/usStates';
import { LENDER_TAX_INFO_KEYS } from '@/lib/fieldKeyMap';

// Use central field key map
const FIELD_KEYS = LENDER_TAX_INFO_KEYS;

export const LenderTaxInfoForm: React.FC<LenderTaxInfoFormProps> = ({
  values,
  onValueChange,
  disabled = false,
}) => {
  const getValue = (key: keyof typeof FIELD_KEYS): string => {
    return values[FIELD_KEYS[key]] || '';
  };

  const handleChange = (key: keyof typeof FIELD_KEYS, value: string) => {
    onValueChange(FIELD_KEYS[key], value);
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="border-b border-border pb-2 mb-4">
        <span className="font-semibold text-base text-foreground">1099</span>
      </div>

      <div className="max-w-[700px] space-y-3">
        {/* Designated Recipient */}
        <DirtyFieldWrapper fieldKey={FIELD_KEYS.designatedRecipient}>
          <div className="flex items-center gap-3">
            <Label className="text-sm text-foreground whitespace-nowrap min-w-[140px]">Designated Recipient</Label>
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

        {/* Name */}
        <DirtyFieldWrapper fieldKey={FIELD_KEYS.name}>
          <div className="flex items-center gap-3">
            <Label className="text-sm text-foreground whitespace-nowrap min-w-[140px]">Name</Label>
            <Input
              value={getValue('name')}
              onChange={(e) => handleChange('name', e.target.value)}
              disabled={disabled}
              className="h-7 text-sm flex-1"
            />
          </div>
        </DirtyFieldWrapper>

        {/* Address | Account Number */}
        <div className="grid grid-cols-2 gap-4">
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.address}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-foreground whitespace-nowrap min-w-[140px]">Address</Label>
              <Input
                value={getValue('address')}
                onChange={(e) => handleChange('address', e.target.value)}
                disabled={disabled}
                className="h-7 text-sm flex-1"
              />
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.accountNumber}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-foreground whitespace-nowrap min-w-[120px]">Account Number</Label>
              <Input
                value={getValue('accountNumber')}
                onChange={(e) => handleChange('accountNumber', e.target.value)}
                disabled={disabled}
                className="h-7 text-sm flex-1"
              />
            </div>
          </DirtyFieldWrapper>
        </div>

        {/* City | TIN Type */}
        <div className="grid grid-cols-2 gap-4">
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.city}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-foreground whitespace-nowrap min-w-[140px]">City</Label>
              <Input
                value={getValue('city')}
                onChange={(e) => handleChange('city', e.target.value)}
                disabled={disabled}
                className="h-7 text-sm flex-1"
              />
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.tinType}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-foreground whitespace-nowrap min-w-[120px]">TIN Type</Label>
              <Select
                value={getValue('tinType')}
                onValueChange={(value) => handleChange('tinType', value)}
                disabled={disabled}
              >
                <SelectTrigger className="h-7 text-sm flex-1 bg-background">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  {TIN_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>
        </div>

        {/* State | TIN */}
        <div className="grid grid-cols-2 gap-4">
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.state}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-foreground whitespace-nowrap min-w-[140px]">State</Label>
              <Select
                value={getValue('state')}
                onValueChange={(value) => handleChange('state', value)}
                disabled={disabled}
              >
                <SelectTrigger className="h-7 text-sm flex-1 bg-background">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="bg-background z-50 max-h-60">
                  {STATE_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.tin}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-foreground whitespace-nowrap min-w-[120px]">TIN</Label>
              <Input
                value={getValue('tin')}
                onChange={(e) => handleChange('tin', e.target.value)}
                disabled={disabled}
                className="h-7 text-sm flex-1"
              />
            </div>
          </DirtyFieldWrapper>
        </div>

        {/* ZIP | Send 1099 */}
        <div className="grid grid-cols-2 gap-4">
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.zip}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-foreground whitespace-nowrap min-w-[140px]">ZIP</Label>
              <ZipInput
                value={getValue('zip')}
                onValueChange={(v) => handleChange('zip', v)}
                disabled={disabled}
                className="h-7 text-sm"
              />
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.send1099}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-foreground whitespace-nowrap min-w-[120px]">Send 1099</Label>
              <Checkbox
                checked={getValue('send1099') === 'true'}
                onCheckedChange={(checked) => handleChange('send1099', checked === true ? 'true' : 'false')}
                disabled={disabled}
              />
            </div>
          </DirtyFieldWrapper>
        </div>
      </div>
    </div>
  );
};

export default LenderTaxInfoForm;
