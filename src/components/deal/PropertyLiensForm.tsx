import React, { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
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
import { DirtyFieldWrapper } from './DirtyFieldWrapper';
import { numericKeyDown, numericPaste, formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';
import { sanitizeInterestInput, normalizeInterestOnBlur } from '@/lib/interestValidation';
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

const FIELD_KEYS = PROPERTY_LIENS_KEYS;

// Appraised value key — same key used by PropertyDetailsForm
const APPRAISED_VALUE_KEY = 'property1.appraised_value';

function parseNum(raw: string | undefined): number {
  if (!raw) return NaN;
  const n = parseFloat(String(raw).replace(/[$,%\s,]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

export const PropertyLiensForm: React.FC<PropertyLiensFormProps> = ({
  fields: _fields,
  values,
  onValueChange,
  showValidation: _showValidation,
  disabled = false,
}) => {
  const getFieldValue = (key: string) => values[key] || '';
  const [datePickerStates, setDatePickerStates] = useState<Record<string, boolean>>({});

  // Track last auto-computed Regular Payment so user manual overrides are respected.
  const lastAutoPaymentRef = useRef<string>('');

  // ─── Auto-calculations ───────────────────────────────────────────────────
  useEffect(() => {
    const cur = parseNum(getFieldValue(FIELD_KEYS.currentBalance));
    const rate = parseNum(getFieldValue(FIELD_KEYS.interestRate));
    const appraised = parseNum(values[APPRAISED_VALUE_KEY]);
    const isPayoff = getFieldValue(FIELD_KEYS.existingPayoff) === 'true';

    // 1. Remaining Balance (Balance After Closing)
    //    payoff = true  → always $0.00
    //    payoff = false → always mirrors current_balance (lien will remain as-is)
    //    This keeps sumExistingLiensTotal() accurate for CLTV/ProtectiveEquity.
    if (isPayoff) {
      const stored = getFieldValue(FIELD_KEYS.newRemainingBalance).replace(/[$,]/g, '');
      if (stored !== '0.00' && stored !== '0') {
        onValueChange(FIELD_KEYS.newRemainingBalance, '0.00');
      }
    } else if (Number.isFinite(cur) && cur >= 0) {
      const expected = cur.toFixed(2);
      const stored = getFieldValue(FIELD_KEYS.newRemainingBalance).replace(/[$,]/g, '');
      if (stored !== expected) {
        onValueChange(FIELD_KEYS.newRemainingBalance, expected);
      }
    }

    // 2. Regular Payment (interest-only monthly estimate)
    //    Formula: current_balance × (annual_rate / 100) / 12
    //    Written only when the stored value still matches the last auto-computed value
    //    (i.e. user has not manually overridden it). Cleared when inputs are missing.
    if (Number.isFinite(cur) && cur > 0 && Number.isFinite(rate) && rate > 0) {
      const autoPayment = (cur * (rate / 100) / 12).toFixed(2);
      const storedRaw = getFieldValue(FIELD_KEYS.regularPayment).replace(/[$,]/g, '');
      if (!storedRaw || storedRaw === lastAutoPaymentRef.current) {
        if (storedRaw !== autoPayment) onValueChange(FIELD_KEYS.regularPayment, autoPayment);
        lastAutoPaymentRef.current = autoPayment;
      }
    }

    // 3. Lien Protective Equity = Appraised Value − Current Balance
    if (Number.isFinite(appraised) && appraised > 0 && Number.isFinite(cur)) {
      const equity = (appraised - cur).toFixed(2);
      const stored = getFieldValue(FIELD_KEYS.lienEquity).replace(/[$,]/g, '');
      if (stored !== equity) {
        onValueChange(FIELD_KEYS.lienEquity, equity);
      }
    }

    // 4. Lien LTV = Current Balance / Appraised Value × 100 (4 dp)
    if (Number.isFinite(appraised) && appraised > 0 && Number.isFinite(cur) && cur >= 0) {
      const ltv = ((cur / appraised) * 100).toFixed(4);
      if (getFieldValue(FIELD_KEYS.lienLtv) !== ltv) {
        onValueChange(FIELD_KEYS.lienLtv, ltv);
      }
    }

    // 5. Monthly Interest = Current Balance × (Annual Rate / 100 / 12)
    //    Separate read-only display from Regular Payment — always overwritten.
    if (Number.isFinite(cur) && cur > 0 && Number.isFinite(rate) && rate > 0) {
      const monthlyInt = (cur * (rate / 100) / 12).toFixed(2);
      if (getFieldValue(FIELD_KEYS.monthlyInterest) !== monthlyInt) {
        onValueChange(FIELD_KEYS.monthlyInterest, monthlyInt);
      }
    }
  }, [
    values[FIELD_KEYS.currentBalance],
    values[FIELD_KEYS.interestRate],
    values[FIELD_KEYS.existingPayoff],
    values[APPRAISED_VALUE_KEY],
  ]);

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

  const isPayoff = getFieldValue(FIELD_KEYS.existingPayoff) === 'true';

  // Derived display values for read-only auto-calc fields
  const lienLtvRaw = parseNum(getFieldValue(FIELD_KEYS.lienLtv));
  const lienEquityRaw = parseNum(getFieldValue(FIELD_KEYS.lienEquity));
  const monthlyIntRaw = parseNum(getFieldValue(FIELD_KEYS.monthlyInterest));

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

        {/* Interest Rate — needed for monthly interest auto-calc */}
        <DirtyFieldWrapper fieldKey={FIELD_KEYS.interestRate}>
          <div>
            <Label className="text-sm text-foreground">Interest Rate</Label>
            <div className="relative mt-1">
              <Input
                value={getFieldValue(FIELD_KEYS.interestRate)}
                onChange={(e) => onValueChange(FIELD_KEYS.interestRate, sanitizeInterestInput(e.target.value))}
                onBlur={() => {
                  const v = normalizeInterestOnBlur(getFieldValue(FIELD_KEYS.interestRate), 3);
                  if (v !== getFieldValue(FIELD_KEYS.interestRate)) onValueChange(FIELD_KEYS.interestRate, v);
                }}
                disabled={disabled}
                className="h-8 text-sm pr-7"
                inputMode="decimal"
                placeholder="0.000"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">%</span>
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

        {/* Payoff at Closing — drives new_remaining_balance to 0 and corrects CLTV */}
        <DirtyFieldWrapper fieldKey={FIELD_KEYS.existingPayoff}>
          <div className="flex items-center gap-2 mt-1">
            <Checkbox
              id="lien-existing-payoff"
              checked={isPayoff}
              onCheckedChange={(checked) => onValueChange(FIELD_KEYS.existingPayoff, checked ? 'true' : 'false')}
              disabled={disabled}
            />
            <Label htmlFor="lien-existing-payoff" className="text-sm text-foreground cursor-pointer">
              Will Be Paid Off at Closing
            </Label>
          </div>
        </DirtyFieldWrapper>

        {/* New Remaining Balance — auto-zeroed on payoff, editable otherwise */}
        <DirtyFieldWrapper fieldKey={FIELD_KEYS.newRemainingBalance}>
          <div>
            <Label className="text-sm text-foreground">
              Balance After Closing
              {isPayoff && <span className="ml-2 text-xs text-muted-foreground">(auto-set to $0.00 — payoff)</span>}
            </Label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
              <Input
                value={isPayoff ? '0.00' : getFieldValue(FIELD_KEYS.newRemainingBalance)}
                onChange={(e) => {
                  if (!isPayoff) onValueChange(FIELD_KEYS.newRemainingBalance, unformatCurrencyDisplay(e.target.value));
                }}
                onKeyDown={isPayoff ? undefined : numericKeyDown}
                onPaste={isPayoff ? undefined : (e) => numericPaste(e, (val) => onValueChange(FIELD_KEYS.newRemainingBalance, val))}
                onBlur={() => {
                  if (!isPayoff) {
                    const raw = getFieldValue(FIELD_KEYS.newRemainingBalance);
                    if (raw) onValueChange(FIELD_KEYS.newRemainingBalance, formatCurrencyDisplay(raw));
                  }
                }}
                onFocus={() => {
                  if (!isPayoff) {
                    const raw = getFieldValue(FIELD_KEYS.newRemainingBalance);
                    if (raw) onValueChange(FIELD_KEYS.newRemainingBalance, unformatCurrencyDisplay(raw));
                  }
                }}
                disabled={disabled || isPayoff}
                readOnly={isPayoff}
                className={cn('h-8 text-sm pl-7', isPayoff && 'bg-muted/50 text-muted-foreground cursor-not-allowed')}
                inputMode="decimal"
                placeholder="0.00"
              />
            </div>
          </div>
        </DirtyFieldWrapper>

        <DirtyFieldWrapper fieldKey={FIELD_KEYS.lastChecked}>
          {renderDatePicker(FIELD_KEYS.lastChecked, 'Last Checked')}
        </DirtyFieldWrapper>
      </div>

      {/* Auto-Calculated Summary */}
      <div className="space-y-3 max-w-xl">
        <div className="border-b border-border pb-2">
          <span className="font-semibold text-sm text-primary">Auto-Calculated</span>
        </div>

        {/* Lien LTV */}
        <div className="flex items-center justify-between gap-4">
          <Label className="text-sm text-muted-foreground">Lien LTV</Label>
          <div className="relative w-36">
            <Input
              value={Number.isFinite(lienLtvRaw) ? lienLtvRaw.toFixed(2) : ''}
              readOnly
              disabled
              className="h-8 text-sm text-right pr-7 bg-muted/50"
              placeholder="—"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">%</span>
          </div>
        </div>

        {/* Lien Protective Equity */}
        <div className="flex items-center justify-between gap-4">
          <Label className="text-sm text-muted-foreground">Lien Protective Equity</Label>
          <div className="relative w-36">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
            <Input
              value={Number.isFinite(lienEquityRaw) ? formatCurrencyDisplay(lienEquityRaw.toFixed(2)) : ''}
              readOnly
              disabled
              className="h-8 text-sm text-right pl-7 bg-muted/50"
              placeholder="—"
            />
          </div>
        </div>

        {/* Monthly Interest */}
        <div className="flex items-center justify-between gap-4">
          <Label className="text-sm text-muted-foreground">Monthly Interest on Lien</Label>
          <div className="relative w-36">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
            <Input
              value={Number.isFinite(monthlyIntRaw) ? formatCurrencyDisplay(monthlyIntRaw.toFixed(2)) : ''}
              readOnly
              disabled
              className="h-8 text-sm text-right pl-7 bg-muted/50"
              placeholder="—"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default PropertyLiensForm;
