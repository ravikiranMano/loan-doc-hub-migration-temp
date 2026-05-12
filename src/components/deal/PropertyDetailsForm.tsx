import React, { useEffect } from 'react';
import { formatCurrencyDisplay, unformatCurrencyDisplay, numericKeyDown, numericPaste } from '@/lib/numericInputFilter';
import { roundPctForStorage, roundDollarForStorage } from '@/lib/precisionFormat';
import { US_STATES } from '@/lib/usStates';
import { PhoneInput } from '@/components/ui/phone-input';
import { Input } from '@/components/ui/input';
import { EmailInput } from '@/components/ui/email-input';
import { ZipInput } from '@/components/ui/zip-input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { CalendarIcon, ChevronsUpDown, Check } from 'lucide-react';
import { format, parse } from 'date-fns';
import { cn } from '@/lib/utils';
import type { FieldDefinition } from '@/hooks/useDealFields';
import type { CalculationResult } from '@/lib/calculationEngine';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';
import { toast } from 'sonner';

interface PropertyDetailsFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
  borrowerOptions?: string[];
  borrowerAddress?: { street: string; city: string; state: string; zipCode: string };
}

const PROPERTY_TYPE_OPTIONS = [
  'SFR 1-4', 'Multi-family', 'Condo / Townhouse', 'Mobile Home', 'Commercial',
  'Commercial Income', 'Mixed-use', 'Land SFR Residential', 'Land Residential',
  'Land Commercial', 'Land Income Producing', 'Farm', 'Restaurant / Bar', 'Group Housing'
];

const OCCUPANCY_OPTIONS = ['Owner Occupied', 'Vacant', 'NA'];
const PERFORMED_BY_OPTIONS = ['Broker', 'Third Party'];
const CONSTRUCTION_TYPES = ['Wood Frame', 'Wood Frame / Stucco', 'Modular', 'Steel Frame', 'Brick / Block', 'NA'];
const ZONING_OPTIONS = ['R1 SFR', 'R2 SFR', 'R3 Multi-family', 'R-M Multi-family', 'PUD', 'Residential Lot / Parcel', 'Mixed Use', 'C Commercial', 'Agriculture', 'NA'];
const VALUATION_TYPE_OPTIONS = ['Appraisal', 'Broker Determined Value (BPO)'];
const INFO_PROVIDED_BY_OPTIONS = ['Broker', 'Borrower', 'Public Record', 'Other'];

import { PROPERTY_DETAILS_KEYS } from '@/lib/fieldKeyMap';

const FIELD_KEYS = PROPERTY_DETAILS_KEYS;

