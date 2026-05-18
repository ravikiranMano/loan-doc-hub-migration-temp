import React from 'react';
import { DealSectionTab } from './DealSectionTab';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { FieldDefinition } from '@/hooks/useDealFields';
import type { CalculationResult } from '@/lib/calculationEngine';

interface Props {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

// Same option set as Loan > Terms & Balances "Payment Frequency"
const PAYMENT_FREQUENCY_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'bi_weekly', label: 'Bi-Weekly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
  { value: 'semi_annually', label: 'Semi-Annually' },
];

// Hide duplicated label variants (keys ending with a digit) for these labels.
// The base key (e.g. es_p_amount) is preserved; es_p_amount2 / _3 are hidden.
const DUPLICATE_BASE_KEYS = new Set([
  'es_p_amount',
  'es_p_frequenc',
  'es_p_payee',
  'es_p_type',
  'es_p_memo',
]);

const isHiddenDuplicate = (fieldKey: string): boolean => {
  // Match base key followed by one or more digits: es_p_amount2, es_p_memo3, etc.
  const m = fieldKey.match(/^(es_p_[a-zA-Z]+?)\d+$/);
  if (!m) return false;
  return DUPLICATE_BASE_KEYS.has(m[1]);
};

export const EscrowImpoundForm: React.FC<Props> = ({
  fields,
  values,
  onValueChange,
  showValidation = false,
  disabled = false,
  calculationResults = {},
}) => {
  // 1) Strip duplicate label variants
  const dedupedFields = fields.filter(f => !isHiddenDuplicate(f.field_key));

  // 2) Replace the Frequency text field with a dropdown by rendering it
  //    separately and removing it from the DealSectionTab list.
  const frequencyField = dedupedFields.find(f => f.field_key === 'es_p_frequenc');
  const remainingFields = dedupedFields.filter(f => f.field_key !== 'es_p_frequenc');

  return (
    <div className="space-y-4">
      <DealSectionTab
        fields={remainingFields}
        values={values}
        onValueChange={onValueChange}
        missingRequiredFields={remainingFields.filter(
          f => f.is_required && !values[f.field_key]
        )}
        showValidation={showValidation}
        calculationResults={calculationResults}
        hideValidationStatus
        hidePlaceholders
        gridColumnsClass="grid-cols-2"
      />

      {frequencyField && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
          <div
            id={`field-${frequencyField.field_key}`}
            className={cn('space-y-0.5 rounded-sm px-1 -mx-1')}
          >
            <div className="flex items-start gap-2">
              <div className="flex items-center gap-1 w-[140px] shrink-0 pt-1.5">
                <Label
                  htmlFor={frequencyField.field_key}
                  className="text-xs font-medium leading-tight"
                >
                  {frequencyField.label}
                </Label>
              </div>
              <div className="flex-1 min-w-0">
                <Select
                  value={values[frequencyField.field_key] || undefined}
                  onValueChange={(val) => onValueChange(frequencyField.field_key, val)}
                  disabled={disabled}
                >
                  <SelectTrigger id={frequencyField.field_key} className="h-8 text-sm">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent className="z-[100]">
                    {PAYMENT_FREQUENCY_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EscrowImpoundForm;
