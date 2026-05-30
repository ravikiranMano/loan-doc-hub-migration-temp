import React, { useMemo, useEffect, useState } from 'react';
import { format, parse, isValid } from 'date-fns';
import { PhoneInput } from '@/components/ui/phone-input';
import { Input } from '@/components/ui/input';
import { EmailInput } from '@/components/ui/email-input';
import { ZipInput } from '@/components/ui/zip-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { AlertCircle, CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { cn } from '@/lib/utils';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';
import { getLicenseNumberError, sanitizeLicenseNumber } from '@/lib/licenseNumberValidation';

const safeParseAgreementDate = (val: string): Date | undefined => {
  if (!val) return undefined;
  try { const d = parse(val, 'yyyy-MM-dd', new Date()); return isValid(d) ? d : undefined; } catch { return undefined; }
};
const safeFormatAgreementDate = (val: string): string => {
  const d = safeParseAgreementDate(val);
  return d ? format(d, 'MM/dd/yyyy') : '';
};

const FORD_DROPDOWN_OPTIONS = [
  'Spouse, Kids, Grandkids', 'Big Dream', 'Sports Teams', 'Hobbies / Collections',
  'Goals / Achievements', 'Favorite Restaurant, Food, Drinks', 'Pet(s)', 'Vacation Spot',
  'Job / Occupation', 'Music / Bands', 'College', 'Hometown / Childhood',
  'TV / Movies / Books', 'Anniversaries', 'Challenges / Frustrations',
  'Charity / Personal Causes', 'Upcoming Event - What / When', 'Celebration - What / When',
];

import { US_STATES } from '@/lib/usStates';

import { BROKER_INFO_KEYS } from '@/lib/fieldKeyMap';

// Use central field key map
const FIELD_KEYS = BROKER_INFO_KEYS;

interface BrokerInfoFormProps {
  disabled?: boolean;
  values?: Record<string, string>;
  onValueChange?: (fieldKey: string, value: string) => void;
}

