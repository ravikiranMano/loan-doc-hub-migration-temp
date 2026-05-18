import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { EmailInput } from '@/components/ui/email-input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Home, CalendarIcon } from 'lucide-react';
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
import { format, parse, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import type { FieldDefinition } from '@/hooks/useDealFields';
import type { CalculationResult } from '@/lib/calculationEngine';
import { numericKeyDown, numericPaste, formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';

const US_INSURANCE_COMPANIES = [
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

interface PropertyInsuranceFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
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

const FREQUENCY_OPTIONS = ['Monthly', 'Quarterly', 'Semiannually', 'Annually'];

import { PROPERTY_INSURANCE_KEYS } from '@/lib/fieldKeyMap';

const FIELD_KEYS = PROPERTY_INSURANCE_KEYS;

export const PropertyInsuranceForm: React.FC<PropertyInsuranceFormProps> = ({
  fields,
  values,
  onValueChange,
  showValidation = false,
  disabled = false,
}) => {
  const getFieldValue = (key: string) => values[key] || '';
  const [expirationOpen, setExpirationOpen] = useState(false);

  const safeParseDateStr = (val: string): Date | undefined => {
    if (!val) return undefined;
    try {
      const d = parse(val, 'yyyy-MM-dd', new Date());
      return isValid(d) ? d : undefined;
    } catch { return undefined; }
  };

  const propertyAddress = values['property1.street'] || 'Unassigned';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Home className="h-5 w-5 text-primary" />
        <span className="font-semibold text-lg text-foreground">New Insurance</span>
      </div>

      {propertyAddress !== 'Unassigned' && (
        <div className="bg-muted/30 px-3 py-2 rounded text-sm">
          <span className="text-muted-foreground">Property: </span>
          <span className="text-foreground font-medium">{propertyAddress}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-8">
        {/* Left Column - Insurance Policy Information */}
        <div className="space-y-4">
          <div className="border-b border-border pb-2">
            <span className="font-semibold text-sm text-primary">Insurance Policy Information</span>
          </div>

          <div>
            <Label className="text-sm text-foreground">Property</Label>
            <Select
              value={getFieldValue('Property.Insurance.Property')}
              onValueChange={(val) => onValueChange('Property.Insurance.Property', val)}
              disabled={disabled}
            >
              <SelectTrigger className="h-8 text-sm mt-1">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent className="bg-background border border-border z-50">
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {propertyAddress !== 'Unassigned' && (
                  <SelectItem value={propertyAddress}>{propertyAddress}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.description}>
            <div>
              <Label className="text-sm text-foreground">Description</Label>
              <Select value={getFieldValue(FIELD_KEYS.description)} onValueChange={(val) => onValueChange(FIELD_KEYS.description, val)} disabled={disabled}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="bg-background border border-border z-50">
                  {INSURANCE_DESCRIPTION_OPTIONS.map(opt => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.companyName}>
            <div>
              <Label className="text-sm text-foreground">Insurance Company</Label>
              <Select value={getFieldValue(FIELD_KEYS.companyName) || undefined} onValueChange={(val) => onValueChange(FIELD_KEYS.companyName, val)} disabled={disabled}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="bg-background border border-border z-50">
                  {US_INSURANCE_COMPANIES.map(opt => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.policyNumber}>
            <div>
              <Label className="text-sm text-foreground">Policy Number</Label>
              <Input value={getFieldValue(FIELD_KEYS.policyNumber)} onChange={(e) => onValueChange(FIELD_KEYS.policyNumber, e.target.value)} disabled={disabled} className="h-8 text-sm mt-1" />
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.expiration}>
            <div>
              <Label className="text-sm text-foreground">Expiration</Label>
              <Popover open={expirationOpen} onOpenChange={setExpirationOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('h-8 text-sm mt-1 w-full justify-start text-left font-normal', !getFieldValue(FIELD_KEYS.expiration) && 'text-muted-foreground')} disabled={disabled}>
                    {getFieldValue(FIELD_KEYS.expiration) && safeParseDateStr(getFieldValue(FIELD_KEYS.expiration)) ? format(safeParseDateStr(getFieldValue(FIELD_KEYS.expiration))!, 'MM/dd/yyyy') : 'MM/DD/YYYY'}
                    <CalendarIcon className="ml-auto h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                  <EnhancedCalendar
                    mode="single"
                    selected={safeParseDateStr(getFieldValue(FIELD_KEYS.expiration))}
                    onSelect={(date) => { if (date) onValueChange(FIELD_KEYS.expiration, format(date, 'yyyy-MM-dd')); setExpirationOpen(false); }}
                    onClear={() => { onValueChange(FIELD_KEYS.expiration, ''); setExpirationOpen(false); }}
                    onToday={() => { onValueChange(FIELD_KEYS.expiration, format(new Date(), 'yyyy-MM-dd')); setExpirationOpen(false); }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.annualPremium}>
            <div>
              <Label className="text-sm text-foreground">Annual Premium</Label>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-sm text-muted-foreground">$</span>
                <Input
                  value={getFieldValue(FIELD_KEYS.annualPremium)}
                  onChange={(e) => onValueChange(FIELD_KEYS.annualPremium, e.target.value)}
                  onFocus={(e) => { const raw = unformatCurrencyDisplay(e.target.value); e.target.value = raw; onValueChange(FIELD_KEYS.annualPremium, raw); }}
                  onBlur={(e) => { const formatted = formatCurrencyDisplay(unformatCurrencyDisplay(e.target.value)); onValueChange(FIELD_KEYS.annualPremium, formatted); }}
                  onKeyDown={numericKeyDown}
                  onPaste={(e) => numericPaste(e, (v) => onValueChange(FIELD_KEYS.annualPremium, v))}
                  disabled={disabled}
                  className="h-8 text-sm text-right"
                  inputMode="decimal"
                  placeholder="0.00"
                />
              </div>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.frequency}>
            <div>
              <Label className="text-sm text-foreground">Frequency</Label>
              <Select value={getFieldValue(FIELD_KEYS.frequency) || undefined} onValueChange={(val) => onValueChange(FIELD_KEYS.frequency, val)} disabled={disabled}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="bg-background border border-border z-50">
                  {FREQUENCY_OPTIONS.map(opt => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          <div className="border-b border-border pb-2 pt-2">
            <span className="font-semibold text-sm text-primary">Impounds</span>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="insurance-active"
              checked={getFieldValue(FIELD_KEYS.active) === 'true'}
              onCheckedChange={(checked) => onValueChange(FIELD_KEYS.active, checked ? 'true' : 'false')}
              disabled={disabled}
              className="h-4 w-4"
            />
            <Label htmlFor="insurance-active" className="text-sm text-foreground">
              Active
            </Label>
          </div>

          <div className="border-b border-border pb-2 pt-2">
            <span className="font-semibold text-sm text-primary">Insurance Tracking</span>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="insurance-attempt-agent"
              checked={getFieldValue(FIELD_KEYS.attemptAgent) === 'true'}
              onCheckedChange={(checked) => onValueChange(FIELD_KEYS.attemptAgent, checked ? 'true' : 'false')}
              disabled={disabled}
              className="h-4 w-4"
            />
            <Label htmlFor="insurance-attempt-agent" className="text-sm text-foreground">Attempted Agent</Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="insurance-attempt-borrower"
              checked={getFieldValue(FIELD_KEYS.attemptBorrower) === 'true'}
              onCheckedChange={(checked) => onValueChange(FIELD_KEYS.attemptBorrower, checked ? 'true' : 'false')}
              disabled={disabled}
              className="h-4 w-4"
            />
            <Label htmlFor="insurance-attempt-borrower" className="text-sm text-foreground">Attempted Borrower</Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="insurance-lender-notified"
              checked={getFieldValue(FIELD_KEYS.lenderNotified) === 'true'}
              onCheckedChange={(checked) => onValueChange(FIELD_KEYS.lenderNotified, checked ? 'true' : 'false')}
              disabled={disabled}
              className="h-4 w-4"
            />
            <Label htmlFor="insurance-lender-notified" className="text-sm text-foreground">Notified Lender</Label>
          </div>
        </div>

        {/* Right Column - Insurance Agent Information */}
        <div className="space-y-4">
          <div className="border-b border-border pb-2">
            <span className="font-semibold text-sm text-primary">Insurance Agent Information</span>
          </div>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.agentName}>
            <div>
              <Label className="text-sm text-foreground">Agent's Name</Label>
              <Input value={getFieldValue(FIELD_KEYS.agentName)} onChange={(e) => onValueChange(FIELD_KEYS.agentName, e.target.value)} disabled={disabled} className="h-8 text-sm mt-1" />
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.businessAddress}>
            <div>
              <Label className="text-sm text-foreground">Bus. Address</Label>
              <Input value={getFieldValue(FIELD_KEYS.businessAddress)} onChange={(e) => onValueChange(FIELD_KEYS.businessAddress, e.target.value)} disabled={disabled} className="h-8 text-sm mt-1" />
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.phoneNumber}>
            <div>
              <Label className="text-sm text-foreground">Phone Number</Label>
              <Input value={getFieldValue(FIELD_KEYS.phoneNumber)} onChange={(e) => onValueChange(FIELD_KEYS.phoneNumber, e.target.value)} disabled={disabled} className="h-8 text-sm mt-1" />
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.faxNumber}>
            <div>
              <Label className="text-sm text-foreground">Fax Number</Label>
              <Input value={getFieldValue(FIELD_KEYS.faxNumber)} onChange={(e) => onValueChange(FIELD_KEYS.faxNumber, e.target.value)} disabled={disabled} className="h-8 text-sm mt-1" />
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.email}>
            <div>
              <Label className="text-sm text-foreground">E-mail</Label>
              <EmailInput value={getFieldValue(FIELD_KEYS.email)} onValueChange={(v) => onValueChange(FIELD_KEYS.email, v)} disabled={disabled} className="h-8 text-sm mt-1" />
            </div>
          </DirtyFieldWrapper>
        </div>
      </div>
    </div>
  );
};

export default PropertyInsuranceForm;
