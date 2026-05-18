import React, { useState } from 'react'; // refreshed
import { formatCurrencyDisplay, unformatCurrencyDisplay, numericKeyDown, numericPaste } from '@/lib/numericInputFilter';
import { Input } from '@/components/ui/input';
import { EmailInput } from '@/components/ui/email-input';
import { ZipInput } from '@/components/ui/zip-input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Shield, CalendarIcon } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dateOnly';
import { cn } from '@/lib/utils';
import type { InsuranceData } from './InsuranceTableView';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';
import { US_STATES } from '@/lib/usStates';

interface InsuranceDetailFormProps {
  insurance: InsuranceData;
  onChange: (field: keyof InsuranceData, value: string | boolean) => void;
  disabled?: boolean;
  propertyOptions?: { id: string; label: string }[];
}

const INSURANCE_DESCRIPTION_OPTIONS = [
  'Earthquake Insurance',
  'Fire Insurance',
  'Flood Insurance',
  'Hurricane',
  'Force-Placed CPI',
  'Hazard',
  'Flood',
  'Wind'
];

const US_HOME_INSURANCE_COMPANIES = [
  'Allstate', 'American Family', 'American National', 'Amica Mutual',
  'ASI (Progressive Home)', 'Auto-Owners', 'Chubb', 'Cincinnati Financial',
  'Citizens Property Insurance', 'Country Financial', 'CSAA Insurance',
  'Donegal', 'Erie Insurance', 'Farmers', 'Florida Peninsula',
  'Foremost (Farmers)', 'GEICO (Homeowners)', 'Grange Insurance',
  'Hanover Insurance', 'Hartford', 'Heritage Insurance', 'Hippo',
  'Homeowners Choice', 'Homesite (American Family)', 'ICW Group',
  'Kemper', 'Lemonade', 'Liberty Mutual', 'Lighthouse Property',
  'Mercury Insurance', 'MetLife', 'Nationwide', 'NJM Insurance',
  'Pacific Specialty', 'Plymouth Rock', 'Progressive', 'Pure Insurance',
  'Safeco (Liberty Mutual)', 'Security First', 'Shelter Insurance',
  'Southern Oak', 'State Farm', 'Stillwater', 'Swyfft',
  'The General', 'Tower Hill', 'Travelers', 'TWFG Insurance',
  'United Property & Casualty', 'Universal Insurance', 'Universal Property',
  'USAA', 'Westfield', 'Weston Insurance', 'Zurich',
];

const TRACKING_STATUS_OPTIONS = [
  'Unable to Verify',
  'Current - Active',
  'Pending Cancellation',
  'Cancelled - Payment',
  'Cancelled - Other',
  'Force Placed Coverage',
];

// Map from InsuranceData keys to db field keys used in dirty tracking
const DIRTY_KEY_MAP: Record<string, string> = {
  property: 'insurance1.property',
  description: 'insurance1.description',
  
  companyName: 'insurance1.company_name',
  policyNumber: 'insurance1.policy_number',
  expiration: 'insurance1.expiration',
  
  annualPremium: 'insurance1.annual_premium',
  frequency: 'insurance1.frequency',
  active: 'insurance1.active',
  agentName: 'insurance1.agent_name',
  businessAddress: 'insurance1.business_address',
  businessAddressCity: 'insurance1.business_address_city',
  businessAddressState: 'insurance1.business_address_state',
  businessAddressZip: 'insurance1.business_address_zip',
  phoneNumber: 'insurance1.phone_number',
  faxNumber: 'insurance1.fax_number',
  email: 'insurance1.email',
  note: 'insurance1.note',
  paymentMailingStreet: 'insurance1.payment_mailing_street',
  paymentMailingCity: 'insurance1.payment_mailing_city',
  paymentMailingState: 'insurance1.payment_mailing_state',
  paymentMailingZip: 'insurance1.payment_mailing_zip',
  insuranceTracking: 'insurance1.insurance_tracking',
  lastVerified: 'insurance1.last_verified',
  trackingStatus: 'insurance1.tracking_status',
  impoundsActive: 'insurance1.impounds_active',
  impoundedStatus: 'insurance1.impounded_status',
  redFlagTrigger: 'insurance1.red_flag_trigger',
  attemptAgent: 'insurance1.attempt_agent',
  attemptBorrower: 'insurance1.attempt_borrower',
  lenderNotified: 'insurance1.lender_notified',
  lenderNotifiedDate: 'insurance1.lender_notified_date',
};

