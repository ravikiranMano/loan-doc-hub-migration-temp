import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { DirtyFieldWrapper } from './DirtyFieldWrapper';
import { numericKeyDown, numericPaste, formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';
import { PhoneInput } from '@/components/ui/phone-input';

interface PropertyLiensFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

const PRIORITY_OPTIONS = ['1st', '2nd', '3rd', '4th', '5th'];

import { PROPERTY_LIENS_KEYS } from '@/lib/fieldKeyMap';

// Use central field key map
const FIELD_KEYS = PROPERTY_LIENS_KEYS;

export const PropertyLiensForm: React.FC<PropertyLiensFormProps> = ({
  fields,
  values,
  onValueChange,
  showValidation = false,
  disabled = false,
}) => {
  const getFieldValue = (key: string) => values[key] || '';
  const [datePickerStates, setDatePickerStates] = useState<Record<string, boolean>>({});

  const safeParseDateStr = (val: string): Date | undefined => {
    if (!val) return undefined;
    try {
      const d = parse(val, 'yyyy-MM-dd', new Date());
      return isValid(d) ? d : undefined;
    } catch { return undefined; }
  };

  const renderDatePicker = (fieldKey: string, label: string) => (
    <div>
      <Label className="text-sm text-foreground">{label}</Label>
      <Popover open={datePickerStates[fieldKey] || false} onOpenChange={(open) => setDatePickerStates(prev => ({ ...prev, [fieldKey]: open }))}>
        <PopoverTrigger asChild>
          <Button variant="outline" className={cn('h-8 text-sm mt-1 w-full justify-start text-left font-normal', !getFieldValue(fieldKey) && 'text-muted-foreground')} disabled={disabled}>
            {getFieldValue(fieldKey) && safeParseDateStr(getFieldValue(fieldKey)) ? format(safeParseDateStr(getFieldValue(fieldKey))!, 'MM/dd/yyyy') : 'MM/DD/YYYY'}
            <CalendarIcon className="ml-auto h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 z-[9999]" align="start">
          <EnhancedCalendar
            mode="single"
            selected={safeParseDateStr(getFieldValue(fieldKey))}
            onSelect={(date) => { if (date) onValueChange(fieldKey, format(date, 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, [fieldKey]: false })); }}
            onClear={() => { onValueChange(fieldKey, ''); setDatePickerStates(prev => ({ ...prev, [fieldKey]: false })); }}
            onToday={() => { onValueChange(fieldKey, format(new Date(), 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, [fieldKey]: false })); }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Home className="h-5 w-5 text-primary" />
        <span className="font-semibold text-lg text-foreground">New Property Lien</span>
      </div>

      {/* Property Lien Information */}
      <div className="space-y-4 max-w-xl">
        <div className="border-b border-border pb-2">
          <span className="font-semibold text-sm text-primary">Property Lien Information</span>
        </div>

        <DirtyFieldWrapper fieldKey={FIELD_KEYS.property}>
          <div>
            <Label className="text-sm text-foreground">Property</Label>
            <Select value={getFieldValue(FIELD_KEYS.property)} onValueChange={(val) => onValueChange(FIELD_KEYS.property, val)} disabled={disabled}>
              <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent className="bg-background border border-border z-50">
                <SelectItem value="unassigned">Unassigned</SelectItem>
                <SelectItem value="primary">Primary Collateral</SelectItem>
                <SelectItem value="secondary">Secondary Property</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </DirtyFieldWrapper>

        <DirtyFieldWrapper fieldKey={FIELD_KEYS.priority}>
          <div>
            <Label className="text-sm text-foreground">Priority</Label>
            <Select value={getFieldValue(FIELD_KEYS.priority)} onValueChange={(val) => onValueChange(FIELD_KEYS.priority, val)} disabled={disabled}>
              <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent className="bg-background border border-border z-50">
                {PRIORITY_OPTIONS.map(opt => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
        </DirtyFieldWrapper>

        <DirtyFieldWrapper fieldKey={FIELD_KEYS.holder}>
          <div>
            <Label className="text-sm text-foreground">Lien Holder</Label>
            <Input value={getFieldValue(FIELD_KEYS.holder)} onChange={(e) => onValueChange(FIELD_KEYS.holder, e.target.value)} disabled={disabled} className="h-8 text-sm mt-1" />
          </div>
        </DirtyFieldWrapper>

        <DirtyFieldWrapper fieldKey={FIELD_KEYS.account}>
          <div>
            <Label className="text-sm text-foreground">Account</Label>
            <Input value={getFieldValue(FIELD_KEYS.account)} onChange={(e) => onValueChange(FIELD_KEYS.account, e.target.value)} disabled={disabled} className="h-8 text-sm mt-1" />
          </div>
        </DirtyFieldWrapper>

        <DirtyFieldWrapper fieldKey={FIELD_KEYS.contact}>
          <div>
            <Label className="text-sm text-foreground">Contact</Label>
            <Input value={getFieldValue(FIELD_KEYS.contact)} onChange={(e) => onValueChange(FIELD_KEYS.contact, e.target.value)} disabled={disabled} className="h-8 text-sm mt-1" />
          </div>
        </DirtyFieldWrapper>

        <DirtyFieldWrapper fieldKey={FIELD_KEYS.phone}>
          <div>
            <Label className="text-sm text-foreground">Phone</Label>
            <PhoneInput value={getFieldValue(FIELD_KEYS.phone)} onValueChange={(val) => onValueChange(FIELD_KEYS.phone, val)} disabled={disabled} className="h-8 text-sm mt-1" />
          </div>
        </DirtyFieldWrapper>

        <DirtyFieldWrapper fieldKey={FIELD_KEYS.originalBalance}>
          <div>
            <Label className="text-sm text-foreground">Original Balance</Label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
              <Input value={getFieldValue(FIELD_KEYS.originalBalance)} onChange={(e) => onValueChange(FIELD_KEYS.originalBalance, unformatCurrencyDisplay(e.target.value))} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (val) => onValueChange(FIELD_KEYS.originalBalance, val))} onBlur={() => { const raw = getFieldValue(FIELD_KEYS.originalBalance); if (raw) onValueChange(FIELD_KEYS.originalBalance, formatCurrencyDisplay(raw)); }} onFocus={() => { const raw = getFieldValue(FIELD_KEYS.originalBalance); if (raw) onValueChange(FIELD_KEYS.originalBalance, unformatCurrencyDisplay(raw)); }} disabled={disabled} className="h-8 text-sm pl-7" inputMode="decimal" placeholder="0.00" />
            </div>
          </div>
        </DirtyFieldWrapper>

        <DirtyFieldWrapper fieldKey={FIELD_KEYS.currentBalance}>
          <div>
            <Label className="text-sm text-foreground">Current Balance</Label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
              <Input value={getFieldValue(FIELD_KEYS.currentBalance)} onChange={(e) => onValueChange(FIELD_KEYS.currentBalance, unformatCurrencyDisplay(e.target.value))} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (val) => onValueChange(FIELD_KEYS.currentBalance, val))} onBlur={() => { const raw = getFieldValue(FIELD_KEYS.currentBalance); if (raw) onValueChange(FIELD_KEYS.currentBalance, formatCurrencyDisplay(raw)); }} onFocus={() => { const raw = getFieldValue(FIELD_KEYS.currentBalance); if (raw) onValueChange(FIELD_KEYS.currentBalance, unformatCurrencyDisplay(raw)); }} disabled={disabled} className="h-8 text-sm pl-7" inputMode="decimal" placeholder="0.00" />
            </div>
          </div>
        </DirtyFieldWrapper>

        <DirtyFieldWrapper fieldKey={FIELD_KEYS.regularPayment}>
          <div>
            <Label className="text-sm text-foreground">Regular Payment</Label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
              <Input value={getFieldValue(FIELD_KEYS.regularPayment)} onChange={(e) => onValueChange(FIELD_KEYS.regularPayment, unformatCurrencyDisplay(e.target.value))} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (val) => onValueChange(FIELD_KEYS.regularPayment, val))} onBlur={() => { const raw = getFieldValue(FIELD_KEYS.regularPayment); if (raw) onValueChange(FIELD_KEYS.regularPayment, formatCurrencyDisplay(raw)); }} onFocus={() => { const raw = getFieldValue(FIELD_KEYS.regularPayment); if (raw) onValueChange(FIELD_KEYS.regularPayment, unformatCurrencyDisplay(raw)); }} disabled={disabled} className="h-8 text-sm pl-7" inputMode="decimal" placeholder="0.00" />
            </div>
          </div>
        </DirtyFieldWrapper>

        <DirtyFieldWrapper fieldKey={FIELD_KEYS.lastChecked}>
          {renderDatePicker(FIELD_KEYS.lastChecked, 'Last Checked')}
        </DirtyFieldWrapper>

      </div>

    </div>
  );
};

export default PropertyLiensForm;