export const PropertyDetailsForm: React.FC<PropertyDetailsFormProps> = ({
  fields,
  values,
  onValueChange,
  showValidation = false,
  disabled = false,
  borrowerOptions: borrowerOptionsProp,
  borrowerAddress: borrowerAddressProp,
}) => {
  const [datePickerStates, setDatePickerStates] = React.useState<Record<string, boolean>>({});
  const getFieldValue = (key: string) => values[key] || '';
  const sanitizeNumericValue = (value: string): string => value.replace(/[^0-9.-]/g, '');
  const handleCurrencyChange = (fieldKey: string, value: string) => onValueChange(fieldKey, sanitizeNumericValue(value));
  const handlePercentageChange = (fieldKey: string, value: string) => onValueChange(fieldKey, sanitizeNumericValue(value).replace(/-/g, ''));

  // Helper: sum all lien new_remaining_balance values
  const existingLiensTotal = React.useMemo(() => {
    let total = 0;
    const lienPrefixes = new Set<string>();
    Object.keys(values).forEach(key => {
      const m = key.match(/^(lien\d+)\./);
      if (m) lienPrefixes.add(m[1]);
    });
    lienPrefixes.forEach(prefix => {
      const raw = values[`${prefix}.new_remaining_balance`] || '';
      const num = parseFloat(raw.replace(/[,$]/g, ''));
      if (!isNaN(num)) total += num;
    });
    return total;
  }, [values]);

  // Auto-calculate equities & LTVs — auto-sync on any input change.
  // Formulas (per spec):
  //   Protective Equity = Estimate of Value − Current Balance
  //   Pledged Equity    = Estimate of Value − Loan Amount
  //   CLTV              = Total All Liens / Estimate of Value × 100
  //   Current LTV       = Current Balance / Estimate of Value × 100
  //   Origination LTV   = Loan Amount / Estimate of Value × 100
  const loanAmountRaw = values['loan_terms.loan_amount'] || '';
  const estValueRaw = values[FIELD_KEYS.appraisedValue] || '';
  const currentBalanceRaw = values[FIELD_KEYS.currentBalance] || '';
  useEffect(() => {
    const loanAmount = parseFloat(loanAmountRaw.replace(/[,$]/g, ''));
    const estValue = parseFloat(estValueRaw.replace(/[,$]/g, ''));
    const currentBalance = parseFloat(currentBalanceRaw.replace(/[,$]/g, ''));
    const totalAllLiens = existingLiensTotal;

    const writeIfChanged = (key: string, next: string) => {
      const cur = (values[key] || '').replace(/[,$]/g, '').trim();
      if (cur !== next) onValueChange(key, next);
    };

    // Protective Equity = Estimate of Value − Current Balance
    if (!isNaN(estValue) && !isNaN(currentBalance)) {
      writeIfChanged(FIELD_KEYS.protectiveEquity, roundDollarForStorage(estValue - currentBalance));
    }

    // Pledged Equity = Estimate of Value − Loan Amount
    if (!isNaN(estValue) && !isNaN(loanAmount)) {
      writeIfChanged(FIELD_KEYS.pledgedEquity, roundDollarForStorage(estValue - loanAmount));
    }

    // CLTV = Total All Liens / Estimate of Value × 100
    if (!isNaN(estValue) && estValue > 0) {
      writeIfChanged(FIELD_KEYS.cltv, roundPctForStorage((totalAllLiens / estValue) * 100));
    }

    // Current LTV = Current Balance / Estimate of Value × 100
    if (!isNaN(estValue) && estValue > 0 && !isNaN(currentBalance)) {
      writeIfChanged(FIELD_KEYS.ltv, roundPctForStorage((currentBalance / estValue) * 100));
    }

    // Origination LTV = Loan Amount / Estimate of Value × 100
    if (!isNaN(estValue) && estValue > 0 && !isNaN(loanAmount)) {
      writeIfChanged(FIELD_KEYS.originationLtv, roundPctForStorage((loanAmount / estValue) * 100));
    }
  }, [loanAmountRaw, estValueRaw, currentBalanceRaw, existingLiensTotal]);

  const isCopyBorrower = getFieldValue(FIELD_KEYS.copyBorrowerAddress) === 'true';
  const informationProvidedBy = getFieldValue(FIELD_KEYS.informationProvidedBy);

  // Resolve the Primary Borrower's prefix from multi-borrower storage.
  // Borrowers are stored under borrower1, borrower2, ... each with `${prefix}.is_primary`.
  // Falls back to a base 'borrower' record if no numbered borrowers exist.
  const primaryBorrowerPrefix = React.useMemo(() => {
    const prefixes = new Set<string>();
    Object.keys(values).forEach(key => {
      const m = key.match(/^(borrower\d+)\./);
      if (m) prefixes.add(m[1]);
    });
    if (prefixes.size === 0) {
      const hasBase = Object.keys(values).some(k => k.startsWith('borrower.') && !k.match(/^borrower\d+\./));
      if (hasBase) return 'borrower';
      return null;
    }
    // Find the one explicitly marked primary
    for (const p of prefixes) {
      if (values[`${p}.is_primary`] === 'true') return p;
    }
    return null;
  }, [values]);

  // Build a deduplicated, ordered list of borrower full names for the
  // searchable Property Owner picker. Sourced strictly from loan participants
  // (deal_participants) via the borrowerOptionsProp; no fallback to contacts.
  const borrowerOptions = React.useMemo(() => {
    return borrowerOptionsProp || [];
  }, [borrowerOptionsProp]);
  const [ownerPickerOpen, setOwnerPickerOpen] = React.useState(false);

  const borrowerStreet = borrowerAddressProp?.street ?? (primaryBorrowerPrefix ? (values[`${primaryBorrowerPrefix}.address.street`] || '') : '');
  const borrowerCity = borrowerAddressProp?.city ?? (primaryBorrowerPrefix ? (values[`${primaryBorrowerPrefix}.address.city`] || '') : '');
  const borrowerState = borrowerAddressProp?.state ?? (primaryBorrowerPrefix
    ? (values[`${primaryBorrowerPrefix}.address.state`] || values[`${primaryBorrowerPrefix}.state`] || '')
    : '');
  const borrowerZip = borrowerAddressProp?.zipCode ?? (primaryBorrowerPrefix ? (values[`${primaryBorrowerPrefix}.address.zip`] || '') : '');


  // Track previous checkbox state: copy on check, clear on uncheck.
  const prevCopyRef = React.useRef<boolean>(isCopyBorrower);
  useEffect(() => {
    const justChecked = isCopyBorrower && !prevCopyRef.current;
    const justUnchecked = !isCopyBorrower && prevCopyRef.current;
    prevCopyRef.current = isCopyBorrower;

    if (justUnchecked) {
      [FIELD_KEYS.street, FIELD_KEYS.city, FIELD_KEYS.state, FIELD_KEYS.zip].forEach((dst) => {
        if (getFieldValue(dst) !== '') onValueChange(dst, '');
      });
      return;
    }

    if (!isCopyBorrower) return;

    const hasBorrowerSource = !!primaryBorrowerPrefix || !!(borrowerAddressProp && (borrowerAddressProp.street || borrowerAddressProp.city || borrowerAddressProp.state || borrowerAddressProp.zipCode));
    if (!hasBorrowerSource) {
      if (justChecked) {
        toast.error('Primary Borrower not found in Participants');
      }
      return;
    }

    const mappings: [string, string][] = [
      [FIELD_KEYS.street, borrowerStreet],
      [FIELD_KEYS.city, borrowerCity],
      [FIELD_KEYS.state, borrowerState],
      [FIELD_KEYS.zip, borrowerZip],
    ];
    mappings.forEach(([dst, srcVal]) => {
      if (getFieldValue(dst) !== srcVal) onValueChange(dst, srcVal);
    });
  }, [isCopyBorrower, primaryBorrowerPrefix, borrowerStreet, borrowerCity, borrowerState, borrowerZip]);

  const parseDate = (val: string): Date | undefined => {
    if (!val) return undefined;
    try { return parse(val, 'yyyy-MM-dd', new Date()); } catch { return undefined; }
  };

  const renderInlineField = (fieldKey: string, label: string, type: 'text' | 'date' = 'text') => (
    <DirtyFieldWrapper fieldKey={fieldKey}>
      <div className="flex items-center gap-2">
        <Label className="w-[110px] shrink-0 text-xs text-foreground">{label}</Label>
        <Input
          value={getFieldValue(fieldKey)}
          onChange={(e) => onValueChange(fieldKey, e.target.value)}
          disabled={disabled}
          type={type}
          className="h-7 text-xs flex-1"
        />
      </div>
    </DirtyFieldWrapper>
  );

  const renderInlineSelect = (fieldKey: string, label: string, options: string[], placeholder: string) => (
    <DirtyFieldWrapper fieldKey={fieldKey}>
      <div className="flex items-center gap-2">
        <Label className="w-[110px] shrink-0 text-xs text-foreground">{label}</Label>
        <Select value={getFieldValue(fieldKey)} onValueChange={(val) => onValueChange(fieldKey, val)} disabled={disabled}>
          <SelectTrigger className="h-7 text-xs flex-1">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent className="bg-background border border-border z-50 max-h-60">
            {options.map(opt => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
    </DirtyFieldWrapper>
  );

  const renderCurrencyField = (fieldKey: string, label: string) => (
    <DirtyFieldWrapper fieldKey={fieldKey}>
      <div className="flex items-center gap-2">
        <Label className="w-[110px] shrink-0 text-xs text-foreground">{label}</Label>
        <div className="relative flex-1">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
          <Input
            value={getFieldValue(fieldKey)}
            onChange={(e) => handleCurrencyChange(fieldKey, e.target.value)}
            onBlur={() => { const raw = getFieldValue(fieldKey); if (raw) onValueChange(fieldKey, formatCurrencyDisplay(raw)); }}
            onFocus={() => { const raw = getFieldValue(fieldKey); if (raw) onValueChange(fieldKey, unformatCurrencyDisplay(raw)); }}
            onKeyDown={numericKeyDown}
            onPaste={(e) => numericPaste(e, (val) => onValueChange(fieldKey, val))}
            disabled={disabled}
            className="h-7 text-xs pl-6"
            inputMode="decimal"
            placeholder="0.00"
          />
        </div>
      </div>
    </DirtyFieldWrapper>
  );

  const renderPercentageField = (fieldKey: string, label: string) => (
    <DirtyFieldWrapper fieldKey={fieldKey}>
      <div className="flex items-center gap-2">
        <Label className="w-[110px] shrink-0 text-xs text-foreground">{label}</Label>
        <div className="relative flex-1">
          <Input value={getFieldValue(fieldKey)} onChange={(e) => handlePercentageChange(fieldKey, e.target.value)} disabled={disabled} className="h-7 text-xs pr-6" inputMode="decimal" />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
        </div>
      </div>
    </DirtyFieldWrapper>
  );

  const renderCheckboxField = (fieldKey: string, label: string) => (
    <DirtyFieldWrapper fieldKey={fieldKey}>
      <div className="flex items-center gap-2">
        <Checkbox checked={getFieldValue(fieldKey) === 'true'} onCheckedChange={(c) => onValueChange(fieldKey, String(!!c))} disabled={disabled} className="h-3.5 w-3.5" />
        <Label className="text-xs text-foreground">{label}</Label>
      </div>
    </DirtyFieldWrapper>
  );

  const renderDateField = (fieldKey: string, label: string) => {
    const val = getFieldValue(fieldKey);
    return (
      <DirtyFieldWrapper fieldKey={fieldKey}>
        <div className="flex items-center gap-2">
          <Label className="w-[110px] shrink-0 text-xs text-foreground">{label}</Label>
          <Popover open={datePickerStates[fieldKey] || false} onOpenChange={(open) => setDatePickerStates(prev => ({ ...prev, [fieldKey]: open }))}>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn('h-7 w-full justify-start text-left font-normal text-xs', !val && 'text-muted-foreground')} disabled={disabled}>
                {val && parseDate(val) ? format(parseDate(val)!, 'MM/dd/yyyy') : 'MM/DD/YYYY'}
                <CalendarIcon className="ml-auto h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 z-[9999]" align="start">
              <EnhancedCalendar mode="single" selected={parseDate(val)}
                onSelect={(date) => { if (date) onValueChange(fieldKey, format(date, 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, [fieldKey]: false })); }}
                onClear={() => { onValueChange(fieldKey, ''); setDatePickerStates(prev => ({ ...prev, [fieldKey]: false })); }}
                onToday={() => { onValueChange(fieldKey, format(new Date(), 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, [fieldKey]: false })); }}
                initialFocus />
            </PopoverContent>
          </Popover>
        </div>
      </DirtyFieldWrapper>
    );
  };

  return (
    <div className="p-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-0">
        {/* Column 1 — Property Details */}
        <div className="space-y-1.5">
          <div className="border-b border-border pb-1 mb-2">
            <span className="font-semibold text-xs text-primary">Property Details</span>
          </div>
          {renderInlineSelect(FIELD_KEYS.informationProvidedBy, 'Information Provided By', INFO_PROVIDED_BY_OPTIONS, 'Select...')}
          {renderCheckboxField(FIELD_KEYS.primaryCollateral, 'Primary Collateral')}
          {renderInlineField(FIELD_KEYS.description, 'Description (Nickname)')}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.propertyOwner}>
            <div className="flex items-center gap-2">
              <Label className="w-[110px] shrink-0 text-xs text-foreground">Property Owner</Label>
              <Popover open={ownerPickerOpen} onOpenChange={setOwnerPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    disabled={disabled}
                    className={cn(
                      'h-7 flex-1 justify-between text-xs font-normal px-2',
                      !getFieldValue(FIELD_KEYS.propertyOwner) && 'text-muted-foreground'
                    )}
                  >
                    <span className="truncate">
                      {getFieldValue(FIELD_KEYS.propertyOwner) || 'Search borrower...'}
                    </span>
                    <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0 z-[9999] w-[var(--radix-popover-trigger-width)]" align="start">
                  <Command>
                    <CommandInput placeholder="Search borrower or type a name..." className="h-8 text-xs" />
                    <CommandList>
                      <CommandEmpty className="py-2 px-2 text-xs text-muted-foreground">
                        No borrower found.
                      </CommandEmpty>
                      <CommandGroup>
                        {borrowerOptions.map((name) => {
                          const selected = getFieldValue(FIELD_KEYS.propertyOwner) === name;
                          return (
                            <CommandItem
                              key={name}
                              value={name}
                              onSelect={() => {
                                onValueChange(FIELD_KEYS.propertyOwner, name);
                                setOwnerPickerOpen(false);
                              }}
                              className="text-xs"
                            >
                              <Check className={cn('mr-2 h-3.5 w-3.5', selected ? 'opacity-100' : 'opacity-0')} />
                              {name}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </DirtyFieldWrapper>

          <div className="pt-1">
            <span className="text-xs font-medium text-primary">Land Classification</span>
          </div>
          {renderInlineSelect('property1.land_classification', 'Land Classification', ['Land SFR Residential', 'Land Residential', 'Land Commercial', 'Land Income Producing'], 'Select...')}

          <div className="pt-1">
            <span className="text-xs font-medium text-primary">Address</span>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="copy-borrower-address" checked={getFieldValue(FIELD_KEYS.copyBorrowerAddress) === 'true'} onCheckedChange={(checked) => onValueChange(FIELD_KEYS.copyBorrowerAddress, String(!!checked))} disabled={disabled} className="h-3.5 w-3.5" />
            <Label htmlFor="copy-borrower-address" className="text-xs text-primary">Copy Borrower's Address</Label>
          </div>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.street}>
            <div className="flex items-center gap-2">
              <Label className="w-[110px] shrink-0 text-xs text-foreground">Street</Label>
              <Input value={getFieldValue(FIELD_KEYS.street)} onChange={(e) => onValueChange(FIELD_KEYS.street, e.target.value)} disabled={disabled || isCopyBorrower} className="h-7 text-xs flex-1" />
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.city}>
            <div className="flex items-center gap-2">
              <Label className="w-[110px] shrink-0 text-xs text-foreground">City</Label>
              <Input value={getFieldValue(FIELD_KEYS.city)} onChange={(e) => onValueChange(FIELD_KEYS.city, e.target.value)} disabled={disabled || isCopyBorrower} className="h-7 text-xs flex-1" />
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.state}>
            <div className="flex items-center gap-2">
              <Label className="w-[110px] shrink-0 text-xs text-foreground">State</Label>
              <Select value={getFieldValue(FIELD_KEYS.state)} onValueChange={(val) => onValueChange(FIELD_KEYS.state, (val === '__select__' ? '' : val))} disabled={disabled || isCopyBorrower}>
                <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Select state" /></SelectTrigger>
                <SelectContent className="bg-background border border-border z-50 max-h-60">
                  <SelectItem value="__select__">Select</SelectItem>
                  {US_STATES.map(opt => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.zip}>
            <div className="flex items-center gap-2">
              <Label className="w-[110px] shrink-0 text-xs text-foreground">ZIP Code</Label>
              <ZipInput value={getFieldValue(FIELD_KEYS.zip)} onValueChange={(v) => onValueChange(FIELD_KEYS.zip, v)} disabled={disabled || isCopyBorrower} className="h-7 text-xs" />
            </div>
          </DirtyFieldWrapper>
          {renderInlineField(FIELD_KEYS.county, 'County')}

        </div>

        {/* Column 2 — Characteristics */}
        <div className="space-y-1.5">
          <div className="border-b border-border pb-1 mb-2">
            <span className="font-semibold text-xs text-primary">Purchase Information</span>
          </div>
          {renderDateField(FIELD_KEYS.purchaseDate, 'Purchase Date')}
          {renderCurrencyField(FIELD_KEYS.purchasePrice, 'Purchase Price')}
          {renderCurrencyField(FIELD_KEYS.downPayment, 'Down Payment')}

          {renderInlineSelect(FIELD_KEYS.propertyType, 'Property Type', PROPERTY_TYPE_OPTIONS, 'Select type')}
          {renderInlineSelect(FIELD_KEYS.occupancy, 'Occupancy', OCCUPANCY_OPTIONS, 'Select')}
          {renderDateField(FIELD_KEYS.yearBuilt, 'Year Built')}
          {renderInlineField(FIELD_KEYS.squareFeet, 'Square Feet')}
          {renderInlineSelect(FIELD_KEYS.constructionType, 'Type of Construction', CONSTRUCTION_TYPES, 'Select...')}
          {renderInlineSelect(FIELD_KEYS.zoning, 'Zoning', ZONING_OPTIONS, 'Select...')}

          {renderCheckboxField(FIELD_KEYS.floodZone, 'Flood Zone')}
          {renderCheckboxField(FIELD_KEYS.fireZone, 'Fire Zone')}
          {renderCurrencyField(FIELD_KEYS.netMonthlyIncome, 'Net Monthly Income')}
        </div>

        {/* Column 3 — Valuation */}
        <div className="space-y-1.5">
          <div className="border-b border-border pb-1 mb-2">
            <span className="font-semibold text-xs text-primary">Valuation:</span>
          </div>
          {renderCurrencyField(FIELD_KEYS.appraisedValue, 'Estimate of Value')}
          {renderDateField(FIELD_KEYS.appraisedDate, 'Valuation Date')}
          {renderInlineSelect(FIELD_KEYS.valuationType, 'Valuation Type', VALUATION_TYPE_OPTIONS, 'Select')}
          {renderInlineSelect(FIELD_KEYS.performedBy, 'Performed By', PERFORMED_BY_OPTIONS, 'Select...')}

          {getFieldValue(FIELD_KEYS.performedBy) === 'Third Party' && (
            <>
              {renderInlineField(FIELD_KEYS.thirdPartyFullName, 'Full Name')}
              {renderInlineField(FIELD_KEYS.thirdPartyStreet, 'Street')}
              {renderInlineField(FIELD_KEYS.thirdPartyCity, 'City')}
              <DirtyFieldWrapper fieldKey={FIELD_KEYS.thirdPartyState}>
                <div className="flex items-center gap-2">
                  <Label className="w-[110px] shrink-0 text-xs text-foreground">State</Label>
                  <Select value={getFieldValue(FIELD_KEYS.thirdPartyState)} onValueChange={(val) => onValueChange(FIELD_KEYS.thirdPartyState, (val === '__select__' ? '' : val))} disabled={disabled}>
                    <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Select state" /></SelectTrigger>
                    <SelectContent className="bg-background border border-border z-50 max-h-60">
                      <SelectItem value="__select__">Select</SelectItem>
                      {US_STATES.map(opt => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              </DirtyFieldWrapper>
              <DirtyFieldWrapper fieldKey={FIELD_KEYS.thirdPartyZip}>
                <div className="flex items-center gap-2">
                  <Label className="w-[110px] shrink-0 text-xs text-foreground">ZIP Code</Label>
                  <ZipInput value={getFieldValue(FIELD_KEYS.thirdPartyZip)} onValueChange={(v) => onValueChange(FIELD_KEYS.thirdPartyZip, v)} disabled={disabled} className="h-7 text-xs" />
                </div>
              </DirtyFieldWrapper>
              <DirtyFieldWrapper fieldKey={FIELD_KEYS.appraiserPhone}>
                <div className="flex items-center gap-2">
                  <Label className="w-[110px] shrink-0 text-xs text-foreground">Phone</Label>
                  <PhoneInput value={getFieldValue(FIELD_KEYS.appraiserPhone)} onValueChange={(v) => onValueChange(FIELD_KEYS.appraiserPhone, v)} disabled={disabled} className="h-7 text-xs" />
                </div>
              </DirtyFieldWrapper>
              <DirtyFieldWrapper fieldKey={FIELD_KEYS.appraiserEmail}>
                <div className="flex items-center gap-2">
                  <Label className="w-[110px] shrink-0 text-xs text-foreground">Email</Label>
                  <EmailInput value={getFieldValue(FIELD_KEYS.appraiserEmail)} onValueChange={(v) => onValueChange(FIELD_KEYS.appraiserEmail, v)} disabled={disabled} className="h-7 text-xs" />
                </div>
              </DirtyFieldWrapper>
            </>
          )}

          {renderCurrencyField(FIELD_KEYS.pledgedEquity, 'Pledged Equity')}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.protectiveEquity}>
            <div className="flex items-center gap-2">
              <Label className="w-[110px] shrink-0 text-xs text-foreground">Protective Equity</Label>
              <div className="relative flex-1">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
                <Input
                  value={getFieldValue(FIELD_KEYS.protectiveEquity)}
                  onChange={(e) => onValueChange(FIELD_KEYS.protectiveEquity, unformatCurrencyDisplay(e.target.value))}
                  onBlur={() => { const raw = getFieldValue(FIELD_KEYS.protectiveEquity); if (raw) onValueChange(FIELD_KEYS.protectiveEquity, formatCurrencyDisplay(raw)); }}
                  onFocus={() => { const raw = getFieldValue(FIELD_KEYS.protectiveEquity); if (raw) onValueChange(FIELD_KEYS.protectiveEquity, unformatCurrencyDisplay(raw)); }}
                  onKeyDown={numericKeyDown}
                  onPaste={(e) => numericPaste(e, (val) => onValueChange(FIELD_KEYS.protectiveEquity, val))}
                  disabled={disabled}
                  className="h-7 text-xs pl-6"
                />
              </div>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.originationLtv}>
            <div className="flex items-center gap-2">
              <Label className="w-[110px] shrink-0 text-xs text-foreground">Origination LTV</Label>
              <div className="relative flex-1">
                <Input
                  value={getFieldValue(FIELD_KEYS.originationLtv)}
                  onChange={(e) => handlePercentageChange(FIELD_KEYS.originationLtv, e.target.value)}
                  disabled={disabled}
                  className="h-7 text-xs pr-6"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
              </div>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.ltv}>
            <div className="flex items-center gap-2">
              <Label className="w-[110px] shrink-0 text-xs text-foreground">Current LTV</Label>
              <div className="relative flex-1">
                <Input
                  value={getFieldValue(FIELD_KEYS.ltv)}
                  onChange={(e) => handlePercentageChange(FIELD_KEYS.ltv, e.target.value)}
                  disabled={disabled}
                  className="h-7 text-xs pr-6"
                  inputMode="decimal"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
              </div>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.cltv}>
            <div className="flex items-center gap-2">
              <Label className="w-[110px] shrink-0 text-xs text-foreground">CLTV (If a Junior Lien)</Label>
              <div className="relative flex-1">
                <Input
                  value={getFieldValue(FIELD_KEYS.cltv)}
                  onChange={(e) => handlePercentageChange(FIELD_KEYS.cltv, e.target.value)}
                  disabled={disabled}
                  className="h-7 text-xs pr-6"
                  inputMode="decimal"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
              </div>
            </div>
          </DirtyFieldWrapper>
        </div>
      </div>
    </div>
  );
};

export default PropertyDetailsForm;
