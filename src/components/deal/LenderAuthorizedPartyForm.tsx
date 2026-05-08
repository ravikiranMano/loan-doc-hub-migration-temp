import React from 'react';
import { Input } from '@/components/ui/input';
import { EmailInput } from '@/components/ui/email-input';
import { ZipInput } from '@/components/ui/zip-input';
import { PhoneInput } from '@/components/ui/phone-input';
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
import { US_STATES } from '@/lib/usStates';
import type { FieldDefinition } from '@/hooks/useDealFields';
import type { CalculationResult } from '@/lib/calculationEngine';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';

import { LENDER_AUTHORIZED_PARTY_KEYS } from '@/lib/fieldKeyMap';

// Use central field key map
const FIELD_KEYS = LENDER_AUTHORIZED_PARTY_KEYS;

const CAPACITY_OPTIONS = [
  { value: 'corporate_officer', label: 'Corporate Officer' },
  { value: 'attorney', label: 'Attorney' },
  { value: 'power_of_attorney', label: 'Power of Attorney' },
  { value: 'accountant_cpa', label: 'Accountant / CPA' },
  { value: 'family', label: 'Family' },
  { value: 'bankruptcy_trustee', label: 'Bankruptcy Trustee' },
  { value: 'other', label: 'Other' },
];