export const InsuranceDetailForm: React.FC<InsuranceDetailFormProps> = ({
  insurance,
  onChange,
  disabled = false,
  propertyOptions = [],
}) => {
  const [datePickerStates, setDatePickerStates] = useState<Record<string, boolean>>({});

  const safeParseDateStr = (val: string): Date | undefined => parseDateOnly(val);

  const renderField = (field: keyof InsuranceData, label: string, props: Record<string, any> = {}) => {
    if (props.type === 'date') {
      const val = String(insurance[field] || '');
      return (
        <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP[field] || `insurance1.${field}`}>
          <div className="flex items-center gap-3">
            <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">{label}</Label>
            <Popover open={datePickerStates[field] || false} onOpenChange={(open) => setDatePickerStates(prev => ({ ...prev, [field]: open }))}>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn('h-7 text-sm flex-1 justify-start text-left font-normal', !val && 'text-muted-foreground')} disabled={disabled}>
                  {val && safeParseDateStr(val) ? formatDateOnly(safeParseDateStr(val), 'MM/dd/yyyy') : 'MM/DD/YYYY'}
                  <CalendarIcon className="ml-auto h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                <EnhancedCalendar mode="single" selected={safeParseDateStr(val)} onSelect={(date) => { if (date) onChange(field, formatDateOnly(date)); setDatePickerStates(prev => ({ ...prev, [field]: false })); }} onClear={() => { onChange(field, ''); setDatePickerStates(prev => ({ ...prev, [field]: false })); }} onToday={() => { onChange(field, todayDateOnly()); setDatePickerStates(prev => ({ ...prev, [field]: false })); }} initialFocus />
              </PopoverContent>
            </Popover>
          </div>
        </DirtyFieldWrapper>
      );
    }
    return (
      <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP[field] || `insurance1.${field}`}>
        <div className="flex items-center gap-3">
          <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">{label}</Label>
          <Input value={String(insurance[field] || '')} onChange={(e) => onChange(field, e.target.value)} disabled={disabled} className="h-7 text-sm flex-1" {...props} />
        </div>
      </DirtyFieldWrapper>
    );
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-primary" />
        <span className="font-semibold text-lg text-foreground">General</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-3">
          <div className="border-b border-border pb-2">
            <span className="font-semibold text-sm text-primary">Insurance Policy Information</span>
          </div>

          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.property}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Property</Label>
              <Select value={insurance.property} onValueChange={(val) => onChange('property', val)} disabled={disabled}>
                <SelectTrigger className="h-7 text-sm"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent className="bg-background border border-border z-50">
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {propertyOptions.map(opt => (<SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.description}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Description</Label>
              <Select value={insurance.description || undefined} onValueChange={(val) => onChange('description', val)} disabled={disabled}>
                <SelectTrigger className="h-7 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="bg-background border border-border z-50">
                  {INSURANCE_DESCRIPTION_OPTIONS.map(opt => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.companyName}>
            {renderField('companyName', 'Ins. Company')}
          </DirtyFieldWrapper>
          {renderField('policyNumber', 'Policy Number')}
          {renderField('expiration', 'Expiration', { type: 'date' })}

          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.annualPremium}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Annual Premium</Label>
              <div className="relative flex-1">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
                <Input value={insurance.annualPremium} onChange={(e) => onChange('annualPremium', unformatCurrencyDisplay(e.target.value))} onBlur={() => { const raw = insurance.annualPremium; if (raw) onChange('annualPremium', formatCurrencyDisplay(raw)); }} onFocus={() => { const raw = insurance.annualPremium; if (raw) onChange('annualPremium', unformatCurrencyDisplay(raw)); }} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (val) => onChange('annualPremium', val))} disabled={disabled} className="h-7 text-sm text-right pl-5" inputMode="decimal" placeholder="0.00" />
              </div>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.frequency}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Frequency</Label>
              <Select value={insurance.frequency || undefined} onValueChange={(val) => onChange('frequency', val)} disabled={disabled}>
                <SelectTrigger className="h-7 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="bg-background border border-border z-50">
                  <SelectItem value="Monthly">Monthly</SelectItem>
                  <SelectItem value="Quarterly">Quarterly</SelectItem>
                  <SelectItem value="Semiannually">Semiannually</SelectItem>
                  <SelectItem value="Annually">Annually</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.impoundedStatus}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Impounded</Label>
              <Select value={insurance.impoundedStatus || undefined} onValueChange={(val) => onChange('impoundedStatus', val)} disabled={disabled}>
                <SelectTrigger className="h-7 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="bg-background border border-border z-50">
                  <SelectItem value="NA">NA</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="On Hold">On Hold</SelectItem>
                  <SelectItem value="Cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          {/* Payment Mailing Address */}
          <div className="border-b border-border pb-2 pt-2">
            <span className="font-semibold text-sm text-primary">Payment Mailing Address</span>
          </div>
          {renderField('paymentMailingStreet', 'Street')}
          {renderField('paymentMailingCity', 'City')}
          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.paymentMailingState}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">State</Label>
              <Select value={insurance.paymentMailingState || undefined} onValueChange={(val) => onChange('paymentMailingState', (val === '__select__' ? '' : val))} disabled={disabled}>
                <SelectTrigger className="h-7 text-sm"><SelectValue placeholder="Select state" /></SelectTrigger>
                <SelectContent className="bg-background border border-border z-50">
                  <SelectItem value="__select__">Select</SelectItem>
                  {US_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.paymentMailingZip}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">ZIP</Label>
              <ZipInput value={String(insurance.paymentMailingZip || '')} onValueChange={(v) => onChange('paymentMailingZip', v)} disabled={disabled} className="h-7 text-sm" />
            </div>
          </DirtyFieldWrapper>

        </div>

        {/* Right Column */}
        <div className="space-y-3">
          <div className="border-b border-border pb-2">
            <span className="font-semibold text-sm text-primary">Insurance Agent Information</span>
          </div>

          {renderField('agentName', "Agent's Name")}
          {renderField('businessAddress', 'Bus. Address')}
          {renderField('businessAddressCity', 'City')}
          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.businessAddressState}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">State</Label>
              <Select value={insurance.businessAddressState || undefined} onValueChange={(val) => onChange('businessAddressState', (val === '__select__' ? '' : val))} disabled={disabled}>
                <SelectTrigger className="h-7 text-sm"><SelectValue placeholder="Select state" /></SelectTrigger>
                <SelectContent className="bg-background border border-border z-50">
                  <SelectItem value="__select__">Select</SelectItem>
                  {US_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.businessAddressZip}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">ZIP</Label>
              <ZipInput value={String(insurance.businessAddressZip || '')} onValueChange={(v) => onChange('businessAddressZip', v)} disabled={disabled} className="h-7 text-sm" />
            </div>
          </DirtyFieldWrapper>
          {renderField('phoneNumber', 'Phone Number')}
          {renderField('faxNumber', 'Fax Number')}
          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.email}>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">E-mail</Label>
              <EmailInput value={String(insurance.email || '')} onValueChange={(v) => onChange('email', v)} disabled={disabled} className="h-7 text-sm" />
            </div>
          </DirtyFieldWrapper>

          {/* Insurance Tracking */}
          <div className="border-b border-border pb-2 pt-2">
            <span className="font-semibold text-sm text-primary">Insurance Tracking</span>
          </div>

          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.insuranceTracking}>
            <div className="flex items-center gap-2">
              <Checkbox id="detail-insurance-tracking" checked={insurance.insuranceTracking} onCheckedChange={(checked) => onChange('insuranceTracking', !!checked)} disabled={disabled} className="h-4 w-4" />
              <Label htmlFor="detail-insurance-tracking" className="text-sm text-foreground">Active</Label>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.redFlagTrigger}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Red Flag Trigger</Label>
              <Select value={insurance.redFlagTrigger || undefined} onValueChange={(val) => onChange('redFlagTrigger', val)} disabled={disabled}>
                <SelectTrigger className="h-7 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="bg-background border border-border z-50">
                  <SelectItem value="Not Paid">Not Paid</SelectItem>
                  <SelectItem value="Pending Cancellation">Pending Cancellation</SelectItem>
                  <SelectItem value="Cancelled">Cancelled</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          {insurance.insuranceTracking && (
            <>
              {renderField('lastVerified', 'Last Verified', { type: 'date' })}
              <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.trackingStatus}>
                <div className="flex items-center gap-3">
                  <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Status</Label>
                  <Select value={insurance.trackingStatus} onValueChange={(val) => onChange('trackingStatus', val)} disabled={disabled}>
                    <SelectTrigger className="h-7 text-sm"><SelectValue placeholder="Select status" /></SelectTrigger>
                    <SelectContent className="bg-background border border-border z-50">
                      {TRACKING_STATUS_OPTIONS.map(opt => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              </DirtyFieldWrapper>
            </>
          )}

          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.attemptAgent}>
            <div className="flex items-center gap-2">
              <Checkbox id="detail-attempt-agent" checked={insurance.attemptAgent} onCheckedChange={(checked) => onChange('attemptAgent', !!checked)} disabled={disabled} className="h-4 w-4" />
              <Label htmlFor="detail-attempt-agent" className="text-sm text-foreground">Attempt Agent</Label>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.attemptBorrower}>
            <div className="flex items-center gap-2">
              <Checkbox id="detail-attempt-borrower" checked={insurance.attemptBorrower} onCheckedChange={(checked) => onChange('attemptBorrower', !!checked)} disabled={disabled} className="h-4 w-4" />
              <Label htmlFor="detail-attempt-borrower" className="text-sm text-foreground">Attempted Borrower</Label>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.lenderNotified}>
            <div className="flex items-center gap-2">
              <Checkbox id="detail-lender-notified" checked={insurance.lenderNotified} onCheckedChange={(checked) => onChange('lenderNotified', !!checked)} disabled={disabled} className="h-4 w-4" />
              <Label htmlFor="detail-lender-notified" className="text-sm text-foreground">Notified Lender</Label>
            </div>
          </DirtyFieldWrapper>

          {insurance.lenderNotified && renderField('lenderNotifiedDate', 'Date', { type: 'date' })}
        </div>
      </div>

    </div>
  );
};

export default InsuranceDetailForm;
