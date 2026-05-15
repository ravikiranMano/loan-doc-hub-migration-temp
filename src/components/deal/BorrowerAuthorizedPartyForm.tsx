import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { EmailInput } from '@/components/ui/email-input';
import { ZipInput } from '@/components/ui/zip-input';
import { PhoneInput } from '@/components/ui/phone-input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { CalendarIcon } from 'lucide-react';
import { formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dateOnly';
import { cn } from '@/lib/utils';
import { STATE_OPTIONS } from '@/lib/usStates';
import type { FieldDefinition } from '@/hooks/useDealFields';
import type { CalculationResult } from '@/lib/calculationEngine';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';
import { BORROWER_AUTHORIZED_PARTY_KEYS } from '@/lib/fieldKeyMap';

const FIELD_KEYS = BORROWER_AUTHORIZED_PARTY_KEYS;

const CAPACITY_OPTIONS = [
  'Authorized Party',
  'Corporate Officer', 'Attorney', 'Power of Attorney',
  'Accountant / CPA', 'Family', 'Bankruptcy Trustee', 'Other',
];

const sanitizeName = (v: string) => v.replace(/[^a-zA-Z\s'\-]/g, '').slice(0, 100);

interface BorrowerAuthorizedPartyFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

const InlineField = ({
  label, children, labelWidth = 'min-w-[110px]', fieldKey,
}: { label: string; children: React.ReactNode; labelWidth?: string; fieldKey?: string }) => {
  const content = (
    <div className="flex items-center gap-3">
      <Label className={`text-sm text-muted-foreground ${labelWidth} text-left shrink-0`}>{label}</Label>
      <div className="flex-1">{children}</div>
    </div>
  );
  if (fieldKey) return <DirtyFieldWrapper fieldKey={fieldKey}>{content}</DirtyFieldWrapper>;
  return content;
};

export const BorrowerAuthorizedPartyForm: React.FC<BorrowerAuthorizedPartyFormProps> = ({
  values,
  onValueChange,
  disabled = false,
}) => {
  const [dateOpen, setDateOpen] = useState(false);

  const getValue = (key: keyof typeof FIELD_KEYS): string => values[FIELD_KEYS[key]] || '';
  const getBoolValue = (key: keyof typeof FIELD_KEYS): boolean => values[FIELD_KEYS[key]] === 'true';
  const handleChange = (key: keyof typeof FIELD_KEYS, value: string | boolean) => {
    onValueChange(FIELD_KEYS[key], String(value));
  };
  const handleNameChange = (key: keyof typeof FIELD_KEYS, raw: string) => {
    handleChange(key, sanitizeName(raw));
  };

  const phoneRows: { key: keyof typeof FIELD_KEYS; prefKey: keyof typeof FIELD_KEYS; label: string; prefId: string; hasPreferred?: boolean }[] = [
    { key: 'phoneHome', prefKey: 'preferredHome', label: 'Home', prefId: 'ap-prefHome' },
    { key: 'phoneWork', prefKey: 'preferredWork', label: 'Work', prefId: 'ap-prefWork' },
    { key: 'phoneCell', prefKey: 'preferredCell', label: 'Cell', prefId: 'ap-prefCell' },
    { key: 'phoneFax', prefKey: 'preferredFax', label: 'Fax', prefId: 'ap-prefFax', hasPreferred: false },
  ];

  return (
    <div className="p-4 space-y-6">
      {/* Band 1: Name | Address | Phone | Preferred */}
      <div className="grid gap-x-4 gap-y-0" style={{ gridTemplateColumns: '1.3fr 1.1fr 1.3fr auto' }}>
        {/* Column 1 - Name */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm text-foreground pb-1">Name</h4>

          <InlineField label="First" fieldKey={FIELD_KEYS.firstName}>
            <Input value={getValue('firstName')} onChange={(e) => handleNameChange('firstName', e.target.value)} disabled={disabled} className="h-7 text-sm" maxLength={100} />
          </InlineField>

          <InlineField label="Middle" fieldKey={FIELD_KEYS.middleName}>
            <Input value={getValue('middleName')} onChange={(e) => handleNameChange('middleName', e.target.value)} disabled={disabled} className="h-7 text-sm" maxLength={100} />
          </InlineField>

          <InlineField label="Last" fieldKey={FIELD_KEYS.lastName}>
            <Input value={getValue('lastName')} onChange={(e) => handleNameChange('lastName', e.target.value)} disabled={disabled} className="h-7 text-sm" maxLength={100} />
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

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.dateAuthorized}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[110px] text-left shrink-0">Date Authorized</Label>
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    className={cn('h-7 text-sm flex-1 justify-start font-normal', !getValue('dateAuthorized') && 'text-muted-foreground')}
                  >
                    <CalendarIcon className="h-3.5 w-3.5 mr-2 opacity-60" />
                    {getValue('dateAuthorized')
                      ? formatDateOnly(parseDateOnly(getValue('dateAuthorized')), 'MM/dd/yyyy')
                      : 'Date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-background z-50" align="start">
                  <EnhancedCalendar
                    mode="single"
                    selected={parseDateOnly(getValue('dateAuthorized'))}
                    onSelect={(date) => { handleChange('dateAuthorized', date ? formatDateOnly(date) : ''); setDateOpen(false); }}
                    onClear={() => { handleChange('dateAuthorized', ''); setDateOpen(false); }}
                    onToday={() => { handleChange('dateAuthorized', todayDateOnly()); setDateOpen(false); }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </DirtyFieldWrapper>
        </div>

        {/* Column 2 - Address */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm text-foreground pb-1">Address</h4>

          <InlineField label="Street" labelWidth="min-w-[60px]" fieldKey={FIELD_KEYS.primaryStreet}>
            <Input value={getValue('primaryStreet')} onChange={(e) => handleChange('primaryStreet', e.target.value)} disabled={disabled} className="h-7 text-sm" />
          </InlineField>

          <InlineField label="City" labelWidth="min-w-[60px]" fieldKey={FIELD_KEYS.primaryCity}>
            <Input value={getValue('primaryCity')} onChange={(e) => handleChange('primaryCity', e.target.value)} disabled={disabled} className="h-7 text-sm" />
          </InlineField>

          <InlineField label="State" labelWidth="min-w-[60px]" fieldKey={FIELD_KEYS.primaryState}>
            <Select value={getValue('primaryState') || '__select__'} onValueChange={(value) => handleChange('primaryState', value === '__select__' ? '' : value)} disabled={disabled}>
              <SelectTrigger className="h-7 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent><SelectItem value="__select__">Select</SelectItem>{STATE_OPTIONS.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}</SelectContent>
            </Select>
          </InlineField>

          <InlineField label="ZIP" labelWidth="min-w-[60px]" fieldKey={FIELD_KEYS.primaryZip}>
            <ZipInput value={getValue('primaryZip')} onValueChange={(v) => handleChange('primaryZip', v)} disabled={disabled} className="h-7 text-sm" />
          </InlineField>
        </div>

        {/* Column 3 - Phone */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm text-foreground pb-1">Phone</h4>
          {phoneRows.map(({ key, label }) => (
            <DirtyFieldWrapper key={key} fieldKey={FIELD_KEYS[key]}>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground min-w-[40px] text-left shrink-0">{label}</Label>
                <PhoneInput value={getValue(key)} onValueChange={(v) => handleChange(key, v)} disabled={disabled} className="h-7 text-sm flex-1" />
              </div>
            </DirtyFieldWrapper>
          ))}
        </div>

        {/* Column 4 - Preferred */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm text-foreground pb-1">Preferred</h4>
          {phoneRows.map(({ prefKey, prefId, hasPreferred }) => (
            hasPreferred === false ? (
              <div key={prefId} className="flex items-center justify-center h-7" />
            ) : (
              <DirtyFieldWrapper key={prefId} fieldKey={FIELD_KEYS[prefKey]}>
                <div className="flex items-center justify-center h-7">
                  <input
                    type="radio"
                    id={prefId}
                    name="ap-preferred-phone"
                    checked={getBoolValue(prefKey)}
                    onChange={() => {
                      phoneRows.forEach(({ prefKey: pk, hasPreferred: hp }) => {
                        if (hp === false) return;
                        handleChange(pk, pk === prefKey);
                      });
                    }}
                    disabled={disabled}
                    className="h-4 w-4 cursor-pointer accent-primary"
                  />
                </div>
              </DirtyFieldWrapper>
            )
          ))}
        </div>
      </div>

      {/* Band 2: Delivery Options | Send | Details | FORD */}
      <div className="grid gap-x-6" style={{ gridTemplateColumns: '0.8fr 1.1fr 1.2fr 1.2fr' }}>
        {/* Delivery Options */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm text-foreground pb-1">Delivery Options:</h4>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.deliveryOnline}>
            <div className="flex items-center gap-2">
              <Checkbox id="ap-deliveryOnline" checked={getBoolValue('deliveryOnline')} onCheckedChange={(checked) => handleChange('deliveryOnline', !!checked)} disabled={disabled} />
              <Label htmlFor="ap-deliveryOnline" className="text-sm font-normal">Online</Label>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.deliveryMail}>
            <div className="flex items-center gap-2">
              <Checkbox id="ap-deliveryMail" checked={getBoolValue('deliveryMail')} onCheckedChange={(checked) => handleChange('deliveryMail', !!checked)} disabled={disabled} />
              <Label htmlFor="ap-deliveryMail" className="text-sm font-normal">Mail</Label>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.deliverySms}>
            <div className="flex items-center gap-2">
              <Checkbox id="ap-deliverySms" checked={getBoolValue('deliverySms')} onCheckedChange={(checked) => handleChange('deliverySms', !!checked)} disabled={disabled} />
              <Label htmlFor="ap-deliverySms" className="text-sm font-normal">SMS</Label>
            </div>
          </DirtyFieldWrapper>
        </div>

        {/* Send */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm text-foreground pb-1">Send</h4>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.sendPaymentConfirmation}>
            <div className="flex items-center gap-2">
              <Checkbox id="ap-sendPaymentConfirmation" checked={getBoolValue('sendPaymentConfirmation')} onCheckedChange={(checked) => handleChange('sendPaymentConfirmation', !!checked)} disabled={disabled} />
              <Label htmlFor="ap-sendPaymentConfirmation" className="text-sm font-normal">Payment Confirmation</Label>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.sendCouponBook}>
            <div className="flex items-center gap-2">
              <Checkbox id="ap-sendCouponBook" checked={getBoolValue('sendCouponBook')} onCheckedChange={(checked) => handleChange('sendCouponBook', !!checked)} disabled={disabled} />
              <Label htmlFor="ap-sendCouponBook" className="text-sm font-normal">Coupon Book</Label>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.sendPaymentStatement}>
            <div className="flex items-center gap-2">
              <Checkbox id="ap-sendPaymentStatement" checked={getBoolValue('sendPaymentStatement')} onCheckedChange={(checked) => handleChange('sendPaymentStatement', !!checked)} disabled={disabled} />
              <Label htmlFor="ap-sendPaymentStatement" className="text-sm font-normal">Payment Statement</Label>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.sendLateNotice}>
            <div className="flex items-center gap-2">
              <Checkbox id="ap-sendLateNotice" checked={getBoolValue('sendLateNotice')} onCheckedChange={(checked) => handleChange('sendLateNotice', !!checked)} disabled={disabled} />
              <Label htmlFor="ap-sendLateNotice" className="text-sm font-normal">Late Notice</Label>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.sendMaturityNotice}>
            <div className="flex items-center gap-2">
              <Checkbox id="ap-sendMaturityNotice" checked={getBoolValue('sendMaturityNotice')} onCheckedChange={(checked) => handleChange('sendMaturityNotice', !!checked)} disabled={disabled} />
              <Label htmlFor="ap-sendMaturityNotice" className="text-sm font-normal">Maturity Notice</Label>
            </div>
          </DirtyFieldWrapper>
        </div>

        {/* Details */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm text-foreground pb-1">Details</h4>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.details}>
            <Textarea
              value={getValue('details')}
              onChange={(e) => handleChange('details', e.target.value)}
              disabled={disabled}
              className="min-h-[110px] text-sm"
            />
          </DirtyFieldWrapper>
        </div>

        {/* FORD */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm text-foreground pb-1">FORD</h4>
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4, 5, 6].map((n) => {
              const fieldKey = `borrower.authorized_party.ford_${n}`;
              return (
                <DirtyFieldWrapper key={fieldKey} fieldKey={fieldKey}>
                  <Input
                    value={values[fieldKey] || ''}
                    onChange={(e) => onValueChange(fieldKey, e.target.value)}
                    disabled={disabled}
                    maxLength={200}
                    className="h-7 text-sm"
                  />
                </DirtyFieldWrapper>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BorrowerAuthorizedPartyForm;