/** Only allow letters, spaces, hyphens, apostrophes */
const sanitizeName = (v: string) => v.replace(/[^a-zA-Z\s'\-]/g, '').slice(0, 100);

interface LenderAuthorizedPartyFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

export const LenderAuthorizedPartyForm: React.FC<LenderAuthorizedPartyFormProps> = ({
  values,
  onValueChange,
  disabled = false,
}) => {
  const getValue = (key: keyof typeof FIELD_KEYS): string => {
    return values[FIELD_KEYS[key]] || '';
  };

  const getBoolValue = (key: keyof typeof FIELD_KEYS): boolean => {
    return values[FIELD_KEYS[key]] === 'true';
  };

  const handleChange = (key: keyof typeof FIELD_KEYS, value: string | boolean) => {
    onValueChange(FIELD_KEYS[key], String(value));
  };

  const handleNameChange = (key: keyof typeof FIELD_KEYS, raw: string) => {
    handleChange(key, sanitizeName(raw));
  };

  const renderNameField = (key: keyof typeof FIELD_KEYS, label: string, labelWidth = 'min-w-[60px]') => (
    <DirtyFieldWrapper fieldKey={FIELD_KEYS[key]}>
      <div className="flex items-center gap-2">
        <Label className={`text-sm text-muted-foreground ${labelWidth}`}>{label}</Label>
        <Input
          value={getValue(key)}
          onChange={(e) => handleNameChange(key, e.target.value)}
          disabled={disabled}
          className="h-7 text-sm flex-1"
          maxLength={100}
        />
      </div>
    </DirtyFieldWrapper>
  );

  const renderPhoneField = (key: keyof typeof FIELD_KEYS, label: string, labelWidth = 'min-w-[40px]') => (
    <DirtyFieldWrapper fieldKey={FIELD_KEYS[key]}>
      <div className="flex items-center gap-2">
        <Label className={`text-sm text-muted-foreground ${labelWidth}`}>{label}</Label>
        <PhoneInput
          value={getValue(key)}
          onValueChange={(v) => handleChange(key, v)}
          disabled={disabled}
          className="h-7 text-sm flex-1"
        />
      </div>
    </DirtyFieldWrapper>
  );

  const renderInlineField = (key: keyof typeof FIELD_KEYS, label: string, labelWidth = 'min-w-[60px]', props: Record<string, any> = {}) => (
    <DirtyFieldWrapper fieldKey={FIELD_KEYS[key]}>
      <div className="flex items-center gap-2">
        <Label className={`text-sm text-muted-foreground ${labelWidth}`}>{label}</Label>
        <Input value={getValue(key)} onChange={(e) => handleChange(key, e.target.value)} disabled={disabled} className="h-7 text-sm flex-1" {...props} />
      </div>
    </DirtyFieldWrapper>
  );

  return (
    <div className="p-6">
      {/* Header */}
      <div className="border-b border-border pb-2 mb-4">
        <span className="font-semibold text-base text-foreground">Authorized Party</span>
      </div>

      {/* Top 3-column: Name | Address | Phone */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Name */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-foreground">Name</h4>
          <div className="space-y-2">
            {renderNameField('firstName', 'First')}
            {renderNameField('middleName', 'Middle')}
            {renderNameField('lastName', 'Last')}
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.capacity}>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground min-w-[60px]">Capacity</Label>
                <Select value={getValue('capacity')} onValueChange={(v) => handleChange('capacity', v)} disabled={disabled}>
                  <SelectTrigger className="h-7 text-sm flex-1 bg-background">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    {CAPACITY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </DirtyFieldWrapper>
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.email}>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground min-w-[60px]">Email</Label>
                <EmailInput value={getValue('email')} onValueChange={(v) => handleChange('email', v)} disabled={disabled} className="h-8 text-sm" />
              </div>
            </DirtyFieldWrapper>
          </div>
        </div>

        {/* Address */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-foreground">Address</h4>
          <div className="space-y-2">
            {renderInlineField('street', 'Street', 'min-w-[50px]')}
            {renderInlineField('city', 'City', 'min-w-[50px]')}
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.state}>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground min-w-[50px]">State</Label>
                <Select value={getValue('state')} onValueChange={(v) => handleChange('state', v)} disabled={disabled}>
                  <SelectTrigger className="h-7 text-sm flex-1 bg-background">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    <SelectItem value="__select__">Select</SelectItem>
                  {US_STATES.map(s => (
                      <SelectItem key={s} value={s} className="text-sm">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </DirtyFieldWrapper>
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.zip}>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground min-w-[50px]">ZIP</Label>
                <ZipInput value={getValue('zip')} onValueChange={(v) => handleChange('zip', v)} disabled={disabled} className="h-8 text-sm" />
              </div>
            </DirtyFieldWrapper>
          </div>
        </div>

        {/* Phone */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-foreground">Phone</h4>
          <div className="space-y-2">
            {renderPhoneField('phoneHome', 'Home')}
            {renderPhoneField('phoneWork', 'Work')}
            {renderPhoneField('phoneCell', 'Cell')}
            {renderPhoneField('phoneFax', 'Fax')}
          </div>
        </div>
      </div>

      {/* Bottom row: Send | Delivery | Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        {/* Send */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-foreground">Send:</h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.sendPaymentNotification}>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground">Payment Notification</Label>
                <Checkbox checked={getBoolValue('sendPaymentNotification')} onCheckedChange={(c) => handleChange('sendPaymentNotification', !!c)} disabled={disabled} />
              </div>
            </DirtyFieldWrapper>
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.sendBorrowerStatement}>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground">Borrower Statement</Label>
                <Checkbox checked={getBoolValue('sendBorrowerStatement')} onCheckedChange={(c) => handleChange('sendBorrowerStatement', !!c)} disabled={disabled} />
              </div>
            </DirtyFieldWrapper>
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.sendLateNotice}>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground">Late Notice</Label>
                <Checkbox checked={getBoolValue('sendLateNotice')} onCheckedChange={(c) => handleChange('sendLateNotice', !!c)} disabled={disabled} />
              </div>
            </DirtyFieldWrapper>
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.sendMaturityNotice}>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground">Maturity Notice</Label>
                <Checkbox checked={getBoolValue('sendMaturityNotice')} onCheckedChange={(c) => handleChange('sendMaturityNotice', !!c)} disabled={disabled} />
              </div>
            </DirtyFieldWrapper>
          </div>
        </div>

        {/* Delivery */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-foreground">Delivery</h4>
          <div className="space-y-2">
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.deliveryEmail}>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground min-w-[40px]">Online</Label>
                <Checkbox checked={getBoolValue('deliveryEmail')} onCheckedChange={(c) => handleChange('deliveryEmail', !!c)} disabled={disabled} />
              </div>
            </DirtyFieldWrapper>
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.deliveryMail}>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground min-w-[40px]">Mail</Label>
                <Checkbox checked={getBoolValue('deliveryMail')} onCheckedChange={(c) => handleChange('deliveryMail', !!c)} disabled={disabled} />
              </div>
            </DirtyFieldWrapper>
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.deliverySms}>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground min-w-[40px]">SMS</Label>
                <Checkbox checked={getBoolValue('deliverySms')} onCheckedChange={(c) => handleChange('deliverySms', !!c)} disabled={disabled} />
              </div>
            </DirtyFieldWrapper>
          </div>
        </div>

        {/* Details */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-foreground">Details</h4>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.details}>
            <Textarea
              value={getValue('details')}
              onChange={(e) => handleChange('details', e.target.value)}
              disabled={disabled}
              className="min-h-[80px] text-sm"
            />
          </DirtyFieldWrapper>
        </div>
      </div>
    </div>
  );
};

export default LenderAuthorizedPartyForm;
