import React from 'react';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import { EmailInput } from '@/components/ui/email-input';
import { ZipInput } from '@/components/ui/zip-input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { CalendarIcon } from 'lucide-react';
import { format, parse } from 'date-fns';
import { cn } from '@/lib/utils';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';
import { US_STATES } from '@/lib/usStates';
import { numericKeyDown, numericPaste, formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';
import type { CalculationResult } from '@/lib/calculationEngine';

interface OriginationPropertyFormProps {
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

const FK = {
  purchase_price: 'origination_prop.purchase_price',
  down_payment: 'origination_prop.down_payment',
  delinquent_taxes: 'origination_prop.delinquent_taxes',
  appraiser_street: 'origination_prop.appraiser.street',
  appraiser_city: 'origination_prop.appraiser.city',
  appraiser_state: 'origination_prop.appraiser.state',
  appraiser_zip: 'origination_prop.appraiser.zip',
  appraiser_phone: 'origination_prop.appraiser.phone',
  appraiser_email: 'origination_prop.appraiser.email',
  year_built: 'origination_prop.year_built',
  square_feet: 'origination_prop.square_feet',
  construction_type: 'origination_prop.construction_type',
  monthly_income: 'origination_prop.monthly_income',
  lien_protective_equity: 'origination_prop.lien_protective_equity',
  source_lien_info: 'origination_prop.source_lien_info',
  delinquencies_60day: 'origination_prop.delinquencies_60day',
  delinquencies_how_many: 'origination_prop.delinquencies_how_many',
  currently_delinquent: 'origination_prop.currently_delinquent',
  paid_by_loan: 'origination_prop.paid_by_loan',
  source_of_payment: 'origination_prop.source_of_payment',
  recording_number: 'origination_prop.recording_number',
};

const CONSTRUCTION_TYPES = ['Wood/Stucco', 'Stick', 'Concrete Block'];
const LIEN_SOURCES = ['Broker', 'Borrower', 'Other'];

export const OriginationPropertyForm: React.FC<OriginationPropertyFormProps> = ({
  values,
  onValueChange,
  disabled = false,
}) => {
  const [yearBuiltOpen, setYearBuiltOpen] = React.useState(false);
  const v = (key: string) => values[key] || '';
  const sv = (key: string, val: string) => onValueChange(key, val);
  const bv = (key: string) => values[key] === 'true';
  const sbv = (key: string, val: boolean) => onValueChange(key, String(val));

  const parseDate = (val: string): Date | undefined => {
    if (!val) return undefined;
    try { return parse(val, 'yyyy-MM-dd', new Date()); } catch { return undefined; }
  };

  const renderTextField = (label: string, key: string) => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center gap-2">
        <Label className="w-[180px] text-sm shrink-0">{label}</Label>
        <Input value={v(key)} onChange={(e) => sv(key, e.target.value)} disabled={disabled} className="h-7 text-sm" />
      </div>
    </DirtyFieldWrapper>
  );

  const renderCurrencyField = (label: string, key: string) => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center gap-2">
        <Label className="w-[180px] text-sm shrink-0">{label}</Label>
        <div className="relative flex-1">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
          <Input type="text" inputMode="decimal" value={v(key)}
            onChange={(e) => sv(key, unformatCurrencyDisplay(e.target.value))}
            onKeyDown={numericKeyDown}
            onPaste={(e) => numericPaste(e, (val) => sv(key, val))}
            onBlur={() => { const raw = v(key); if (raw) sv(key, formatCurrencyDisplay(raw)); }}
            onFocus={() => { const raw = v(key); if (raw) sv(key, unformatCurrencyDisplay(raw)); }}
            disabled={disabled} placeholder="0.00" className="h-7 text-sm pl-6 text-right" />
        </div>
      </div>
    </DirtyFieldWrapper>
  );

  const renderCheckboxField = (label: string, key: string) => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center gap-2">
        <Label className="w-[180px] text-sm shrink-0">{label}</Label>
        <Checkbox checked={bv(key)} onCheckedChange={(c) => sbv(key, !!c)} disabled={disabled} />
      </div>
    </DirtyFieldWrapper>
  );

  return (
    <div className="p-4 space-y-2 max-w-xl">
      {renderCurrencyField('Purchase Price', FK.purchase_price)}
      {renderCurrencyField('Down Payment', FK.down_payment)}
      {renderCurrencyField('Delinquent Taxes', FK.delinquent_taxes)}

      <p className="text-sm italic text-foreground pt-3 pb-1">Appraiser Contact</p>
      {renderTextField('Street', FK.appraiser_street)}
      {renderTextField('City', FK.appraiser_city)}
      <DirtyFieldWrapper fieldKey={FK.appraiser_state}>
        <div className="flex items-center gap-2">
          <Label className="w-[180px] text-sm shrink-0">State</Label>
          <Select value={v(FK.appraiser_state)} onValueChange={(val) => sv(FK.appraiser_state, (val === '__select__' ? '' : val))} disabled={disabled}>
            <SelectTrigger className="h-7 text-sm flex-1">
              <SelectValue placeholder="Select state" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__select__">Select</SelectItem>
                  {US_STATES.map(s => (
                <SelectItem key={s} value={s} className="text-sm">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </DirtyFieldWrapper>
      <DirtyFieldWrapper fieldKey={FK.appraiser_zip}>
        <div className="flex items-center gap-2">
          <Label className="w-[180px] text-sm shrink-0">ZIP</Label>
          <ZipInput value={v(FK.appraiser_zip)} onValueChange={(val) => sv(FK.appraiser_zip, val)} disabled={disabled} className="h-7 text-sm" />
        </div>
      </DirtyFieldWrapper>
      <DirtyFieldWrapper fieldKey={FK.appraiser_phone}>
        <div className="flex items-center gap-2">
          <Label className="w-[180px] text-sm shrink-0">Phone</Label>
          <PhoneInput value={v(FK.appraiser_phone)} onValueChange={(val) => sv(FK.appraiser_phone, val)} disabled={disabled} className="h-7 text-sm" />
        </div>
      </DirtyFieldWrapper>
      <DirtyFieldWrapper fieldKey={FK.appraiser_email}>
        <div className="flex items-center gap-2">
          <Label className="w-[180px] text-sm shrink-0">Email</Label>
          <EmailInput value={v(FK.appraiser_email)} onValueChange={(val) => sv(FK.appraiser_email, val)} disabled={disabled} className="h-7 text-sm" />
        </div>
      </DirtyFieldWrapper>

      <div className="pt-4" />

      <DirtyFieldWrapper fieldKey={FK.year_built}>
        <div className="flex items-center gap-2">
          <Label className="w-[180px] text-sm shrink-0">Year Built</Label>
          <Popover open={yearBuiltOpen} onOpenChange={setYearBuiltOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn('h-7 w-full justify-start text-left font-normal text-sm', !v(FK.year_built) && 'text-muted-foreground')} disabled={disabled}>
                {v(FK.year_built) ? format(parseDate(v(FK.year_built))!, 'MM/dd/yyyy') : 'MM/DD/YYYY'}
                <CalendarIcon className="ml-auto h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 z-[9999]" align="start">
              <EnhancedCalendar mode="single" selected={parseDate(v(FK.year_built))}
                onSelect={(date) => { if (date) sv(FK.year_built, format(date, 'yyyy-MM-dd')); setYearBuiltOpen(false); }}
                onClear={() => { sv(FK.year_built, ''); setYearBuiltOpen(false); }}
                onToday={() => { sv(FK.year_built, format(new Date(), 'yyyy-MM-dd')); setYearBuiltOpen(false); }}
                initialFocus />
            </PopoverContent>
          </Popover>
        </div>
      </DirtyFieldWrapper>

      {renderTextField('Square Feet', FK.square_feet)}

      <DirtyFieldWrapper fieldKey={FK.construction_type}>
        <div className="flex items-center gap-2">
          <Label className="w-[180px] text-sm shrink-0">Type of Construction</Label>
          <Select value={v(FK.construction_type)} onValueChange={(val) => sv(FK.construction_type, val)} disabled={disabled}>
            <SelectTrigger className="h-7 text-sm">
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent className="bg-popover z-50">
              {CONSTRUCTION_TYPES.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </DirtyFieldWrapper>

      {renderCurrencyField('Generates Monthly Income', FK.monthly_income)}
      {renderCurrencyField('Lien (Protective Equity)', FK.lien_protective_equity)}

      <DirtyFieldWrapper fieldKey={FK.source_lien_info}>
        <div className="flex items-center gap-2">
          <Label className="w-[180px] text-sm shrink-0">Source of Lien Information</Label>
          <Select value={v(FK.source_lien_info)} onValueChange={(val) => sv(FK.source_lien_info, val)} disabled={disabled}>
            <SelectTrigger className="h-7 text-sm">
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent className="bg-popover z-50">
              {LIEN_SOURCES.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </DirtyFieldWrapper>

      <p className="text-sm text-foreground font-medium pt-3 pb-1">During Previous 12 Months</p>
      {renderCheckboxField('60-day + Delinquencies', FK.delinquencies_60day)}
      {renderTextField('How Many', FK.delinquencies_how_many)}
      {renderCheckboxField('Currently Delinquent', FK.currently_delinquent)}
      {renderCheckboxField('Will be Paid by this Loan', FK.paid_by_loan)}
      {renderTextField('If No, List Source of Payment', FK.source_of_payment)}
      {renderTextField('Recording number', FK.recording_number)}
    </div>
  );
};

export default OriginationPropertyForm;
