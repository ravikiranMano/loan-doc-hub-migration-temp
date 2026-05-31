import React, { useState, useEffect } from 'react';
import { Home, CalendarIcon } from 'lucide-react';
import { EmailInput } from '@/components/ui/email-input';
import { formatCurrencyDisplay, unformatCurrencyDisplay, numericKeyDown, numericPaste } from '@/lib/numericInputFilter';
import { ZipInput } from '@/components/ui/zip-input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ChevronsUpDown, Check } from 'lucide-react';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { TypableDateField } from '@/components/ui/typable-date-field';
import { format, parse } from 'date-fns';
import { cn } from '@/lib/utils';
import { ModalSaveConfirmation } from './ModalSaveConfirmation';
import { hasModalFormData, hasValidEmails } from '@/lib/modalFormValidation';
import type { PropertyData } from './PropertiesTableView';

interface PropertyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property?: PropertyData | null;
  onSave: (property: PropertyData) => void;
  isEdit?: boolean;
  borrowerAddress?: { street: string; city: string; state: string; zipCode: string };
  borrowerOptions?: string[];
  borrowerParticipants?: Array<{ name: string; street: string; city: string; state: string; zipCode: string }>;
  loanAmount?: number;
  currentPrincipal?: number;
  existingLiensTotal?: number;
  liensCurrentBalanceTotal?: number;
}


const PROPERTY_TYPE_OPTIONS = [
  'SFR 1-4', 'Multi-family', 'Condo / Townhouse', 'Mobile Home', 'Commercial',
  'Commercial Income', 'Mixed-use', 'Land SFR Residential', 'Land Residential',
  'Land Commercial', 'Land Income Producing', 'Farm', 'Restaurant / Bar', 'Group Housing'
];
const OCCUPANCY_OPTIONS = ['Owner Occupied', 'Vacant', 'NA', 'Rental / Tenant'];
const PERFORMED_BY_OPTIONS = ['Broker', 'Third Party'];
const CONSTRUCTION_TYPES = ['Wood Frame', 'Wood Frame / Stucco', 'Modular', 'Steel Frame', 'Brick / Block', 'NA', 'Concrete / Block'];
const ZONING_OPTIONS = ['R1 SFR', 'R2 SFR', 'R3 Multi-family', 'R-M Multi-family', 'PUD', 'Residential Lot / Parcel', 'Mixed Use', 'C Commercial', 'Agriculture', 'NA'];
const LAND_CLASSIFICATION_OPTIONS = ['Land SFR Residential', 'Land Residential', 'Land Commercial', 'Land Income Producing'];
const VALUATION_TYPE_OPTIONS = ['Appraisal', 'Broker Determined Value (BPO)'];
const INFO_PROVIDED_BY_OPTIONS = ['Broker', 'Borrower', 'Public Record', 'Other'];

import { US_STATES } from '@/lib/usStates';

