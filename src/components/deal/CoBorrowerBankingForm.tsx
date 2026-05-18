import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

interface CoBorrowerBankingFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

const ACCOUNT_TYPE_OPTIONS = ['Checking', 'Savings', 'Money Market', 'Other'];

export const CoBorrowerBankingForm: React.FC<CoBorrowerBankingFormProps> = ({
  values,
  onValueChange,
  disabled = false,
}) => {
  const getValue = (key: string) => values[`coborrower.${key}`] || '';
  const fk = (key: string) => `coborrower.${key}`;

  const handleChange = (key: string, value: string) => {
    onValueChange(`coborrower.${key}`, value);
  };

  const renderField = (id: string, key: string, label: string, props: Record<string, any> = {}) => (
    <DirtyFieldWrapper fieldKey={fk(key)}>
      <div className="flex items-center gap-3">
        <Label htmlFor={id} className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">{label}</Label>
        <Input id={id} value={getValue(key)} onChange={(e) => handleChange(key, e.target.value)} disabled={disabled} className="h-7 text-sm flex-1" {...props} />
      </div>
    </DirtyFieldWrapper>
  );

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Column - Primary Bank Account */}
        <div className="space-y-3">
          <h4 className="font-semibold text-sm text-foreground border-b border-border pb-2">Primary Bank Account</h4>
          
          {renderField('bankName', 'bank.name', 'Bank Name', { placeholder: 'Enter bank name' })}

          <DirtyFieldWrapper fieldKey={fk('bank.account_type')}>
            <div className="flex items-center gap-3">
              <Label htmlFor="accountType" className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Account Type</Label>
              <Select value={getValue('bank.account_type')} onValueChange={(value) => handleChange('bank.account_type', value)} disabled={disabled}>
                <SelectTrigger className="h-7 text-sm flex-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{ACCOUNT_TYPE_OPTIONS.map((type) => (<SelectItem key={type} value={type}>{type}</SelectItem>))}</SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          {renderField('routingNumber', 'bank.routing_number', 'Routing Number', { placeholder: 'Enter routing number' })}
          {renderField('accountNumber', 'bank.account_number', 'Account Number', { placeholder: 'Enter account number' })}
          {renderField('accountHolder', 'bank.account_holder', 'Account Holder', { placeholder: 'Enter holder name' })}
        </div>

        {/* Right Column - Bank Address */}
        <div className="space-y-3">
          <h4 className="font-semibold text-sm text-foreground border-b border-border pb-2">Bank Address</h4>
          
          {renderField('bankStreet', 'bank.address.street', 'Street Address', { placeholder: 'Enter street' })}
          {renderField('bankCity', 'bank.address.city', 'City', { placeholder: 'Enter city' })}
          {renderField('bankState', 'bank.address.state', 'State', { placeholder: 'Enter state' })}
          {renderField('bankZip', 'bank.address.zip', 'Zip Code', { placeholder: 'Enter zip' })}
          {renderField('bankPhone', 'bank.phone', 'Bank Phone', { placeholder: 'Enter phone' })}
        </div>
      </div>
    </div>
  );
};

export default CoBorrowerBankingForm;
