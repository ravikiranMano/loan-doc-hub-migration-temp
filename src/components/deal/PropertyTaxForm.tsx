import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { CalendarIcon, Search } from 'lucide-react';
import { format, parse, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import { numericKeyDown, numericPaste, formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';
import { ZipInput } from '@/components/ui/zip-input';
import { STATE_OPTIONS } from '@/lib/usStates';
import type { FieldDefinition } from '@/hooks/useDealFields';
import type { CalculationResult } from '@/lib/calculationEngine';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';

interface PropertyTaxFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
  propertyOptions?: string[];
}

const FREQUENCY_OPTIONS = [
  'Once', 'Weekly', 'Bi-Weekly', 'Monthly', 'Bi-Monthly',
  'Semi-Monthly', 'Semi-Yearly', 'Yearly',
];

const TYPE_OPTIONS = ['Current Property Tax', 'Delinquent Property Tax', 'Other'];
const SOURCE_OPTIONS = ['Borrower', 'Broker', 'Lender', 'Title / Escrow', 'Public Record'];
const IMPOUNDED_OPTIONS = ['NA', 'Active', 'On Hold', 'Cancelled'];
const TAX_CONFIDENCE_OPTIONS = ['Actual', 'Estimated'];

const PREFIX = 'propertytax1';

export const PropertyTaxForm: React.FC<PropertyTaxFormProps> = ({
  values,
  onValueChange,
  disabled = false,
  propertyOptions = [],
}) => {
  const getValue = (field: string): string => values[`${PREFIX}.${field}`] || '';
  const getBoolValue = (field: string): boolean => values[`${PREFIX}.${field}`] === 'true';
  const handleChange = (field: string, value: string) => onValueChange(`${PREFIX}.${field}`, value);

  // Auto-derive 'delinquent' boolean from amount fields for downstream consumers.
  useEffect(() => {
    const parseAmt = (s: string) => {
      const n = parseFloat(String(s || '').replace(/[^0-9.\-]/g, ''));
      return isNaN(n) ? 0 : n;
    };
    const derived =
      parseAmt(values[`${PREFIX}.delinquent_amount`] || '') > 0 ||
      parseAmt(values[`${PREFIX}.bring_current_amount`] || '') > 0;
    const current = values[`${PREFIX}.delinquent`] === 'true';
    if (derived !== current) {
      onValueChange(`${PREFIX}.delinquent`, derived ? 'true' : 'false');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values[`${PREFIX}.delinquent_amount`], values[`${PREFIX}.bring_current_amount`]]);


  const [datePickerStates, setDatePickerStates] = useState<Record<string, boolean>>({});

  const safeParseDateStr = (val: string): Date | undefined => {
    if (!val) return undefined;
    try {
      const d = parse(val, 'yyyy-MM-dd', new Date());
      return isValid(d) ? d : undefined;
    } catch { return undefined; }
  };

  const renderDateField = (field: string, label: string) => {
    const val = getValue(field);
    return (
      <div className="flex items-center gap-3">
        <Label className="text-sm text-foreground whitespace-nowrap min-w-[110px]">{label}</Label>
        <Popover open={datePickerStates[field] || false} onOpenChange={(open) => setDatePickerStates(prev => ({ ...prev, [field]: open }))}>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn('h-7 text-sm flex-1 justify-start text-left font-normal', !val && 'text-muted-foreground')} disabled={disabled}>
              {val && safeParseDateStr(val) ? format(safeParseDateStr(val)!, 'MM/dd/yyyy') : 'MM/DD/YYYY'}
              <CalendarIcon className="ml-auto h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 z-[9999]" align="start">
            <EnhancedCalendar
              mode="single"
              selected={safeParseDateStr(val)}
              onSelect={(date) => { if (date) handleChange(field, format(date, 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, [field]: false })); }}
              onClear={() => { handleChange(field, ''); setDatePickerStates(prev => ({ ...prev, [field]: false })); }}
              onToday={() => { handleChange(field, format(new Date(), 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, [field]: false })); }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
    );
  };

  const renderCurrencyField = (field: string, label: string) => (
    <div className="flex items-center gap-3">
      <Label className="text-sm text-foreground whitespace-nowrap min-w-[110px]">{label}</Label>
      <div className="relative flex-1">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
        <Input
          value={getValue(field)}
          onChange={(e) => handleChange(field, e.target.value)}
          onKeyDown={numericKeyDown}
          onPaste={(e) => numericPaste(e, (v) => handleChange(field, v))}
          onFocus={(e) => { const v = unformatCurrencyDisplay(e.target.value); handleChange(field, v); }}
          onBlur={(e) => { const v = formatCurrencyDisplay(e.target.value); handleChange(field, v); }}
          disabled={disabled}
          className="h-7 text-sm flex-1 pl-5"
        />
      </div>
    </div>
  );

  const renderDropdownField = (field: string, label: string, options: string[]) => (
    <div className="flex items-center gap-3">
      <Label className="text-sm text-foreground whitespace-nowrap min-w-[110px]">{label}</Label>
      <Select value={getValue(field)} onValueChange={(value) => handleChange(field, value)} disabled={disabled}>
        <SelectTrigger className="h-7 text-sm flex-1 bg-background"><SelectValue placeholder="Select" /></SelectTrigger>
        <SelectContent className="bg-background z-50">
          {options.map((opt) => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="p-6">
      <div className="border-b border-border pb-2 mb-4">
        <span className="font-semibold text-base text-foreground">Property Tax</span>
      </div>

      <div className="w-full">
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          {/* Left column — Property Tax core */}
          <div className="space-y-3">
            {propertyOptions.length > 0 && (
              <DirtyFieldWrapper fieldKey={`${PREFIX}.property`}>
                {renderDropdownField('property', 'Property', propertyOptions)}
              </DirtyFieldWrapper>
            )}

            <DirtyFieldWrapper fieldKey={`${PREFIX}.source_of_information`}>
              <div className="flex items-center gap-3">
                <Label className="text-sm text-foreground whitespace-nowrap min-w-[110px]">Source of<br />Information</Label>
                <Select value={getValue('source_of_information')} onValueChange={(value) => handleChange('source_of_information', value)} disabled={disabled}>
                  <SelectTrigger className="h-7 text-sm flex-1 bg-background"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    {SOURCE_OPTIONS.map((opt) => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={`${PREFIX}.type`}>
              {renderDropdownField('type', 'Type', TYPE_OPTIONS)}
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={`${PREFIX}.authority`}>
              <div className="flex items-center gap-3">
                <Label className="text-sm text-foreground whitespace-nowrap min-w-[110px]">Tax Authority</Label>
                <div className="flex flex-1 gap-1.5">
                  <Input value={getValue('authority')} onChange={(e) => handleChange('authority', e.target.value)} disabled={disabled} className="h-7 text-sm flex-1" />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs whitespace-nowrap px-2 gap-1"
                    disabled={disabled}
                    onClick={() => { /* Search/Add placeholder */ }}
                  >
                    <Search className="h-3 w-3" />
                    Search / Add
                  </Button>
                </div>
              </div>
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={`${PREFIX}.pma_street`}>
              <div className="flex items-center gap-3">
                <Label className="text-sm text-foreground whitespace-nowrap min-w-[110px]">Street</Label>
                <Input value={getValue('pma_street')} onChange={(e) => handleChange('pma_street', e.target.value)} disabled={disabled} className="h-7 text-sm flex-1" />
              </div>
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={`${PREFIX}.pma_city`}>
              <div className="flex items-center gap-3">
                <Label className="text-sm text-foreground whitespace-nowrap min-w-[110px]">City</Label>
                <Input value={getValue('pma_city')} onChange={(e) => handleChange('pma_city', e.target.value)} disabled={disabled} className="h-7 text-sm flex-1" />
              </div>
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={`${PREFIX}.pma_state`}>
              <div className="flex items-center gap-3">
                <Label className="text-sm text-foreground whitespace-nowrap min-w-[110px]">State</Label>
                <Select value={getValue('pma_state')} onValueChange={(value) => handleChange('pma_state', value)} disabled={disabled}>
                  <SelectTrigger className="h-7 text-sm flex-1 bg-background"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent className="bg-background z-50 max-h-[200px]">
                    {STATE_OPTIONS.map((st) => (<SelectItem key={st} value={st}>{st}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={`${PREFIX}.pma_zip`}>
              <div className="flex items-center gap-3">
                <Label className="text-sm text-foreground whitespace-nowrap min-w-[110px]">ZIP</Label>
                <ZipInput value={getValue('pma_zip')} onValueChange={(v) => handleChange('pma_zip', v)} disabled={disabled} className="h-7 text-sm" />
              </div>
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={`${PREFIX}.annual_payment`}>
              {renderCurrencyField('annual_payment', 'Annual Payment')}
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={`${PREFIX}.tax_confidence`}>
              {renderDropdownField('tax_confidence', 'Confidence', TAX_CONFIDENCE_OPTIONS)}
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={`${PREFIX}.frequency`}>
              {renderDropdownField('frequency', 'Frequency', FREQUENCY_OPTIONS)}
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={`${PREFIX}.next_due`}>
              {renderDateField('next_due', 'Next Due')}
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={`${PREFIX}.delinquent_amount`}>
              <div className="flex items-center gap-3">
                <Label className="text-sm text-foreground whitespace-nowrap min-w-[110px] leading-tight">Delinquent<br />Amount</Label>
                <div className="relative flex-1">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                  <Input
                    value={getValue('delinquent_amount')}
                    onChange={(e) => handleChange('delinquent_amount', e.target.value)}
                    onKeyDown={numericKeyDown}
                    onPaste={(e) => numericPaste(e, (v) => handleChange('delinquent_amount', v))}
                    onFocus={(e) => { const v = unformatCurrencyDisplay(e.target.value); handleChange('delinquent_amount', v); }}
                    onBlur={(e) => { const v = formatCurrencyDisplay(e.target.value); handleChange('delinquent_amount', v); }}
                    disabled={disabled}
                    className="h-7 text-sm flex-1 pl-5"
                  />
                </div>
              </div>
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={`${PREFIX}.escrow_impounds`}>
              {renderDropdownField('escrow_impounds', 'Impounded', IMPOUNDED_OPTIONS)}
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={`${PREFIX}.pass_through`}>
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={getBoolValue('pass_through')}
                  onCheckedChange={(checked) => handleChange('pass_through', checked === true ? 'true' : 'false')}
                  disabled={disabled}
                />
                <Label className="text-sm text-foreground whitespace-nowrap">Pass Through</Label>
              </div>
            </DirtyFieldWrapper>
          </div>

          {/* Right column — Tax Tracking */}
          <div className="space-y-3">
            <div className="border-b border-border pb-1 mb-2">
              <span className="text-sm font-semibold text-foreground">Tax Tracking</span>
            </div>

            <DirtyFieldWrapper fieldKey={`${PREFIX}.active`}>
              <div className="flex items-center gap-3">
                <div className="min-w-[150px] flex items-center gap-3">
                  <Checkbox
                    checked={getBoolValue('active')}
                    onCheckedChange={(checked) => handleChange('active', checked === true ? 'true' : 'false')}
                    disabled={disabled}
                  />
                  <Label className="text-sm text-foreground whitespace-nowrap">Active</Label>
                </div>
              </div>
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={`${PREFIX}.last_verified`}>
              <div className="flex items-center gap-3">
                <Label className="text-sm text-foreground whitespace-nowrap min-w-[150px]">Last Verified</Label>
                <Popover open={datePickerStates['last_verified'] || false} onOpenChange={(open) => setDatePickerStates(prev => ({ ...prev, last_verified: open }))}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn('h-7 text-sm flex-1 justify-start text-left font-normal', !getValue('last_verified') && 'text-muted-foreground')} disabled={disabled}>
                      {getValue('last_verified') && safeParseDateStr(getValue('last_verified')) ? format(safeParseDateStr(getValue('last_verified'))!, 'MM/dd/yyyy') : 'MM/DD/YYYY'}
                      <CalendarIcon className="ml-auto h-3.5 w-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                    <EnhancedCalendar
                      mode="single"
                      selected={safeParseDateStr(getValue('last_verified'))}
                      onSelect={(date) => { if (date) handleChange('last_verified', format(date, 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, last_verified: false })); }}
                      onClear={() => { handleChange('last_verified', ''); setDatePickerStates(prev => ({ ...prev, last_verified: false })); }}
                      onToday={() => { handleChange('last_verified', format(new Date(), 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, last_verified: false })); }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={`${PREFIX}.current`}>
              <div className="flex items-center gap-3">
                <div className="min-w-[150px] flex items-center gap-3">
                  <Checkbox
                    checked={getBoolValue('current')}
                    onCheckedChange={(checked) => handleChange('current', checked === true ? 'true' : 'false')}
                    disabled={disabled}
                  />
                  <Label className="text-sm text-foreground whitespace-nowrap">Current</Label>
                </div>
              </div>
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={`${PREFIX}.delinquent`}>
              <div className="flex items-center gap-3">
                <div className="min-w-[150px] flex items-center gap-3">
                  <Checkbox
                    checked={getBoolValue('delinquent')}
                    onCheckedChange={(checked) => handleChange('delinquent', checked === true ? 'true' : 'false')}
                    disabled={disabled}
                  />
                  <Label className="text-sm text-foreground whitespace-nowrap">Delinquent</Label>
                </div>
                <div className="relative flex-1">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                  <Input
                    value={getValue('delinquent_amount')}
                    onChange={(e) => handleChange('delinquent_amount', e.target.value)}
                    onKeyDown={numericKeyDown}
                    onPaste={(e) => numericPaste(e, (v) => handleChange('delinquent_amount', v))}
                    onFocus={(e) => { const v = unformatCurrencyDisplay(e.target.value); handleChange('delinquent_amount', v); }}
                    onBlur={(e) => { const v = formatCurrencyDisplay(e.target.value); handleChange('delinquent_amount', v); }}
                    disabled={disabled}
                    className="h-7 text-sm pl-5"
                  />
                </div>
              </div>
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={`${PREFIX}.borrower_notified`}>
              <div className="flex items-center gap-3">
                <div className="min-w-[150px] flex items-center gap-3">
                  <Checkbox
                    checked={getBoolValue('borrower_notified')}
                    onCheckedChange={(checked) => handleChange('borrower_notified', checked === true ? 'true' : 'false')}
                    disabled={disabled}
                  />
                  <Label className="text-sm text-foreground whitespace-nowrap">Borrower Notified</Label>
                </div>
                <Popover open={datePickerStates['borrower_notified_date'] || false} onOpenChange={(open) => setDatePickerStates(prev => ({ ...prev, borrower_notified_date: open }))}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn('h-7 text-sm flex-1 justify-start text-left font-normal', !getValue('borrower_notified_date') && 'text-muted-foreground')} disabled={disabled}>
                      {getValue('borrower_notified_date') && safeParseDateStr(getValue('borrower_notified_date')) ? format(safeParseDateStr(getValue('borrower_notified_date'))!, 'MM/dd/yyyy') : 'MM/DD/YYYY'}
                      <CalendarIcon className="ml-auto h-3.5 w-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                    <EnhancedCalendar
                      mode="single"
                      selected={safeParseDateStr(getValue('borrower_notified_date'))}
                      onSelect={(date) => { if (date) handleChange('borrower_notified_date', format(date, 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, borrower_notified_date: false })); }}
                      onClear={() => { handleChange('borrower_notified_date', ''); setDatePickerStates(prev => ({ ...prev, borrower_notified_date: false })); }}
                      onToday={() => { handleChange('borrower_notified_date', format(new Date(), 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, borrower_notified_date: false })); }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={`${PREFIX}.lender_notified`}>
              <div className="flex items-center gap-3">
                <div className="min-w-[150px] flex items-center gap-3">
                  <Checkbox
                    checked={getBoolValue('lender_notified')}
                    onCheckedChange={(checked) => handleChange('lender_notified', checked === true ? 'true' : 'false')}
                    disabled={disabled}
                  />
                  <Label className="text-sm text-foreground whitespace-nowrap">Lender Notified</Label>
                </div>
                <Popover open={datePickerStates['lender_notified_date'] || false} onOpenChange={(open) => setDatePickerStates(prev => ({ ...prev, lender_notified_date: open }))}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn('h-7 text-sm flex-1 justify-start text-left font-normal', !getValue('lender_notified_date') && 'text-muted-foreground')} disabled={disabled}>
                      {getValue('lender_notified_date') && safeParseDateStr(getValue('lender_notified_date')) ? format(safeParseDateStr(getValue('lender_notified_date'))!, 'MM/dd/yyyy') : 'MM/DD/YYYY'}
                      <CalendarIcon className="ml-auto h-3.5 w-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                    <EnhancedCalendar
                      mode="single"
                      selected={safeParseDateStr(getValue('lender_notified_date'))}
                      onSelect={(date) => { if (date) handleChange('lender_notified_date', format(date, 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, lender_notified_date: false })); }}
                      onClear={() => { handleChange('lender_notified_date', ''); setDatePickerStates(prev => ({ ...prev, lender_notified_date: false })); }}
                      onToday={() => { handleChange('lender_notified_date', format(new Date(), 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, lender_notified_date: false })); }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </DirtyFieldWrapper>

            <DirtyFieldWrapper fieldKey={`${PREFIX}.memo`}>
              <div className="flex items-start gap-3">
                <Label className="text-sm text-foreground whitespace-nowrap min-w-[150px] pt-1">Memo</Label>
                <Textarea value={getValue('memo')} onChange={(e) => handleChange('memo', e.target.value)} disabled={disabled} className="text-sm flex-1 min-h-[80px]" />
              </div>
            </DirtyFieldWrapper>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PropertyTaxForm;
