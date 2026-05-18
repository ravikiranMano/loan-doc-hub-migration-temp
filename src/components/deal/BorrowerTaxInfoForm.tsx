import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
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

interface BorrowerTaxInfoFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

const FIELD_KEYS = {
  designatedRecipient: 'borrower.tax_info.designated_recipient',
  issue1098: 'borrower.tax_info.issue_1098',
  tinNumber: 'borrower.tax_info.tin_number',
  tinType: 'borrower.tax_info.tin_type',
  tinVerified: 'borrower.tax_info.tin_verified',
  alternateReporting: 'borrower.tax_info.alternate_reporting',
  notes: 'borrower.tax_info.notes',
} as const;

const TIN_TYPE_OPTIONS = [
  { value: '0', label: '0 - Unknown' },
  { value: '1', label: '1 - EIN' },
  { value: '2', label: '2 - SSN' },
];

export const BorrowerTaxInfoForm: React.FC<BorrowerTaxInfoFormProps> = ({
  values,
  onValueChange,
  disabled = false,
}) => {
  const getValue = (key: keyof typeof FIELD_KEYS): string => values[FIELD_KEYS[key]] || '';
  const handleChange = (key: keyof typeof FIELD_KEYS, value: string) =>
    onValueChange(FIELD_KEYS[key], value);

  return (
    <div className="p-6">
      <div className="border-b border-border pb-2 mb-4">
        <span className="font-semibold text-base text-foreground">Tax Reporting</span>
      </div>

      <div className="max-w-[700px] space-y-3">
        {/* Designated Recipient */}
        <DirtyFieldWrapper fieldKey={FIELD_KEYS.designatedRecipient}>
          <div className="flex items-center gap-3">
            <Label className="text-sm text-foreground whitespace-nowrap min-w-[140px]">
              Designated Recipient
            </Label>
            <Checkbox
              checked={getValue('designatedRecipient') === 'true'}
              onCheckedChange={(checked) =>
                handleChange('designatedRecipient', checked === true ? 'true' : 'false')
              }
              disabled={disabled}
            />
          </div>
        </DirtyFieldWrapper>

        {/* Issue 1098 */}
        <DirtyFieldWrapper fieldKey={FIELD_KEYS.issue1098}>
          <div className="flex items-center gap-3">
            <Label className="text-sm text-foreground whitespace-nowrap min-w-[140px]">
              Issue 1098
            </Label>
            <Checkbox
              checked={getValue('issue1098') === 'true'}
              onCheckedChange={(checked) =>
                handleChange('issue1098', checked === true ? 'true' : 'false')
              }
              disabled={disabled}
            />
          </div>
        </DirtyFieldWrapper>

        {/* TIN Number */}
        <DirtyFieldWrapper fieldKey={FIELD_KEYS.tinNumber}>
          <div className="flex items-center gap-3">
            <Label className="text-sm text-foreground whitespace-nowrap min-w-[140px]">
              TIN Number
            </Label>
            <Input
              value={getValue('tinNumber')}
              onChange={(e) =>
                handleChange('tinNumber', e.target.value.replace(/\D/g, '').slice(0, 9))
              }
              disabled={disabled}
              maxLength={9}
              inputMode="numeric"
              className="h-7 text-sm flex-1 max-w-[260px]"
            />
          </div>
        </DirtyFieldWrapper>

        {/* TIN Type */}
        <DirtyFieldWrapper fieldKey={FIELD_KEYS.tinType}>
          <div className="flex items-center gap-3">
            <Label className="text-sm text-foreground whitespace-nowrap min-w-[140px]">
              TIN Type
            </Label>
            <Select
              value={getValue('tinType') || undefined}
              onValueChange={(value) => handleChange('tinType', value)}
              disabled={disabled}
            >
              <SelectTrigger className="h-7 text-sm flex-1 max-w-[260px] bg-background">
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

        {/* TIN Verified */}
        <DirtyFieldWrapper fieldKey={FIELD_KEYS.tinVerified}>
          <div className="flex items-center gap-3">
            <Label className="text-sm text-foreground whitespace-nowrap min-w-[140px]">
              TIN Verified
            </Label>
            <Checkbox
              checked={getValue('tinVerified') === 'true'}
              onCheckedChange={(checked) =>
                handleChange('tinVerified', checked === true ? 'true' : 'false')
              }
              disabled={disabled}
            />
          </div>
        </DirtyFieldWrapper>

        {/* Alternate Reporting */}
        <DirtyFieldWrapper fieldKey={FIELD_KEYS.alternateReporting}>
          <div className="flex items-center gap-3">
            <Label className="text-sm text-foreground whitespace-nowrap min-w-[140px]">
              Alternate Reporting
            </Label>
            <Checkbox
              checked={getValue('alternateReporting') === 'true'}
              onCheckedChange={(checked) =>
                handleChange('alternateReporting', checked === true ? 'true' : 'false')
              }
              disabled={disabled}
            />
          </div>
        </DirtyFieldWrapper>

        {/* Notes */}
        <DirtyFieldWrapper fieldKey={FIELD_KEYS.notes}>
          <div className="flex flex-col gap-1 pt-2">
            <Label className="text-sm text-foreground">Notes:</Label>
            <Textarea
              value={getValue('notes')}
              onChange={(e) => handleChange('notes', e.target.value.slice(0, 2000))}
              disabled={disabled}
              maxLength={2000}
              rows={4}
              className="text-sm"
            />
          </div>
        </DirtyFieldWrapper>
      </div>
    </div>
  );
};

export default BorrowerTaxInfoForm;
