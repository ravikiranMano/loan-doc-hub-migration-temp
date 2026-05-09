import React, { useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import { EmailInput } from '@/components/ui/email-input';
import { ZipInput } from '@/components/ui/zip-input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
import BorrowerIdSearch from './BorrowerIdSearch';

const FORD_DROPDOWN_OPTIONS = [
  { value: 'Spouse, Kids, Grandkids', label: 'Spouse, Kids, Grandkids' },
  { value: 'Big Dream', label: 'Big Dream' },
  { value: 'Sports Teams', label: 'Sports Teams' },
  { value: 'Hobbies / Collections', label: 'Hobbies / Collections' },
  { value: 'Goals / Achievements', label: 'Goals / Achievements' },
  { value: 'Favorite Restaurant, Food, Drinks', label: 'Favorite Restaurant, Food, Drinks' },
  { value: 'Pet(s)', label: 'Pet(s)' },
  { value: 'Vacation Spot', label: 'Vacation Spot' },
  { value: 'Job / Occupation', label: 'Job / Occupation' },
  { value: 'Music / Bands', label: 'Music / Bands' },
  { value: 'College', label: 'College' },
  { value: 'Hometown / Childhood', label: 'Hometown / Childhood' },
  { value: 'TV / Movies / Books', label: 'TV / Movies / Books' },
  { value: 'Anniversary', label: 'Anniversary' },
  { value: 'Challenges / Frustrations', label: 'Challenges / Frustrations' },
  { value: 'Charity / Personal Causes', label: 'Charity / Personal Causes' },
  { value: 'Upcoming Event - What / When', label: 'Upcoming Event - What / When' },
  { value: 'Celebration - What / When', label: 'Celebration - What / When' },
];

const BORROWER_TYPE_OPTIONS = [
  'Individual',
  'Joint',
  'Family Trust',
  'LLC',
  'C Corp / S Corp',
  'IRA / ERISA',
  'Investment Fund',
  '401K',
  'Foreign Holder W-8',
  'Non-profit',
];

const CAPACITY_OPTIONS = [
  'Trustee', 'Successor Trustee', 'Authorized Signer', 'President', 'CEO',
  'Power of Attorney', 'Member', 'Manager', 'Partner', 'Attorney',
];

import { STATE_OPTIONS } from '@/lib/usStates';

import { BORROWER_PRIMARY_KEYS } from '@/lib/fieldKeyMap';

// Use central field key map
const FIELD_KEYS = BORROWER_PRIMARY_KEYS;

interface BorrowerPrimaryFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
  /** When true, render Borrower ID as a contact lookup that pulls existing borrower data on select. */
  borrowerIdLookup?: boolean;
}

const InlineField = ({ label, children, labelWidth = 'min-w-[140px]', fieldKey }: { label: string; children: React.ReactNode; labelWidth?: string; fieldKey?: string }) => {
  const content = (
    <div className="flex items-center gap-3">
      <Label className={`text-sm text-muted-foreground ${labelWidth} text-left shrink-0`}>{label}</Label>
      <div className="flex-1">{children}</div>
    </div>
  );
  if (fieldKey) {
    return <DirtyFieldWrapper fieldKey={fieldKey}>{content}</DirtyFieldWrapper>;
  }
  return content;
};