const generatePropertyId = () => `property_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const getEmptyProperty = (): PropertyData => ({
  id: generatePropertyId(), isPrimary: false, description: '', street: '', city: '', state: '', zipCode: '', county: '',
  propertyType: '', occupancy: '', appraisedValue: '', appraisedDate: '', ltv: '', originationLtv: '', apn: '',
  loanPriority: '', floodZone: '', fireZone: '', landClassification: '', pledgedEquity: '',
  zoning: '', performedBy: '', copyBorrowerAddress: false,
  purchasePrice: '', downPayment: '', delinquentTaxes: '',
  appraiserStreet: '', appraiserCity: '', appraiserState: '', appraiserZip: '', appraiserPhone: '', appraiserEmail: '',
  yearBuilt: '', squareFeet: '', constructionType: '', monthlyIncome: '', lienProtectiveEquity: '', sourceLienInfo: '',
  delinquencies60day: false, delinquenciesHowMany: '', currentlyDelinquent: false, paidByLoan: false,
  sourceOfPayment: '', recordingNumber: '',
  primaryCollateral: false, purchaseDate: '', propertyGeneratesIncome: false,
  netMonthlyIncome: '', fromRent: '', fromOtherDescribe: '',
  valuationDate: '', valuationType: '', thirdPartyFullName: '', thirdPartyStreet: '', thirdPartyCity: '',
  thirdPartyState: '', thirdPartyZip: '', protectiveEquity: '', cltv: '',
  informationProvidedBy: '',
  propertyOwner: '',
});

export const PropertyModal: React.FC<PropertyModalProps> = ({ open, onOpenChange, property, onSave, isEdit = false, borrowerAddress, borrowerOptions = [], borrowerParticipants = [], loanAmount = 0, currentPrincipal = 0, existingLiensTotal = 0, liensCurrentBalanceTotal = 0 }) => {
  const [formData, setFormData] = useState<PropertyData>(getEmptyProperty());
  const [showConfirm, setShowConfirm] = useState(false);
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);
  // Snapshot of last-known address values, captured on uncheck so that a
  // subsequent re-check repopulates the same data even when the live source
  // resolves to empty strings.
  const lastCopiedAddressRef = React.useRef<{ street: string; city: string; state: string; zipCode: string } | null>(null);

  // Resolve effective borrower address: prefer the participant matching the
  // currently-selected Property Owner; fall back to the parent-supplied
  // borrowerAddress prop.
  const resolveBorrowerAddress = (ownerName: string | undefined) => {
    if (ownerName && borrowerParticipants.length > 0) {
      const match = borrowerParticipants.find(b => b.name === ownerName);
      if (match && (match.street || match.city || match.state || match.zipCode)) {
        return { street: match.street || '', city: match.city || '', state: match.state || '', zipCode: match.zipCode || '' };
      }
    }
    return {
      street: borrowerAddress?.street || '',
      city: borrowerAddress?.city || '',
      state: borrowerAddress?.state || '',
      zipCode: borrowerAddress?.zipCode || '',
    };
  };

  const CURRENCY_MODAL_FIELDS: (keyof PropertyData)[] = ['purchasePrice', 'downPayment', 'delinquentTaxes', 'appraisedValue', 'monthlyIncome', 'lienProtectiveEquity', 'netMonthlyIncome', 'fromRent', 'fromOtherDescribe', 'protectiveEquity', 'pledgedEquity'];
  useEffect(() => {
    if (open) {
      const base = property ? { ...getEmptyProperty(), ...property } : getEmptyProperty();
      CURRENCY_MODAL_FIELDS.forEach(f => {
        const v = String(base[f] || '');
        if (v) (base as any)[f] = formatCurrencyDisplay(v);
      });
      setFormData(base);
      lastCopiedAddressRef.current = null;
    }
  }, [open, property]);

  // Auto-calculate OLTV, Current LTV, CLTV, and Protective Equity from
  // Estimate of Value + loan/lien context. Mirrors PropertyDetailsForm spec:
  //   Protective Equity = Estimate of Value − Total Current Lien Balance
  //   Origination LTV   = Loan Amount / Estimate of Value × 100
  //   Current LTV       = Current Principal / Estimate of Value × 100
  //   CLTV              = Sum of all liens / Estimate of Value × 100
  useEffect(() => {
    if (!open) return;
    const evRaw = String(formData.appraisedValue || '').replace(/[, $]/g, '');
    const ev = parseFloat(evRaw);
    if (!Number.isFinite(ev) || ev <= 0) return;

    const fmtPct = (num: number, denom: number): string => {
      if (!Number.isFinite(num) || !Number.isFinite(denom) || denom <= 0) return '';
      return ((num / denom) * 100).toFixed(2);
    };
    const fmtDollar = (n: number): string => {
      if (!Number.isFinite(n)) return '';
      return formatCurrencyDisplay(n.toFixed(2));
    };

    const nextProtective = fmtDollar(ev - (liensCurrentBalanceTotal || 0));
    const nextOLtv = fmtPct(loanAmount || 0, ev);
    const nextCurLtv = fmtPct(currentPrincipal || 0, ev);
    const nextCltv = fmtPct(existingLiensTotal || 0, ev);

    setFormData(prev => {
      const updates: Partial<PropertyData> = {};
      if (String(prev.protectiveEquity || '') !== nextProtective) updates.protectiveEquity = nextProtective;
      if (String(prev.originationLtv || '') !== nextOLtv) updates.originationLtv = nextOLtv;
      if (String(prev.ltv || '') !== nextCurLtv) updates.ltv = nextCurLtv;
      if (String(prev.cltv || '') !== nextCltv) updates.cltv = nextCltv;
      return Object.keys(updates).length ? { ...prev, ...updates } : prev;
    });
  }, [open, formData.appraisedValue, loanAmount, currentPrincipal, existingLiensTotal, liensCurrentBalanceTotal]);

  


  const handleFieldChange = (field: keyof PropertyData, value: string | boolean) => {
    const resolved = value === '__none__' ? '' : value;
    setFormData(prev => {
      const next = { ...prev, [field]: resolved } as PropertyData;
      if (field === 'copyBorrowerAddress') {
        if (value === true) {
          const live = resolveBorrowerAddress(prev.propertyOwner);
          const snap = lastCopiedAddressRef.current;
          const hasLive = !!(live.street || live.city || live.state || live.zipCode);
          const hasSnap = !!(snap && (snap.street || snap.city || snap.state || snap.zipCode));
          if (hasLive) {
            next.street = live.street;
            next.city = live.city;
            next.state = live.state;
            next.zipCode = live.zipCode;
          } else if (hasSnap) {
            next.street = snap!.street;
            next.city = snap!.city;
            next.state = snap!.state;
            next.zipCode = snap!.zipCode;
          }
        } else if (value === false) {
          // Snapshot current values before clearing so re-check restores them
          lastCopiedAddressRef.current = {
            street: prev.street || '',
            city: prev.city || '',
            state: prev.state || '',
            zipCode: prev.zipCode || '',
          };
          next.street = '';
          next.city = '';
          next.state = '';
          next.zipCode = '';
        }
      } else if (field === 'propertyOwner' && prev.copyBorrowerAddress) {
        // When the Property Owner changes while Copy is checked, refresh the
        // address from the newly-selected participant.
        const live = resolveBorrowerAddress(String(resolved || ''));
        if (live.street || live.city || live.state || live.zipCode) {
          next.street = live.street;
          next.city = live.city;
          next.state = live.state;
          next.zipCode = live.zipCode;
        }
      }
      return next;
    });
  };
  const sanitizeNumericValue = (value: string): string => value.replace(/[^0-9.]/g, '');
  const handleCurrencyChange = (field: keyof PropertyData, value: string) => setFormData(prev => ({ ...prev, [field]: sanitizeNumericValue(value) }));
  const handleCurrencyBlur = (field: keyof PropertyData) => {
    const raw = String(formData[field] || '');
    if (raw) setFormData(prev => ({ ...prev, [field]: formatCurrencyDisplay(raw) }));
  };
  const handleCurrencyFocus = (field: keyof PropertyData) => {
    const raw = String(formData[field] || '');
    if (raw) setFormData(prev => ({ ...prev, [field]: unformatCurrencyDisplay(raw) }));
  };
  const handlePercentageChange = (field: keyof PropertyData, value: string) => setFormData(prev => ({ ...prev, [field]: sanitizeNumericValue(value).replace(/-/g, '') }));

  const parseDate = (val: string): Date | undefined => {
    if (!val) return undefined;
    try { return parse(val, 'yyyy-MM-dd', new Date()); } catch { return undefined; }
  };

  const isFormFilled = hasModalFormData(formData, ['id']);
  const emailsValid = hasValidEmails(formData as any, ['appraiserEmail']);

  const handleSaveClick = () => setShowConfirm(true);
  const CURRENCY_FIELDS: (keyof PropertyData)[] = ['purchasePrice', 'downPayment', 'delinquentTaxes', 'appraisedValue', 'monthlyIncome', 'lienProtectiveEquity', 'netMonthlyIncome', 'fromRent', 'fromOtherDescribe', 'protectiveEquity', 'pledgedEquity'];
  const handleConfirmSave = () => {
    setShowConfirm(false);
    const cleaned = { ...formData };
    CURRENCY_FIELDS.forEach(f => {
      const v = String(cleaned[f] || '');
      if (v) (cleaned as any)[f] = v.replace(/,/g, '');
    });
    onSave(cleaned);
    onOpenChange(false);
  };

  const [datePickerStates, setDatePickerStates] = useState<Record<string, boolean>>({});

  const renderInlineField = (field: keyof PropertyData, label: string, type = 'text') => {
    if (type === 'date') {
      const val = String(formData[field] || '');
      return (
        <div className="flex items-center gap-2">
          <Label className="w-[110px] shrink-0 text-xs text-foreground">{label}</Label>
          <div className="flex-1">
            <TypableDateField
              value={val}
              onChange={(iso) => handleFieldChange(field, iso)}
              inputClassName="h-7 text-xs"
            />
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <Label className="w-[110px] shrink-0 text-xs text-foreground">{label}</Label>
        <Input value={String(formData[field] || '')} onChange={(e) => handleFieldChange(field, e.target.value)} className="h-7 text-xs flex-1" type={type} />
      </div>
    );
  };

  const renderInlineSelect = (field: keyof PropertyData, label: string, options: string[] | { value: string; label: string }[], placeholder: string) => {
    const rawVal = String(formData[field] || '');
    const selectVal = rawVal === '' ? '__none__' : rawVal;
    return (
      <div className="flex items-center gap-2">
        <Label className="w-[110px] shrink-0 text-xs text-foreground">{label}</Label>
        <Select value={selectVal} onValueChange={(val) => handleFieldChange(field, val)}>
          <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder={placeholder} /></SelectTrigger>
          <SelectContent className="bg-background border border-border z-[200] max-h-60">
            <SelectItem value="__none__">{placeholder}</SelectItem>
            {options.map(opt => {
              const v = typeof opt === 'string' ? opt : opt.value;
              const l = typeof opt === 'string' ? opt : opt.label;
              return <SelectItem key={v} value={v}>{l}</SelectItem>;
            })}
          </SelectContent>
        </Select>
      </div>
    );
  };

  const renderCurrencyField = (field: keyof PropertyData, label: string, readOnly = false) => (
    <div className="flex items-center gap-2">
      <Label className="w-[110px] shrink-0 text-xs text-foreground">{label}</Label>
      <div className="relative flex-1">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
        <Input
          value={String(formData[field] || '')}
          onChange={(e) => handleCurrencyChange(field, e.target.value)}
          onBlur={() => handleCurrencyBlur(field)}
          onFocus={() => handleCurrencyFocus(field)}
          onKeyDown={numericKeyDown}
          onPaste={(e) => numericPaste(e, (val) => setFormData(prev => ({ ...prev, [field]: val })))}
          className="h-7 text-xs pl-6"
          inputMode="decimal"
          placeholder="0.00"
          readOnly={readOnly}
          tabIndex={readOnly ? -1 : undefined}
        />
      </div>
    </div>
  );


  const renderCheckboxField = (field: keyof PropertyData, label: string) => (
    <div className="flex items-center gap-2">
      <Checkbox checked={!!formData[field]} onCheckedChange={(c) => handleFieldChange(field, !!c)} className="h-3.5 w-3.5" />
      <Label className="text-xs text-foreground">{label}</Label>
    </div>
  );

  const renderPercentageField = (field: keyof PropertyData, label: string, readOnly = false) => (
    <div className="flex items-center gap-2">
      <Label className="w-[110px] shrink-0 text-xs text-foreground">{label}</Label>
      <div className="relative flex-1">
        <Input
          value={String(formData[field] || '')}
          onChange={(e) => handlePercentageChange(field, e.target.value)}
          className="h-7 text-xs pr-6"
          inputMode="decimal"
          readOnly={readOnly}
          tabIndex={readOnly ? -1 : undefined}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
      </div>
    </div>
  );


  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Home className="h-4 w-4 text-primary" />
              {isEdit ? 'Edit Property' : 'Add New Property'}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0 sleek-scrollbar p-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-0">
              {/* Column 1 — Property Details */}
              <div className="space-y-1.5">
                <div className="border-b border-border pb-1 mb-2">
                  <span className="font-semibold text-xs text-primary">Property Details</span>
                </div>
                {renderInlineSelect('informationProvidedBy', 'Information Provided By', INFO_PROVIDED_BY_OPTIONS, 'Select...')}
                {renderCheckboxField('primaryCollateral', 'Primary Collateral')}
                {renderInlineField('description', 'Description (Nickname)')}
                <div className="flex items-center gap-2">
                  <Label className="w-[110px] shrink-0 text-xs text-foreground">Property Owner</Label>
                  <Popover open={ownerPickerOpen} onOpenChange={setOwnerPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        className={cn('h-7 flex-1 justify-between text-xs font-normal px-2', !formData.propertyOwner && 'text-muted-foreground')}
                      >
                        <span className="truncate">{formData.propertyOwner || 'Search borrower...'}</span>
                        <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 z-[9999] w-[var(--radix-popover-trigger-width)]" align="start">
                      <Command>
                        <CommandInput placeholder="Search borrower..." className="h-8 text-xs" />
                        <CommandList>
                          <CommandEmpty className="py-2 px-2 text-xs text-muted-foreground">No borrower found.</CommandEmpty>
                          <CommandGroup>
                            {borrowerOptions.map((name) => {
                              const selected = formData.propertyOwner === name;
                              return (
                                <CommandItem
                                  key={name}
                                  value={name}
                                  onSelect={() => { handleFieldChange('propertyOwner', name); setOwnerPickerOpen(false); }}
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

                <div className="pt-1">
                  <span className="text-xs font-medium text-primary">Land Classification</span>
                </div>
                {renderInlineSelect('landClassification', 'Land Classification', LAND_CLASSIFICATION_OPTIONS, 'Select...')}

                <div className="pt-1">
                  <span className="text-xs font-medium text-primary">Address</span>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="modal-copy-borrower-address" checked={!!formData.copyBorrowerAddress} onCheckedChange={(checked) => handleFieldChange('copyBorrowerAddress', !!checked)} className="h-3.5 w-3.5" />
                  <Label htmlFor="modal-copy-borrower-address" className="text-xs text-primary">Copy Borrower's Address</Label>
                </div>
                {renderInlineField('street', 'Street')}
                {renderInlineField('city', 'City')}
                {renderInlineSelect('state', 'State', US_STATES, 'Select state')}
                <div className="flex items-center gap-2">
                  <Label className="w-[110px] shrink-0 text-xs text-foreground">ZIP Code</Label>
                  <ZipInput value={String(formData.zipCode || '')} onValueChange={(v) => handleFieldChange('zipCode', v)} className="h-7 text-xs" />
                </div>
                {renderInlineField('county', 'County')}

              </div>

              {/* Column 2 — Characteristics */}
              <div className="space-y-1.5">
                <div className="border-b border-border pb-1 mb-2">
                  <span className="font-semibold text-xs text-primary">Purchase Information</span>
                </div>
                {renderInlineField('purchaseDate', 'Purchase Date', 'date')}
                {renderCurrencyField('purchasePrice', 'Purchase Price')}
                {renderCurrencyField('downPayment', 'Down Payment')}

                {renderInlineSelect('propertyType', 'Property Type', PROPERTY_TYPE_OPTIONS, 'Select type')}
                {renderInlineSelect('occupancy', 'Occupancy', OCCUPANCY_OPTIONS, 'Select')}
                {renderInlineField('yearBuilt', 'Year Built')}
                {renderInlineField('squareFeet', 'Square Feet')}
                {renderInlineSelect('constructionType', 'Type of Construction', CONSTRUCTION_TYPES, 'Select...')}
                {renderInlineSelect('zoning', 'Zoning', ZONING_OPTIONS, 'Select...')}

                {renderCheckboxField('floodZone', 'Flood Zone')}
                {renderCheckboxField('fireZone', 'Fire Zone')}
                {renderCurrencyField('netMonthlyIncome', 'Net Monthly Income')}
              </div>

              {/* Column 3 — Valuation */}
              <div className="space-y-1.5">
                <div className="border-b border-border pb-1 mb-2">
                  <span className="font-semibold text-xs text-primary">Valuation:</span>
                </div>
                {renderCurrencyField('appraisedValue', 'Estimate of Value')}
                {renderInlineField('appraisedDate', 'Valuation Date', 'date')}
                {renderInlineSelect('valuationType', 'Valuation Type', VALUATION_TYPE_OPTIONS, 'Select')}
                {renderInlineSelect('performedBy', 'Performed By', PERFORMED_BY_OPTIONS, 'Select...')}

                {formData.performedBy === 'Third Party' && (
                  <>
                    {renderInlineField('thirdPartyFullName', 'Full Name')}
                    {renderInlineField('thirdPartyStreet', 'Street')}
                    {renderInlineField('thirdPartyCity', 'City')}
                    {renderInlineSelect('thirdPartyState', 'State', US_STATES, 'Select state')}
                    <div className="flex items-center gap-2">
                      <Label className="w-[110px] shrink-0 text-xs text-foreground">ZIP Code</Label>
                      <ZipInput value={String(formData.thirdPartyZip || '')} onValueChange={(v) => handleFieldChange('thirdPartyZip', v)} className="h-7 text-xs" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="w-[110px] shrink-0 text-xs text-foreground">Phone</Label>
                      <PhoneInput value={String(formData.appraiserPhone || '')} onValueChange={(v) => handleFieldChange('appraiserPhone', v)} className="h-7 text-xs flex-1" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="w-[110px] shrink-0 text-xs text-foreground">Email</Label>
                      <EmailInput value={String(formData.appraiserEmail || '')} onValueChange={(v) => handleFieldChange('appraiserEmail', v)} className="h-7 text-xs" />
                    </div>
                  </>
                )}

                
                {renderCurrencyField('pledgedEquity', 'Pledged Equity')}
                {renderCurrencyField('protectiveEquity', 'Protective Equity', true)}
                {renderPercentageField('originationLtv' as keyof PropertyData, 'Original LTV', true)}
                {renderPercentageField('ltv', 'Current LTV', true)}
                {renderPercentageField('cltv', 'CLTV (If a Junior Lien)', true)}

              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-border pt-3">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveClick} disabled={!isFormFilled || !emailsValid}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ModalSaveConfirmation open={showConfirm} onConfirm={handleConfirmSave} onCancel={() => setShowConfirm(false)} />
    </>
  );
};

export default PropertyModal;
