import React from 'react';
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
import type { FieldDefinition } from '@/hooks/useDealFields';
import type { CalculationResult } from '@/lib/calculationEngine';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';

interface CoBorrowerTaxDetailFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

const TAX_FILING_STATUS_OPTIONS = [
  'Single',
  'Married Filing Jointly',
  'Married Filing Separately',
  'Head of Household',
  'Qualifying Widow(er)',
];

const TAX_ID_TYPE_OPTIONS = ['SSN', 'EIN', 'ITIN'];

export const CoBorrowerTaxDetailForm: React.FC<CoBorrowerTaxDetailFormProps> = ({
  values,
  onValueChange,
  disabled = false,
}) => {
  const getValue = (key: string) => values[`coborrower.${key}`] || '';
  const getBoolValue = (key: string) => values[`coborrower.${key}`] === 'true';
  const fk = (key: string) => `coborrower.${key}`;

  const handleChange = (key: string, value: string) => {
    onValueChange(`coborrower.${key}`, value);
  };

  return (
    <div className="p-4 space-y-4">
      <h3 className="font-semibold text-lg text-foreground">1098</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Column - Tax Identification */}
        <div className="space-y-3">
          <h4 className="font-semibold text-sm text-foreground border-b border-border pb-2">Tax Identification</h4>
          
          <DirtyFieldWrapper fieldKey={fk('tax_id_type')}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Tax ID Type</Label>
              <Select value={getValue('tax_id_type')} onValueChange={(value) => handleChange('tax_id_type', value)} disabled={disabled}>
                <SelectTrigger className="h-7 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{TAX_ID_TYPE_OPTIONS.map((type) => (<SelectItem key={type} value={type}>{type}</SelectItem>))}</SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={fk('tax_id')}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Tax ID / SSN</Label>
              <Input value={getValue('tax_id')} onChange={(e) => handleChange('tax_id', e.target.value)} placeholder="Enter tax ID" disabled={disabled} className="h-7 text-sm" />
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={fk('tax.filing_status')}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Filing Status</Label>
              <Select value={getValue('tax.filing_status')} onValueChange={(value) => handleChange('tax.filing_status', value)} disabled={disabled}>
                <SelectTrigger className="h-7 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{TAX_FILING_STATUS_OPTIONS.map((status) => (<SelectItem key={status} value={status}>{status}</SelectItem>))}</SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={fk('tax.exempt')}>
            <div className="flex items-center gap-2">
              <Checkbox id="taxExempt" checked={getBoolValue('tax.exempt')} onCheckedChange={(checked) => handleChange('tax.exempt', String(!!checked))} disabled={disabled} />
              <Label htmlFor="taxExempt" className="text-sm font-normal">Tax Exempt</Label>
            </div>
          </DirtyFieldWrapper>
        </div>

        {/* Right Column - Additional Tax Info */}
        <div className="space-y-3">
          <h4 className="font-semibold text-sm text-foreground border-b border-border pb-2">Additional Tax Information</h4>
          
          <DirtyFieldWrapper fieldKey={fk('tax.year')}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Tax Year</Label>
              <Input value={getValue('tax.year')} onChange={(e) => handleChange('tax.year', e.target.value)} placeholder="Enter year" disabled={disabled} className="h-7 text-sm" />
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={fk('tax.annual_income')}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Annual Income</Label>
              <Input type="number" value={getValue('tax.annual_income')} onChange={(e) => handleChange('tax.annual_income', e.target.value)} placeholder="Enter income" disabled={disabled} className="h-7 text-sm" />
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={fk('tax.bracket')}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Tax Bracket (%)</Label>
              <Input type="number" value={getValue('tax.bracket')} onChange={(e) => handleChange('tax.bracket', e.target.value)} placeholder="Enter %" disabled={disabled} className="h-7 text-sm" />
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={fk('tax.notes')}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Notes</Label>
              <Input value={getValue('tax.notes')} onChange={(e) => handleChange('tax.notes', e.target.value)} placeholder="Enter notes" disabled={disabled} className="h-7 text-sm" />
            </div>
          </DirtyFieldWrapper>
        </div>
      </div>
    </div>
  );
};

export default CoBorrowerTaxDetailForm;