export const BorrowerPrimaryForm: React.FC<BorrowerPrimaryFormProps> = ({
  fields,
  values,
  onValueChange,
  showValidation = false,
  disabled = false,
  borrowerIdLookup = false,
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

  const handleSameAsPrimaryChange = (checked: boolean) => {
    handleChange('mailingSameAsPrimary', checked);
    if (checked) {
      handleChange('mailingStreet', getValue('primaryStreet'));
      handleChange('mailingCity', getValue('primaryCity'));
      handleChange('mailingState', getValue('primaryState'));
      handleChange('mailingZip', getValue('primaryZip'));
    } else {
      handleChange('mailingStreet', '');
      handleChange('mailingCity', '');
      handleChange('mailingState', '');
      handleChange('mailingZip', '');
    }
  };

  const isSameAsPrimary = getBoolValue('mailingSameAsPrimary');
  const primaryStreetVal = getValue('primaryStreet');
  const primaryCityVal = getValue('primaryCity');
  const primaryStateVal = getValue('primaryState');
  const primaryZipVal = getValue('primaryZip');

  useEffect(() => {
    if (isSameAsPrimary) {
      const mappings: [keyof typeof FIELD_KEYS, string][] = [
        ['mailingStreet', primaryStreetVal],
        ['mailingCity', primaryCityVal],
        ['mailingState', primaryStateVal],
        ['mailingZip', primaryZipVal],
      ];
      mappings.forEach(([dst, srcVal]) => {
        if (getValue(dst) !== srcVal) handleChange(dst, srcVal);
      });
    }
  }, [isSameAsPrimary, primaryStreetVal, primaryCityVal, primaryStateVal, primaryZipVal]);

  const phoneRows: { key: keyof typeof FIELD_KEYS; prefKey: keyof typeof FIELD_KEYS; label: string; prefId: string; hasPreferred?: boolean }[] = [
    { key: 'phoneHome', prefKey: 'preferredHome', label: 'Home', prefId: 'prefHome' },
    { key: 'phoneHome2', prefKey: 'preferredHome2', label: 'Home', prefId: 'prefHome2' },
    { key: 'phoneWork', prefKey: 'preferredWork', label: 'Work', prefId: 'prefWork' },
    { key: 'phoneCell', prefKey: 'preferredCell', label: 'Cell', prefId: 'prefCell' },
    { key: 'phoneFax', prefKey: 'preferredFax', label: 'Fax', prefId: 'prefFax' },
  ];

  return (
    <div className="p-4">
      <div className="grid gap-x-4 gap-y-0" style={{ gridTemplateColumns: '1.2fr 1.2fr 1.2fr auto' }}>
        {/* Column 1 - Name + Tax Info */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm text-foreground pb-1">Borrower Details</h4>

          <InlineField label="Borrower ID" fieldKey={FIELD_KEYS.borrowerId}>
            <Input value={getValue('borrowerId')} onChange={(e) => handleChange('borrowerId', e.target.value)} disabled={disabled} className="h-7 text-sm" />
          </InlineField>

          <InlineField label="Borrower Type" fieldKey={FIELD_KEYS.borrowerType}>
            <Select value={getValue('borrowerType')} onValueChange={(value) => handleChange('borrowerType', value)} disabled={disabled}>
              <SelectTrigger className="h-7 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{BORROWER_TYPE_OPTIONS.map((opt) => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}</SelectContent>
            </Select>
          </InlineField>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.fullName}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[140px] text-left shrink-0">Entity Name</Label>
              <Input value={getValue('fullName')} onChange={(e) => handleChange('fullName', e.target.value)} disabled={disabled} className="h-7 text-sm" />
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.firstName}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[140px] text-left shrink-0">First</Label>
              <Input value={getValue('firstName')} onChange={(e) => handleChange('firstName', e.target.value)} disabled={disabled} className="h-7 text-sm" />
            </div>
          </DirtyFieldWrapper>

          <InlineField label="Middle" fieldKey={FIELD_KEYS.middleName}>
            <Input value={getValue('middleName')} onChange={(e) => handleChange('middleName', e.target.value)} disabled={disabled} className="h-7 text-sm" />
          </InlineField>

          <InlineField label="Last" fieldKey={FIELD_KEYS.lastName}>
            <Input value={getValue('lastName')} onChange={(e) => handleChange('lastName', e.target.value)} disabled={disabled} className="h-7 text-sm" />
          </InlineField>

          <InlineField label="Capacity" fieldKey={FIELD_KEYS.capacity}>
            <Select value={getValue('capacity')} onValueChange={(value) => handleChange('capacity', value)} disabled={disabled}>
              <SelectTrigger className="h-7 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {CAPACITY_OPTIONS.map((opt) => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}
              </SelectContent>
            </Select>
          </InlineField>

          <InlineField label="Email" fieldKey={FIELD_KEYS.email}>
            <EmailInput value={getValue('email')} onValueChange={(v) => handleChange('email', v)} disabled={disabled} className="h-7 text-sm" />
          </InlineField>

          <div className="pt-2">
            <h4 className="font-semibold text-sm text-foreground pb-1">Delivery Options</h4>
            <div className="flex items-center gap-4">
              <DirtyFieldWrapper fieldKey={FIELD_KEYS.deliveryPrint}>
                <div className="flex items-center gap-1.5">
                  <Checkbox id="borrower-deliveryPrint" checked={getBoolValue('deliveryPrint')} onCheckedChange={(checked) => handleChange('deliveryPrint', !!checked)} disabled={disabled} />
                  <Label htmlFor="borrower-deliveryPrint" className="text-sm font-normal">Print</Label>
                </div>
              </DirtyFieldWrapper>
              <DirtyFieldWrapper fieldKey={FIELD_KEYS.deliveryEmail}>
                <div className="flex items-center gap-1.5">
                  <Checkbox id="borrower-deliveryEmail" checked={getBoolValue('deliveryEmail')} onCheckedChange={(checked) => handleChange('deliveryEmail', !!checked)} disabled={disabled} />
                  <Label htmlFor="borrower-deliveryEmail" className="text-sm font-normal">Email</Label>
                </div>
              </DirtyFieldWrapper>
              <DirtyFieldWrapper fieldKey={FIELD_KEYS.deliverySms}>
                <div className="flex items-center gap-1.5">
                  <Checkbox id="borrower-deliverySms" checked={getBoolValue('deliverySms')} onCheckedChange={(checked) => handleChange('deliverySms', !!checked)} disabled={disabled} />
                  <Label htmlFor="borrower-deliverySms" className="text-sm font-normal">SMS</Label>
                </div>
              </DirtyFieldWrapper>
            </div>
          </div>

          <div className="h-0.5" />

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.agreementOnFile}>
            <div className="flex items-center gap-2">
              <Checkbox id="borrower-agreementOnFile" checked={getBoolValue('agreementOnFile')} onCheckedChange={(checked) => handleChange('agreementOnFile', !!checked)} disabled={disabled} />
              <Label htmlFor="borrower-agreementOnFile" className="text-sm font-normal">Agreement on File</Label>
              <Input
                type="date"
                value={getValue('agreementOnFileDate')}
                onChange={(e) => handleChange('agreementOnFileDate', e.target.value)}
                disabled={disabled}
                className="h-7 text-sm w-[140px]"
              />
            </div>
          </DirtyFieldWrapper>
        </div>

        {/* Column 2 - Primary Address & Mailing Address & Delivery Options & Send */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm text-foreground pb-1">Primary Address</h4>

          <InlineField label="Street" labelWidth="min-w-[60px]" fieldKey={FIELD_KEYS.primaryStreet}>
            <Input value={getValue('primaryStreet')} onChange={(e) => handleChange('primaryStreet', e.target.value)} disabled={disabled} className="h-7 text-sm" />
          </InlineField>

          <InlineField label="City" labelWidth="min-w-[60px]" fieldKey={FIELD_KEYS.primaryCity}>
            <Input value={getValue('primaryCity')} onChange={(e) => handleChange('primaryCity', e.target.value)} disabled={disabled} className="h-7 text-sm" />
          </InlineField>

          <InlineField label="State" labelWidth="min-w-[60px]" fieldKey={FIELD_KEYS.primaryState}>
            <Select value={getValue('primaryState')} onValueChange={(value) => handleChange('primaryState', value)} disabled={disabled}>
              <SelectTrigger className="h-7 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{STATE_OPTIONS.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}</SelectContent>
            </Select>
          </InlineField>

          <InlineField label="ZIP" labelWidth="min-w-[60px]" fieldKey={FIELD_KEYS.primaryZip}>
            <ZipInput value={getValue('primaryZip')} onValueChange={(v) => handleChange('primaryZip', v)} disabled={disabled} className="h-7 text-sm" />
          </InlineField>

          <h4 className="font-semibold text-sm text-foreground pb-1 pt-2 flex items-center gap-3">
            Mailing Address
            <div className="flex items-center gap-1.5 ml-4">
              <Checkbox id="borrower-mailingSameAsPrimary" checked={getBoolValue('mailingSameAsPrimary')} onCheckedChange={(checked) => handleSameAsPrimaryChange(!!checked)} disabled={disabled} />
              <Label htmlFor="borrower-mailingSameAsPrimary" className="text-xs font-normal text-muted-foreground">Same as Primary</Label>
            </div>
          </h4>

          <InlineField label="Street" labelWidth="min-w-[60px]" fieldKey={FIELD_KEYS.mailingStreet}>
            <Input value={getValue('mailingStreet')} onChange={(e) => handleChange('mailingStreet', e.target.value)} disabled={disabled || getBoolValue('mailingSameAsPrimary')} className="h-7 text-sm" />
          </InlineField>

          <InlineField label="City" labelWidth="min-w-[60px]" fieldKey={FIELD_KEYS.mailingCity}>
            <Input value={getValue('mailingCity')} onChange={(e) => handleChange('mailingCity', e.target.value)} disabled={disabled || getBoolValue('mailingSameAsPrimary')} className="h-7 text-sm" />
          </InlineField>

          <InlineField label="State" labelWidth="min-w-[60px]" fieldKey={FIELD_KEYS.mailingState}>
            <Select value={getValue('mailingState')} onValueChange={(value) => handleChange('mailingState', value)} disabled={disabled || getBoolValue('mailingSameAsPrimary')}>
              <SelectTrigger className="h-7 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{STATE_OPTIONS.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}</SelectContent>
            </Select>
          </InlineField>

          <InlineField label="ZIP" labelWidth="min-w-[60px]" fieldKey={FIELD_KEYS.mailingZip}>
            <ZipInput value={getValue('mailingZip')} onValueChange={(v) => handleChange('mailingZip', v)} disabled={disabled || getBoolValue('mailingSameAsPrimary')} className="h-7 text-sm" />
          </InlineField>

          <div className="pt-2 space-y-2">
            <div>
              <h4 className="font-semibold text-sm text-foreground pb-1">Send</h4>
              <div className="flex items-center gap-4 flex-wrap">
                <DirtyFieldWrapper fieldKey={FIELD_KEYS.sendPaymentConfirmation}>
                  <div className="flex items-center gap-1.5">
                    <Checkbox id="borrower-sendPaymentConfirmation" checked={getBoolValue('sendPaymentConfirmation')} onCheckedChange={(checked) => handleChange('sendPaymentConfirmation', !!checked)} disabled={disabled} />
                    <Label htmlFor="borrower-sendPaymentConfirmation" className="text-sm font-normal">Payment Confirmation</Label>
                  </div>
                </DirtyFieldWrapper>
                <DirtyFieldWrapper fieldKey={FIELD_KEYS.sendCouponBook}>
                  <div className="flex items-center gap-1.5">
                    <Checkbox id="borrower-sendCouponBook" checked={getBoolValue('sendCouponBook')} onCheckedChange={(checked) => handleChange('sendCouponBook', !!checked)} disabled={disabled} />
                    <Label htmlFor="borrower-sendCouponBook" className="text-sm font-normal">Coupon Book</Label>
                  </div>
                </DirtyFieldWrapper>
                <DirtyFieldWrapper fieldKey={FIELD_KEYS.sendPaymentStatement}>
                  <div className="flex items-center gap-1.5">
                    <Checkbox id="borrower-sendPaymentStatement" checked={getBoolValue('sendPaymentStatement')} onCheckedChange={(checked) => handleChange('sendPaymentStatement', !!checked)} disabled={disabled} />
                    <Label htmlFor="borrower-sendPaymentStatement" className="text-sm font-normal">Payment Statement</Label>
                  </div>
                </DirtyFieldWrapper>
                <DirtyFieldWrapper fieldKey={FIELD_KEYS.sendLateNotice}>
                  <div className="flex items-center gap-1.5">
                    <Checkbox id="borrower-sendLateNotice" checked={getBoolValue('sendLateNotice')} onCheckedChange={(checked) => handleChange('sendLateNotice', !!checked)} disabled={disabled} />
                    <Label htmlFor="borrower-sendLateNotice" className="text-sm font-normal">Late Notice</Label>
                  </div>
                </DirtyFieldWrapper>
                <DirtyFieldWrapper fieldKey={FIELD_KEYS.sendMaturityNotice}>
                  <div className="flex items-center gap-1.5">
                    <Checkbox id="borrower-sendMaturityNotice" checked={getBoolValue('sendMaturityNotice')} onCheckedChange={(checked) => handleChange('sendMaturityNotice', !!checked)} disabled={disabled} />
                    <Label htmlFor="borrower-sendMaturityNotice" className="text-sm font-normal">Maturity Notice</Label>
                  </div>
                </DirtyFieldWrapper>
              </div>
            </div>
          </div>
        </div>

        {/* Column 3 - Phone + Vesting + FORD */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm text-foreground pb-1">Phone</h4>
          {phoneRows.map(({ key, label }) => (
            <DirtyFieldWrapper key={key} fieldKey={FIELD_KEYS[key]}>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground min-w-[40px] text-left shrink-0">{label}</Label>
                <PhoneInput value={getValue(key)} onValueChange={(val) => handleChange(key, val)} disabled={disabled} className="h-7 text-sm flex-1" />
              </div>
            </DirtyFieldWrapper>
          ))}

          <h4 className="font-semibold text-sm text-foreground pb-1 pt-2">Vesting</h4>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.vesting}>
            <Textarea value={getValue('vesting')} onChange={(e) => handleChange('vesting', e.target.value)} disabled={disabled} className="text-sm min-h-[80px] resize-none" />
          </DirtyFieldWrapper>

          <h4 className="font-semibold text-sm text-foreground pb-1 pt-2">FORD</h4>
          <div className="space-y-1">
            {([['ford1', 'ford2'], ['ford3', 'ford4'], ['ford5', 'ford6'], ['ford7', 'ford8']] as const).map(([dropdownKey, inputKey], idx) => (
              <div key={idx} className="grid grid-cols-2 gap-1">
                <DirtyFieldWrapper fieldKey={FIELD_KEYS[dropdownKey]}>
                  <Select value={getValue(dropdownKey)} onValueChange={(v) => handleChange(dropdownKey, v)} disabled={disabled}>
                    <SelectTrigger className="h-7 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{FORD_DROPDOWN_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                </DirtyFieldWrapper>
                <DirtyFieldWrapper fieldKey={FIELD_KEYS[inputKey]}>
                  <Input value={getValue(inputKey)} onChange={(e) => handleChange(inputKey, e.target.value)} disabled={disabled} className="h-7 text-sm" />
                </DirtyFieldWrapper>
              </div>
            ))}
          </div>
        </div>

        {/* Column 4 - Preferred (narrow) */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm text-foreground pb-1">Preferred</h4>
          <RadioGroup
            value={(phoneRows.find(({ prefKey }) => getBoolValue(prefKey))?.prefKey as string) || ''}
            onValueChange={(val) => {
              phoneRows.forEach(({ prefKey }) => {
                handleChange(prefKey, prefKey === val);
              });
            }}
            className="space-y-0"
            disabled={disabled}
          >
            {phoneRows.filter(({ key }) => key !== 'phoneFax').map(({ key, prefKey, prefId, hasPreferred }) => (
              hasPreferred === false ? (
                <div key={prefId} className="flex items-center justify-center h-7" />
              ) : (
                <DirtyFieldWrapper key={prefId} fieldKey={FIELD_KEYS[prefKey]}>
                  <div className="flex items-center justify-center h-7">
                    <RadioGroupItem id={`borrower-${prefId}`} value={prefKey} disabled={disabled} />
                  </div>
                </DirtyFieldWrapper>
              )
            ))}
            {/* Fax has no preferred slot — render spacer to keep alignment */}
            <div className="h-7" />
          </RadioGroup>
        </div>
      </div>
    </div>
  );
};

export default BorrowerPrimaryForm;