export const BrokerInfoForm: React.FC<BrokerInfoFormProps> = ({ 
  disabled = false,
  values = {},
  onValueChange,
}) => {
  const getValue = (key: keyof typeof FIELD_KEYS): string => values[FIELD_KEYS[key]] || '';
  const getBoolValue = (key: keyof typeof FIELD_KEYS): boolean => values[FIELD_KEYS[key]] === 'true';

  const handleChange = (key: keyof typeof FIELD_KEYS, value: string | boolean) => {
    if (onValueChange) onValueChange(FIELD_KEYS[key], String(value));
  };

  const requiredFieldsStatus = useMemo(() => {
    const requiredFields: (keyof typeof FIELD_KEYS)[] = [];
    const filledCount = requiredFields.filter(field => getValue(field).trim() !== '').length;
    return { filledCount, totalRequired: requiredFields.length, missingCount: requiredFields.length - filledCount };
  }, [values]);

  // Reactive sync: when primary address changes while "Same as Primary" is checked
  const primaryStreetVal = getValue('street');
  const primaryCityVal = getValue('city');
  const primaryStateVal = getValue('state');
  const primaryZipVal = getValue('zip');
  const isMailingSame = getBoolValue('mailingSameAsPrimary');

  useEffect(() => {
    if (isMailingSame && onValueChange) {
      const mappings: [keyof typeof FIELD_KEYS, string][] = [
        ['mailingStreet', primaryStreetVal],
        ['mailingCity', primaryCityVal],
        ['mailingState', primaryStateVal],
        ['mailingZip', primaryZipVal],
      ];
      mappings.forEach(([dst, srcVal]) => {
        onValueChange(FIELD_KEYS[dst], srcVal);
      });
    }
  }, [isMailingSame, primaryStreetVal, primaryCityVal, primaryStateVal, primaryZipVal]);

  const renderInlineField = (key: keyof typeof FIELD_KEYS, label: string, required = false) => (
    <DirtyFieldWrapper fieldKey={FIELD_KEYS[key]}>
      <div className="flex items-center gap-2">
        <Label className="w-[100px] shrink-0 text-xs">{label}{required && <span className="text-destructive"> *</span>}</Label>
        <Input value={getValue(key)} onChange={(e) => handleChange(key, e.target.value)} disabled={disabled} className="h-7 text-xs flex-1" />
      </div>
    </DirtyFieldWrapper>
  );

  const handlePhonePref = (prefKey: keyof typeof FIELD_KEYS) => {
    const allPrefKeys: (keyof typeof FIELD_KEYS)[] = ['preferredHome', 'preferredWork', 'preferredCell', 'preferredFax'];
    allPrefKeys.forEach(k => {
      handleChange(k, k === prefKey);
    });
  };

  return (
    <div className="space-y-4">
      {requiredFieldsStatus.missingCount > 0 && (
        <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-primary/30 bg-primary/5">
          <div className="flex items-center gap-1.5 text-amber-500">
            <AlertCircle className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">{requiredFieldsStatus.missingCount} required field{requiredFieldsStatus.missingCount !== 1 ? 's' : ''} missing</span>
          </div>
          <span className="text-xs text-muted-foreground">{requiredFieldsStatus.filledCount}/{requiredFieldsStatus.totalRequired} filled</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-6 gap-y-0">
        {/* Column 1 - Name + Broker or Representative */}
        <div className="space-y-1.5">
          <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2">Name</h3>
          {renderInlineField('brokerId', 'Broker ID')}
          {renderInlineField('licenseeNameIfEntity', 'Licensee Name If Entity')}
          {renderInlineField('license', 'License Number')}

          <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2 mt-4">Broker or Representative</h3>
          {renderInlineField('firstName', 'First')}
          {renderInlineField('middleName', 'Middle')}
          {renderInlineField('lastName', 'Last')}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.capacity}>
            <div className="flex items-center gap-2">
              <Label className="w-[100px] shrink-0 text-xs">Capacity</Label>
              {(() => {
                const CAPACITY_OPTS = ['Broker', "Broker's Representative", 'Unlicensed'];
                const raw = (getValue('capacity') || '').trim();
                const safeValue = CAPACITY_OPTS.includes(raw) ? raw : undefined;
                return (
                  <Select value={safeValue} onValueChange={(v) => handleChange('capacity', v)} disabled={disabled}>
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {CAPACITY_OPTS.map((opt) => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              })()}
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.repLicense}>
            <div className="flex items-center gap-2">
              <Label className="w-[100px] shrink-0 text-xs">License Number</Label>
              <div className="flex-1">
                {(() => {
                  const raw = getValue('repLicense');
                  const error = getLicenseNumberError(raw);
                  return (
                    <>
                      <Input
                        value={raw}
                        maxLength={50}
                        onChange={(e) => {
                          const filtered = sanitizeLicenseNumber(e.target.value);
                          handleChange('repLicense', filtered);
                        }}
                        onBlur={(e) => {
                          const t = e.target.value.trim();
                          if (t !== e.target.value) handleChange('repLicense', t);
                        }}
                        disabled={disabled}
                        aria-invalid={!!error}
                        className={cn('h-7 text-xs w-full', error && 'border-destructive')}
                      />
                      {error && <p className="text-[10px] text-destructive mt-0.5">{error}</p>}
                    </>
                  );
                })()}
              </div>
            </div>
          </DirtyFieldWrapper>

          
          
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.email}>
            <div className="flex items-center gap-2">
              <Label className="w-[100px] shrink-0 text-xs">Email</Label>
              <EmailInput value={getValue('email')} onValueChange={(v) => handleChange('email', v)} disabled={disabled} className="h-7 text-xs" />
            </div>
          </DirtyFieldWrapper>

          <div className="pt-2 flex items-center gap-2">
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.agreementOnFile}>
              <div className="flex items-center space-x-2">
                <Checkbox id="broker-agreementOnFile" checked={getBoolValue('agreementOnFile')} onCheckedChange={(checked) => handleChange('agreementOnFile', !!checked)} disabled={disabled} className="h-3.5 w-3.5" />
                <Label htmlFor="broker-agreementOnFile" className="text-xs font-normal cursor-pointer">Agreement on File</Label>
              </div>
            </DirtyFieldWrapper>
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.agreementOnFileDate}>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={disabled}
                    className={cn('h-7 text-xs flex-1 justify-start font-normal', !getValue('agreementOnFileDate') && 'text-muted-foreground')}
                  >
                    <CalendarIcon className="mr-2 h-3 w-3" />
                    {safeFormatAgreementDate(getValue('agreementOnFileDate')) || 'MM/DD/YYYY'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                  <EnhancedCalendar
                    mode="single"
                    selected={safeParseAgreementDate(getValue('agreementOnFileDate'))}
                    onSelect={(d) => handleChange('agreementOnFileDate', d ? format(d, 'yyyy-MM-dd') : '')}
                    onClear={() => handleChange('agreementOnFileDate', '')}
                    onToday={() => handleChange('agreementOnFileDate', format(new Date(), 'yyyy-MM-dd'))}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </DirtyFieldWrapper>
          </div>
        </div>

        {/* Column 2 - Primary Address + Mailing Address + Delivery Options */}
        <div className="space-y-1.5">
          <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2">Primary Address</h3>
          {renderInlineField('street', 'Street')}
          {renderInlineField('city', 'City')}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.state}>
            <div className="flex items-center gap-2">
              <Label className="w-[100px] shrink-0 text-xs">State</Label>
              <Select value={getValue('state') || ''} onValueChange={(val) => handleChange('state', (val === '__select__' ? '' : val))} disabled={disabled}>
                <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__select__">Select</SelectItem>
                  {US_STATES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.zip}>
            <div className="flex items-center gap-2">
              <Label className="w-[100px] shrink-0 text-xs">ZIP</Label>
              <ZipInput value={getValue('zip')} onValueChange={(v) => handleChange('zip', v)} disabled={disabled} className="h-7 text-xs" />
            </div>
          </DirtyFieldWrapper>

          <div className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-border pb-1 mb-2 mt-4">
            <h3 className="font-semibold text-xs text-foreground">Mailing Address</h3>
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.mailingSameAsPrimary}>
              <div className="flex items-center space-x-2">
                <Label htmlFor="broker-mailingSameAsPrimary" className="text-xs font-normal cursor-pointer">Same as Primary</Label>
                <Checkbox id="broker-mailingSameAsPrimary" checked={getBoolValue('mailingSameAsPrimary')} onCheckedChange={(checked) => {
                  const isChecked = !!checked;
                  handleChange('mailingSameAsPrimary', isChecked);
                  if (isChecked) {
                    handleChange('mailingStreet', primaryStreetVal);
                    handleChange('mailingCity', primaryCityVal);
                    handleChange('mailingState', primaryStateVal);
                    handleChange('mailingZip', primaryZipVal);
                  } else {
                    handleChange('mailingStreet', '');
                    handleChange('mailingCity', '');
                    handleChange('mailingState', '');
                    handleChange('mailingZip', '');
                  }
                }} disabled={disabled} className="h-3.5 w-3.5" />
              </div>
            </DirtyFieldWrapper>
          </div>
          {/* mailing Street/City: disable when same as primary */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.mailingStreet}>
            <div className="flex items-center gap-2">
              <Label className="w-[100px] shrink-0 text-xs">Street</Label>
              <Input value={getValue('mailingStreet')} onChange={(e) => handleChange('mailingStreet', e.target.value)} disabled={disabled || isMailingSame} className="h-7 text-xs flex-1" />
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.mailingCity}>
            <div className="flex items-center gap-2">
              <Label className="w-[100px] shrink-0 text-xs">City</Label>
              <Input value={getValue('mailingCity')} onChange={(e) => handleChange('mailingCity', e.target.value)} disabled={disabled || isMailingSame} className="h-7 text-xs flex-1" />
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.mailingState}>
            <div className="flex items-center gap-2">
              <Label className="w-[100px] shrink-0 text-xs">State</Label>
              <Select value={getValue('mailingState') || ''} onValueChange={(val) => handleChange('mailingState', (val === '__select__' ? '' : val))} disabled={disabled || isMailingSame}>
                <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__select__">Select</SelectItem>
                  {US_STATES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.mailingZip}>
            <div className="flex items-center gap-2">
              <Label className="w-[100px] shrink-0 text-xs">ZIP</Label>
              <ZipInput value={getValue('mailingZip')} onValueChange={(v) => handleChange('mailingZip', v)} disabled={disabled || isMailingSame} className="h-7 text-xs" />
            </div>
          </DirtyFieldWrapper>

          <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2 mt-4">Delivery Options</h3>
          {([
            { key: 'deliveryOnline' as const, label: 'Online' },
            { key: 'deliveryMailingAddress' as const, label: 'Mailing Address' },
            { key: 'deliverySms' as const, label: 'SMS' },
          ]).map(({ key, label }) => (
            <DirtyFieldWrapper key={key} fieldKey={FIELD_KEYS[key]}>
              <div className="flex items-center justify-between">
                <Label htmlFor={`broker-${key}`} className="text-xs font-normal cursor-pointer">{label}</Label>
                <Checkbox id={`broker-${key}`} checked={getBoolValue(key)} onCheckedChange={(checked) => handleChange(key, !!checked)} disabled={disabled} className="h-3.5 w-3.5" />
              </div>
            </DirtyFieldWrapper>
          ))}
        </div>

        {/* Column 3 - Phone + FORD + Send */}
        <div className="space-y-1.5">
          <div className="grid grid-cols-[56px_1fr_72px] items-center gap-2 border-b border-border pb-1 mb-2">
            <h3 className="font-semibold text-xs text-foreground">Phone</h3>
            <span />
            <span className="font-semibold text-xs text-foreground text-center">Preferred</span>
          </div>
          <RadioGroup
            value={(['preferredHome', 'preferredWork', 'preferredCell', 'preferredFax'].find((key) => getBoolValue(key as keyof typeof FIELD_KEYS)) || '') as string}
            onValueChange={(value) => handlePhonePref(value as keyof typeof FIELD_KEYS)}
            className="space-y-1.5"
          >
            {[
              { phoneKey: 'phoneHome', prefKey: 'preferredHome', label: 'Home' },
              { phoneKey: 'phoneWork', prefKey: 'preferredWork', label: 'Work' },
              { phoneKey: 'phoneCell', prefKey: 'preferredCell', label: 'Cell' },
              { phoneKey: 'phoneFax', prefKey: 'preferredFax', label: 'Fax' },
            ].map(({ phoneKey, prefKey, label }) => (
              <DirtyFieldWrapper key={phoneKey} fieldKey={FIELD_KEYS[phoneKey as keyof typeof FIELD_KEYS]}>
                <div className="grid grid-cols-[56px_1fr_72px] items-center gap-2">
                  <Label className="w-14 shrink-0 text-xs">{label}</Label>
                  <PhoneInput
                    value={getValue(phoneKey as keyof typeof FIELD_KEYS)}
                    onValueChange={(val) => handleChange(phoneKey as keyof typeof FIELD_KEYS, val)}
                    disabled={disabled}
                    className="h-7 text-xs flex-1"
                  />
                  <div className="flex justify-center">
                    {label !== 'Fax' && (
                      <RadioGroupItem value={prefKey} disabled={disabled} aria-label={`Preferred ${label} phone`} />
                    )}
                  </div>
                </div>
              </DirtyFieldWrapper>
            ))}
          </RadioGroup>

          <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2 mt-4">FORD</h3>
          <div className="space-y-1.5">
            {([['ford1', 'ford2'], ['ford3', 'ford4'], ['ford5', 'ford6'], ['ford7', 'ford8']] as const).map(([dropdownKey, inputKey], idx) => (
              <DirtyFieldWrapper key={idx} fieldKey={FIELD_KEYS[dropdownKey]}>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={getValue(dropdownKey) || undefined} onValueChange={(v) => handleChange(dropdownKey, v)} disabled={disabled}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {FORD_DROPDOWN_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input value={getValue(inputKey)} onChange={(e) => handleChange(inputKey, e.target.value)} disabled={disabled} className="h-7 text-xs" />
                </div>
              </DirtyFieldWrapper>
            ))}
          </div>

          <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2 mt-4">Send</h3>
          {([
            { key: 'paymentNotification' as const, label: 'Payment Notification' },
            { key: 'lateNotice' as const, label: 'Late Notice' },
            { key: 'borrowerStatement' as const, label: 'Borrower Statement' },
            { key: 'maturityNotice' as const, label: 'Maturity Notice' },
          ]).map(({ key, label }) => (
            <DirtyFieldWrapper key={key} fieldKey={FIELD_KEYS[key]}>
              <div className="flex items-center justify-between">
                <Label htmlFor={`broker-send-${key}`} className="text-xs font-normal cursor-pointer">{label}</Label>
                <Checkbox id={`broker-send-${key}`} checked={getBoolValue(key)} onCheckedChange={(checked) => handleChange(key, !!checked)} disabled={disabled} className="h-3.5 w-3.5" />
              </div>
            </DirtyFieldWrapper>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BrokerInfoForm;
