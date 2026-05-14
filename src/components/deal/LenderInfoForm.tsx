import React, { useEffect, useState } from 'react';
import { format, parse, isValid } from 'date-fns';

const safeParseDateStr = (val: string): Date | undefined => {
  if (!val) return undefined;
  try {
    const d = parse(val, 'yyyy-MM-dd', new Date());
    return isValid(d) ? d : undefined;
  } catch {
    return undefined;
  }
};

const safeFormatDate = (val: string, fmt: string = 'MM/dd/yyyy'): string | undefined => {
  const d = safeParseDateStr(val);
  return d ? format(d, fmt) : undefined;
};
import { CalendarIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import { EmailInput } from '@/components/ui/email-input';
import { ZipInput } from '@/components/ui/zip-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { FieldDefinition } from '@/hooks/useDealFields';
import type { CalculationResult } from '@/lib/calculationEngine';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';
import { SearchableSelect } from '@/components/ui/searchable-select';

import { US_STATES } from '@/lib/usStates';

// Issue 1099 mapping based on Lender Type (per reference document)
const LENDER_TYPE_ISSUE_1099_MAP: Record<string, 'Yes' | 'No' | 'Situational'> = {
  'Individual': 'Yes',
  'Joint': 'Situational',
  'Family Trust': 'Situational',
  'LLC': 'Situational',
  'C Corp / S Corp': 'No',
  'IRA / ERISA': 'No',
  'Investment Fund': 'Situational',
  '401k': 'No',
  'Foreign Holder W-8': 'No',
  'Non-profit': 'No',
};

const ALWAYS_NO_1099_TYPES = ['C Corp / S Corp', 'IRA / ERISA', '401k', 'Foreign Holder W-8', 'Non-profit'];
const TAXED_AS_CORP_OPTIONS = ['Corporation', 'C Corp', 'S Corp'];

import { LENDER_INFO_KEYS } from '@/lib/fieldKeyMap';

// Use central field key map
const FIELD_KEYS = LENDER_INFO_KEYS;

const LENDER_TYPE_OPTIONS = [
  { value: 'Individual', label: 'Individual' },
  { value: 'Joint', label: 'Joint' },
  { value: 'Family Trust', label: 'Family Trust' },
  { value: 'LLC', label: 'LLC' },
  { value: 'C Corp / S Corp', label: 'C Corp / S Corp' },
  { value: 'IRA / ERISA', label: 'IRA / ERISA' },
  { value: 'Investment Fund', label: 'Investment Fund' },
  { value: '401k', label: '401k' },
  { value: 'Foreign Holder W-8', label: 'Foreign Holder W-8' },
  { value: 'Non-profit', label: 'Non-profit' },
];


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

const PHONE_FIELDS = [
  { label: 'Home', fieldKey: 'phoneHome' as const, prefKey: 'preferredHome' as const },
  { label: 'Work', fieldKey: 'phoneWork' as const, prefKey: 'preferredWork' as const },
  { label: 'Cell', fieldKey: 'phoneCell' as const, prefKey: 'preferredCell' as const },
  { label: 'Fax', fieldKey: 'phoneFax' as const, prefKey: 'preferredFax' as const },
];

const TAX_ID_TYPE_OPTIONS = [
  { value: '0', label: '0 - Unknown' },
  { value: '1', label: '1 - EIN' },
  { value: '2', label: '2 - SSN' },
];

interface LenderInfoFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

export const LenderInfoForm: React.FC<LenderInfoFormProps> = ({
  fields,
  values,
  onValueChange,
  showValidation = false,
  disabled = false,
  calculationResults = {},
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

  const [dobOpen, setDobOpen] = useState(false);
  const [investorDateOpen, setInvestorDateOpen] = useState(false);
  const [agreementDateOpen, setAgreementDateOpen] = useState(false);
  const [frozenDateOpen, setFrozenDateOpen] = useState(false);

  const wrapField = (key: keyof typeof FIELD_KEYS, children: React.ReactNode) => (
    <DirtyFieldWrapper fieldKey={FIELD_KEYS[key]}>{children}</DirtyFieldWrapper>
  );

  const handleSameAsPrimaryChange = (checked: boolean) => {
    handleChange('isPrimary', checked);
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

  const primaryStreetVal = getValue('primaryStreet');
  const primaryCityVal = getValue('primaryCity');
  const primaryStateVal = getValue('primaryState');
  const primaryZipVal = getValue('primaryZip');
  const isMailingSame = getBoolValue('mailingSameAsPrimary');

  useEffect(() => {
    if (isMailingSame) {
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
  }, [isMailingSame, primaryStreetVal, primaryCityVal, primaryStateVal, primaryZipVal]);

  const lenderType = getValue('type');
  const taxedAs = getValue('taxedAs');
  
  const issue1099Mapping = LENDER_TYPE_ISSUE_1099_MAP[lenderType] || 'Yes';
  const isAlwaysNo1099 = ALWAYS_NO_1099_TYPES.includes(lenderType);
  const isTaxedAsCorp = TAXED_AS_CORP_OPTIONS.includes(taxedAs);
  const shouldForceNo1099 = isAlwaysNo1099 || (issue1099Mapping === 'Situational' && isTaxedAsCorp);

  useEffect(() => {
    if (shouldForceNo1099 && getBoolValue('issue1099')) {
      handleChange('issue1099', false);
    } else if (!shouldForceNo1099 && issue1099Mapping === 'Yes' && !getBoolValue('issue1099')) {
      handleChange('issue1099', true);
    }
  }, [lenderType, taxedAs]);

  return (
    <div className="p-6">
      {/* 4-column layout per screenshot: Name | Primary+Mailing+Delivery | Phone+Send | Vesting+FORD */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

        {/* Column 1: Name */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground border-b pb-2">Name</h3>
          <div className="space-y-3">
            {wrapField('lenderId', <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Lender ID</Label>
              <Input
                value={getValue('lenderId')}
                onChange={(e) => handleChange('lenderId', e.target.value)}
                disabled={disabled}
                className="h-8"
              />
            </div>)}

            {wrapField('status', <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Status</Label>
              <Select
                value={getValue('status') || undefined}
                onValueChange={(value) => handleChange('status', value)}
                disabled={disabled}
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent className="bg-background z-[100]">
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="On Hold">On Hold</SelectItem>
                </SelectContent>
              </Select>
            </div>)}

            {wrapField('type', <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Lender Type</Label>
              <Select
                value={getValue('type')}
                onValueChange={(value) => handleChange('type', value)}
                disabled={disabled}
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {LENDER_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>)}

            {wrapField('fullName', <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">If Entity</Label>
              <Input
                value={getValue('fullName')}
                onChange={(e) => handleChange('fullName', e.target.value)}
                disabled={disabled}
                className="h-8"
              />
            </div>)}

            {wrapField('firstName', <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">First</Label>
              <Input
                value={getValue('firstName')}
                onChange={(e) => handleChange('firstName', e.target.value)}
                disabled={disabled}
                className="h-8"
              />
            </div>)}

            {wrapField('middleName', <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Middle</Label>
              <Input
                value={getValue('middleName')}
                onChange={(e) => handleChange('middleName', e.target.value)}
                disabled={disabled}
                className="h-8"
              />
            </div>)}

            {wrapField('lastName', <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Last</Label>
              <Input
                value={getValue('lastName')}
                onChange={(e) => handleChange('lastName', e.target.value)}
                disabled={disabled}
                className="h-8"
              />
            </div>)}

            {wrapField('capacity', <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Capacity</Label>
              <Select
                value={getValue('capacity') || undefined}
                onValueChange={(value) => handleChange('capacity', value)}
                disabled={disabled}
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Select capacity" />
                </SelectTrigger>
                <SelectContent className="bg-background z-[100]">
                  {[
                    'Trustee',
                    'Successor Trustee',
                    'Authorized Signer',
                    'President',
                    'CEO',
                    'Power of Attorney',
                    'Member',
                    'Manager',
                    'Partner',
                    'Other',
                  ].map((opt) => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>)}

            {wrapField('email', <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Email</Label>
              <EmailInput
                value={getValue('email')}
                onValueChange={(v) => handleChange('email', v)}
                disabled={disabled}
                className="h-8"
              />
            </div>)}

            {wrapField('dob', <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">DOB</Label>
              <div className="flex-1">
                <Popover open={dobOpen} onOpenChange={setDobOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "h-8 w-full justify-start text-left font-normal",
                        !getValue('dob') && "text-muted-foreground"
                      )}
                      disabled={disabled}
                    >
                      {safeFormatDate(getValue('dob'), 'MM/dd/yyyy') || <span>Date</span>}
                      <CalendarIcon className="ml-auto h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                    <EnhancedCalendar
                      mode="single"
                      selected={safeParseDateStr(getValue('dob'))}
                      onSelect={(date) => { handleChange('dob', date ? format(date, 'yyyy-MM-dd') : ''); setDobOpen(false); }}
                      onClear={() => { handleChange('dob', ''); setDobOpen(false); }}
                      onToday={() => { handleChange('dob', format(new Date(), 'yyyy-MM-dd')); setDobOpen(false); }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>)}
          </div>

          {/* Agreement on File + Investor Questionnaire on File */}
          <div className="space-y-3 mt-4 pt-3 border-t">
            {wrapField('servicingAgreementOnFile', <div className="flex items-center gap-2">
              <Checkbox
                checked={getBoolValue('servicingAgreementOnFile')}
                onCheckedChange={(checked) => handleChange('servicingAgreementOnFile', !!checked)}
                disabled={disabled}
              />
              <Label className="text-sm text-muted-foreground flex-1">Agreement on File</Label>
              <Popover open={agreementDateOpen} onOpenChange={setAgreementDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn("h-7 text-xs w-[120px]", !getValue('servicingAgreementOnFileDate') && "text-muted-foreground")}
                    disabled={disabled || !getBoolValue('servicingAgreementOnFile')}
                  >
                    {safeFormatDate(getValue('servicingAgreementOnFileDate'), 'MM/dd/yyyy') || 'Date'}
                    <CalendarIcon className="ml-auto h-3 w-3" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                  <EnhancedCalendar
                    mode="single"
                    selected={safeParseDateStr(getValue('servicingAgreementOnFileDate'))}
                    onSelect={(date) => { handleChange('servicingAgreementOnFileDate', date ? format(date, 'yyyy-MM-dd') : ''); setAgreementDateOpen(false); }}
                    onClear={() => { handleChange('servicingAgreementOnFileDate', ''); setAgreementDateOpen(false); }}
                    onToday={() => { handleChange('servicingAgreementOnFileDate', format(new Date(), 'yyyy-MM-dd')); setAgreementDateOpen(false); }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>)}

            {wrapField('investorQuestionnaireDue', <div className="flex items-center gap-2">
              <Checkbox
                checked={getBoolValue('investorQuestionnaireDue')}
                onCheckedChange={(checked) => {
                  handleChange('investorQuestionnaireDue', !!checked);
                  if (!checked) handleChange('investorQuestionnaireDueDate', '');
                }}
                disabled={disabled}
              />
              <Label className="text-sm text-muted-foreground flex-1">Investor Questionnaire on File</Label>
              <Popover open={investorDateOpen} onOpenChange={setInvestorDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn("h-7 text-xs w-[120px]", !getValue('investorQuestionnaireDueDate') && "text-muted-foreground")}
                    disabled={disabled || !getBoolValue('investorQuestionnaireDue')}
                  >
                    {safeFormatDate(getValue('investorQuestionnaireDueDate'), 'MM/dd/yyyy') || 'Date'}
                    <CalendarIcon className="ml-auto h-3 w-3" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                  <EnhancedCalendar
                    mode="single"
                    selected={safeParseDateStr(getValue('investorQuestionnaireDueDate'))}
                    onSelect={(date) => { handleChange('investorQuestionnaireDueDate', date ? format(date, 'yyyy-MM-dd') : ''); setInvestorDateOpen(false); }}
                    onClear={() => { handleChange('investorQuestionnaireDueDate', ''); setInvestorDateOpen(false); }}
                    onToday={() => { handleChange('investorQuestionnaireDueDate', format(new Date(), 'yyyy-MM-dd')); setInvestorDateOpen(false); }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>)}
          </div>
        </div>

        {/* Column 2: Primary Address + Mailing Address + Delivery */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground border-b pb-2">Primary Address</h3>
          <div className="space-y-3">
            {wrapField('primaryStreet', <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[60px] text-left shrink-0">Street</Label>
              <Input value={getValue('primaryStreet')} onChange={(e) => handleChange('primaryStreet', e.target.value)} disabled={disabled} className="h-8" />
            </div>)}
            {wrapField('primaryCity', <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[60px] text-left shrink-0">City</Label>
              <Input value={getValue('primaryCity')} onChange={(e) => handleChange('primaryCity', e.target.value)} disabled={disabled} className="h-8" />
            </div>)}
            {wrapField('primaryState', <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[60px] text-left shrink-0">State</Label>
              <Select value={getValue('primaryState') || ''} onValueChange={(val) => handleChange('primaryState', (val === '__select__' ? '' : val))} disabled={disabled}>
                <SelectTrigger className="h-8"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__select__">Select</SelectItem>
                  {US_STATES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>)}
            {wrapField('primaryZip', <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[60px] text-left shrink-0">ZIP</Label>
              <ZipInput value={getValue('primaryZip')} onValueChange={(v) => handleChange('primaryZip', v)} disabled={disabled} className="h-8" />
            </div>)}
          </div>

          {/* Mailing Address */}
          <div className="flex items-center justify-between border-b pb-2 mt-4">
            <h3 className="text-sm font-semibold text-foreground">Mailing Address</h3>
            {wrapField('mailingSameAsPrimary', <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Same as Primary</Label>
              <Checkbox
                checked={getBoolValue('mailingSameAsPrimary')}
                onCheckedChange={(checked) => {
                  handleChange('mailingSameAsPrimary', !!checked);
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
                }}
                disabled={disabled}
              />
            </div>)}
          </div>
          <div className="space-y-3">
            {wrapField('mailingStreet', <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[60px] text-left shrink-0">Street</Label>
              <Input value={getValue('mailingStreet')} onChange={(e) => handleChange('mailingStreet', e.target.value)} disabled={disabled || getBoolValue('mailingSameAsPrimary')} className="h-8" />
            </div>)}
            {wrapField('mailingCity', <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[60px] text-left shrink-0">City</Label>
              <Input value={getValue('mailingCity')} onChange={(e) => handleChange('mailingCity', e.target.value)} disabled={disabled || getBoolValue('mailingSameAsPrimary')} className="h-8" />
            </div>)}
            {wrapField('mailingState', <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[60px] text-left shrink-0">State</Label>
              <Select value={getValue('mailingState') || ''} onValueChange={(val) => handleChange('mailingState', (val === '__select__' ? '' : val))} disabled={disabled || getBoolValue('mailingSameAsPrimary')}>
                <SelectTrigger className="h-8"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__select__">Select</SelectItem>
                  {US_STATES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>)}
            {wrapField('mailingZip', <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[60px] text-left shrink-0">ZIP</Label>
              <ZipInput value={getValue('mailingZip')} onValueChange={(v) => handleChange('mailingZip', v)} disabled={disabled || getBoolValue('mailingSameAsPrimary')} className="h-8" />
            </div>)}
          </div>

          {/* Delivery Options */}
          <div className="mt-4">
            <h4 className="text-sm font-semibold text-foreground border-b pb-1 mb-2">Delivery</h4>
            {wrapField('deliveryOnline', <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={getBoolValue('deliveryOnline')}
                  onCheckedChange={(checked) => {
                    const v = !!checked;
                    handleChange('deliveryOnline', v);
                    const parts: string[] = [];
                    if (v) parts.push('Online');
                    if (getBoolValue('deliveryMail')) parts.push('Mail');
                    if (getBoolValue('deliverySms')) parts.push('SMS');
                    handleChange('deliveryOptions', parts.join(','));
                  }}
                  disabled={disabled}
                />
                <Label className="text-sm text-muted-foreground">Online</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={getBoolValue('deliveryMail')}
                  onCheckedChange={(checked) => {
                    const v = !!checked;
                    handleChange('deliveryMail', v);
                    const parts: string[] = [];
                    if (getBoolValue('deliveryOnline')) parts.push('Online');
                    if (v) parts.push('Mail');
                    if (getBoolValue('deliverySms')) parts.push('SMS');
                    handleChange('deliveryOptions', parts.join(','));
                  }}
                  disabled={disabled}
                />
                <Label className="text-sm text-muted-foreground">Mail</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={getBoolValue('deliverySms')}
                  onCheckedChange={(checked) => {
                    const v = !!checked;
                    handleChange('deliverySms', v);
                    const parts: string[] = [];
                    if (getBoolValue('deliveryOnline')) parts.push('Online');
                    if (getBoolValue('deliveryMail')) parts.push('Mail');
                    if (v) parts.push('SMS');
                    handleChange('deliveryOptions', parts.join(','));
                  }}
                  disabled={disabled}
                />
                <Label className="text-sm text-muted-foreground">SMS</Label>
              </div>
            </div>)}
          </div>
        </div>

        {/* Column 3: Phone + Preferred + Send */}
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b pb-2">
            <h3 className="text-sm font-semibold text-foreground">Phone</h3>
            <span className="text-sm font-semibold text-foreground">Preferred</span>
          </div>
          <RadioGroup
            value={(PHONE_FIELDS.find((p) => getBoolValue(p.prefKey))?.prefKey as string) || ''}
            onValueChange={(val) => {
              PHONE_FIELDS.forEach((p) => {
                handleChange(p.prefKey, p.prefKey === val);
              });
            }}
            className="space-y-3"
            disabled={disabled}
          >
            {PHONE_FIELDS.map((phone) => (
              <DirtyFieldWrapper key={phone.label} fieldKey={FIELD_KEYS[phone.fieldKey]}>
                <div className="flex items-center gap-3">
                  <Label className="text-sm text-muted-foreground min-w-[50px] text-left shrink-0">{phone.label}</Label>
                  <PhoneInput
                    value={getValue(phone.fieldKey)}
                    onValueChange={(val) => handleChange(phone.fieldKey, val)}
                    disabled={disabled}
                    className="h-8"
                  />
                  <RadioGroupItem
                    value={phone.prefKey}
                    id={`lender-pref-${phone.prefKey}`}
                    disabled={disabled}
                  />
                </div>
              </DirtyFieldWrapper>
            ))}
          </RadioGroup>

          {/* Send section */}
          <div className="mt-4">
            <h4 className="text-sm font-semibold text-foreground border-b pb-1 mb-2">Send</h4>
            <div className="space-y-2">
              {wrapField('sendPaymentNotification', <div className="flex items-center gap-2">
                <Checkbox
                  checked={getBoolValue('sendPaymentNotification')}
                  onCheckedChange={(checked) => handleChange('sendPaymentNotification', !!checked)}
                  disabled={disabled}
                />
                <Label className="text-sm text-muted-foreground">Payment Notification</Label>
              </div>)}
              {wrapField('sendLateNotice', <div className="flex items-center gap-2">
                <Checkbox
                  checked={getBoolValue('sendLateNotice')}
                  onCheckedChange={(checked) => handleChange('sendLateNotice', !!checked)}
                  disabled={disabled}
                />
                <Label className="text-sm text-muted-foreground">Late Notice</Label>
              </div>)}
              {wrapField('sendBorrowerStatement', <div className="flex items-center gap-2">
                <Checkbox
                  checked={getBoolValue('sendBorrowerStatement')}
                  onCheckedChange={(checked) => handleChange('sendBorrowerStatement', !!checked)}
                  disabled={disabled}
                />
                <Label className="text-sm text-muted-foreground">Borrower Statement</Label>
              </div>)}
              {wrapField('sendMaturityNotice', <div className="flex items-center gap-2">
                <Checkbox
                  checked={getBoolValue('sendMaturityNotice')}
                  onCheckedChange={(checked) => handleChange('sendMaturityNotice', !!checked)}
                  disabled={disabled}
                />
                <Label className="text-sm text-muted-foreground">Maturity Notice</Label>
              </div>)}
            </div>
          </div>
        </div>

        {/* Column 4: Vesting + FORD */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-foreground border-b pb-2">Vesting</h4>
          {wrapField('vesting', <Textarea
            value={getValue('vesting')}
            onChange={(e) => handleChange('vesting', e.target.value)}
            disabled={disabled}
            rows={3}
            className="resize-none w-full"
          />)}

          <h4 className="text-sm font-semibold text-foreground mt-4 mb-2">FORD</h4>
          <div className="space-y-2">
            {([['ford1', 'ford2'], ['ford3', 'ford4'], ['ford5', 'ford6'], ['ford7', 'ford8']] as const).map(([dropdownKey, inputKey], idx) => (
              <DirtyFieldWrapper key={idx} fieldKey={FIELD_KEYS[dropdownKey]}>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={getValue(dropdownKey)} onValueChange={(v) => handleChange(dropdownKey, v)} disabled={disabled}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{FORD_DROPDOWN_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input value={getValue(inputKey)} onChange={(e) => handleChange(inputKey, e.target.value)} disabled={disabled} className="h-8" />
                </div>
              </DirtyFieldWrapper>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LenderInfoForm;
