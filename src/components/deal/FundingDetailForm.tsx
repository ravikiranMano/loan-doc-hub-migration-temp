import React, { useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { numericKeyDown, numericPaste, formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';
import { roundPctForStorage, roundDollarForStorage, formatPercentDisplay } from '@/lib/precisionFormat';

/** Strip commas/$ before parseFloat so formatted values parse correctly */
const safeParseFloat = (v: string | undefined): number => {
  if (!v) return 0;
  return parseFloat((v || '').replace(/[$,]/g, '')) || 0;
};
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { Button } from '@/components/ui/button';
import { CalendarIcon } from 'lucide-react';
import { formatDateOnly, parseDateOnly } from '@/lib/dateOnly';
import { cn } from '@/lib/utils';
import type { FundingFormData } from './AddFundingModal';
import { LenderIdSearch } from './LenderIdSearch';
import { OverrideConfirmationDialog } from './OverrideConfirmationDialog';

interface FundingDetailFormProps {
  data: FundingFormData;
  onChange: (data: FundingFormData) => void;
  totalPayment?: string;
  loanAmount?: string;
  /** Sum of funding amounts across sibling records (excluding this row). When
   *  provided, Pro Rata is computed as fundingAmount / (siblingTotal + fundingAmount). */
  siblingFundingTotal?: number;
}

export const FundingDetailForm: React.FC<FundingDetailFormProps> = ({
  data,
  onChange,
  totalPayment = '',
  loanAmount = '',
  siblingFundingTotal,
}) => {
  const [fundingDateOpen, setFundingDateOpen] = useState(false);
  const [interestFromOpen, setInterestFromOpen] = useState(false);
  const [focusedRateField, setFocusedRateField] = useState<null | 'lender' | 'override'>(null);
  const [overrideConfirmOpen, setOverrideConfirmOpen] = useState(false);
  const [fundingDate, setFundingDate] = useState<Date | undefined>(
    parseDateOnly(data.fundingDate)
  );
  const [interestFromDate, setInterestFromDate] = useState<Date | undefined>(
    parseDateOnly(data.interestFrom)
  );

  const handleChange = useCallback((field: keyof FundingFormData, value: string | boolean) => {
    onChange({ ...data, [field]: value });
  }, [data, onChange]);

  const handleFundingDateChange = useCallback((date: Date | undefined) => {
    setFundingDate(date);
    setFundingDateOpen(false);
    onChange({ ...data, fundingDate: formatDateOnly(date) });
  }, [data, onChange]);

  const handleInterestFromDateChange = useCallback((date: Date | undefined) => {
    setInterestFromDate(date);
    setInterestFromOpen(false);
    onChange({ ...data, interestFrom: formatDateOnly(date) });
  }, [data, onChange]);

  // Auto-compute Percent Owned = Funding Amount / Total Funded * 100. Total
  // Funded = sum of all lender funding amounts. Falls back to loan amount only
  // when sibling totals aren't supplied (preserves legacy behavior).
  React.useEffect(() => {
    const fa = safeParseFloat(data.fundingAmount);
    const denom = typeof siblingFundingTotal === 'number'
      ? (siblingFundingTotal + fa)
      : safeParseFloat(loanAmount);
    if (denom > 0 && fa > 0) {
      const computed = roundPctForStorage(fa / denom * 100);
      if (computed !== data.percentOwned) {
        onChange({ ...data, percentOwned: computed });
      }
    }
  }, [data.fundingAmount, loanAmount, siblingFundingTotal]);

  // Regular Payment (per-lender share) = (Percent Owned / 100) × Borrower Regular P&I.
  // Rates are NOT used here — they drive interest accrual only.
  React.useEffect(() => {
    const pct = parseFloat((data.percentOwned || '').replace(/[%,]/g, '')) || 0;
    const regPI = parseFloat((totalPayment || '').replace(/[$,]/g, '')) || 0;
    const payment = pct > 0 && regPI > 0
      ? roundDollarForStorage(pct / 100 * regPI)
      : '';
    if (payment !== data.regularPayment) {
      onChange({ ...data, regularPayment: payment });
    }
  }, [data.percentOwned, totalPayment]);

  const percentOwnedNum = parseFloat(data.percentOwned) || 0;
  const percentOwnedError = percentOwnedNum > 100;


  return (
    <div className="p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
        <div className="flex items-center gap-3">
          <Label className="text-sm text-muted-foreground min-w-[110px] text-left shrink-0">Loan Account</Label>
          <Input value={data.loan} onChange={(e) => handleChange('loan', e.target.value)} className="h-7 text-sm" />
        </div>
        <div className="flex items-start gap-3">
          <Label className="text-sm text-muted-foreground min-w-[110px] text-left shrink-0 mt-1">Borrower</Label>
          <textarea
            value={data.borrower}
            onChange={(e) => handleChange('borrower', e.target.value)}
            className="flex w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm resize-none min-h-[48px]"
            rows={2}
          />
        </div>
        <div className="flex items-center gap-3">
          <Label className="text-sm text-muted-foreground min-w-[110px] text-left shrink-0">Lender ID</Label>
          <LenderIdSearch
            value={data.lenderId}
            onChange={(lenderId, lenderFullName) => {
              onChange({
                ...data,
                lenderId,
                ...(lenderFullName ? { lenderFullName } : {}),
              });
            }}
          />
        </div>
        <div className="flex items-center gap-3">
          <Label className="text-sm text-muted-foreground min-w-[110px] text-left shrink-0">Funding Amount</Label>
          <div className="relative flex-1">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
            <Input
              type="text"
              inputMode="decimal"
              value={data.fundingAmount}
              onChange={(e) => { const v = unformatCurrencyDisplay(e.target.value).replace(/[^0-9.]/g, ''); handleChange('fundingAmount', v); }}
              onKeyDown={numericKeyDown}
              onPaste={(e) => numericPaste(e, (val) => handleChange('fundingAmount', val))}
              onBlur={() => { if (data.fundingAmount) handleChange('fundingAmount', formatCurrencyDisplay(data.fundingAmount)); }}
              onFocus={() => { if (data.fundingAmount) handleChange('fundingAmount', unformatCurrencyDisplay(data.fundingAmount)); }}
              placeholder="0.00"
              className="h-7 text-sm pl-6"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Label className="text-sm text-muted-foreground min-w-[110px] text-left shrink-0">Lender Name</Label>
          <Input value={data.lenderFullName} readOnly disabled className="h-7 text-sm bg-muted" />
        </div>
        <div className="flex items-center gap-3">
          <Label className="text-sm text-muted-foreground min-w-[110px] text-left shrink-0">Funding Date</Label>
          <div className="flex-1">
            <TypableDateField
              value={fundingDate ? formatDateOnly(fundingDate) : ''}
              onChange={(iso) => handleFundingDateChange(iso ? parseDateOnly(iso) : undefined)}
              inputClassName="h-7 text-sm"
              ariaLabel="Funding Date"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Label className="text-sm text-muted-foreground min-w-[110px] text-left shrink-0">Interest From</Label>
          <div className="flex-1">
            <TypableDateField
              value={interestFromDate ? formatDateOnly(interestFromDate) : ''}
              onChange={(iso) => handleInterestFromDateChange(iso ? parseDateOnly(iso) : undefined)}
              inputClassName="h-7 text-sm"
              ariaLabel="Interest From"
            />
          </div>
        </div>

      </div>

      {/* Rate Selection - hidden from UI, kept for calculation logic */}
      <div className="hidden">
        <RadioGroup value={data.rateSelection || 'note_rate'} onValueChange={(val) => handleChange('rateSelection', val)}>
          <RadioGroupItem value="note_rate" id="detail-rate-note" />
          <RadioGroupItem value="sold_rate" id="detail-rate-sold" />
          <RadioGroupItem value="lender_rate" id="detail-rate-lender" />
        </RadioGroup>
      </div>

      <div className="flex items-center gap-6 flex-wrap mt-1">
        <div className="flex items-center gap-2">
          <Label className={cn("text-sm shrink-0", percentOwnedError ? "text-destructive font-medium" : "text-muted-foreground")}>Percent Owned</Label>
          <div className="relative w-28">
            <Input type="text" inputMode="decimal" value={formatPercentDisplay(data.percentOwned || '', 4)} disabled className={cn("h-7 text-sm pr-6 opacity-50 bg-muted", percentOwnedError && "border-destructive")} placeholder="0.00" />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">%</span>
          </div>
        </div>
        {percentOwnedError && (
          <span className="text-xs text-destructive font-medium">Percent Owned cannot exceed 100%</span>
        )}
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground shrink-0">Regular Payment</Label>
          <div className="relative w-28">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
            <Input type="text" inputMode="decimal" value={formatCurrencyDisplay(data.regularPayment || '')} disabled className="h-7 text-sm pl-6 opacity-50 bg-muted" placeholder="0.00" />
          </div>
        </div>
      </div>

      {/* Lender Rate resolution rules:
          - Sold Rate NOT checked (rateSoldValue empty) → Lender Rate = Note Rate
          - Sold Rate checked (rateSoldValue present)   → Lender Rate = Sold Rate
          - Override enabled                            → Lender Rate = User Input (overrideVal)
          The main Lender Rate input is read-only when a linked source (Sold/Note) is providing
          the value, and becomes editable via the Override sub-field. */}
      {(() => {
        const soldRateVal = (data.rateSoldValue || '').trim();
        const noteRateVal = (data.rateNoteValue || '').trim();
        const isOn = !!data.lenderRateOverride;
        const overrideVal = data.lenderRateOverrideValue || '';
        // Source rate priority: Sold Rate when configured (>0), else Note Rate.
        // Empty / null / 0 / non-numeric Sold Rate falls back to Note Rate so
        // Lender Rate never remains blank when only Note Rate is set.
        const soldRateNum = parseFloat(soldRateVal.replace(/[%,]/g, ''));
        const noteRateNum = parseFloat(noteRateVal.replace(/[%,]/g, ''));
        const hasSold = Number.isFinite(soldRateNum) && soldRateNum > 0;
        const hasNote = Number.isFinite(noteRateNum) && noteRateNum > 0;
        const linkedRate = hasSold ? soldRateVal : (hasNote ? noteRateVal : '');
        const hasLinkedRate = hasSold || hasNote;
        // When override is on, the displayed Lender Rate reflects user input.
        const displayRate = isOn
          ? (overrideVal || data.lenderRate || linkedRate || '')
          : (hasLinkedRate ? linkedRate : (data.lenderRate || ''));
        const lenderRateDisabled = hasLinkedRate || isOn;
        return (
          <div className="flex items-center gap-6 flex-wrap mt-1">
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground shrink-0 min-w-[110px]">Lender Rate</Label>
              <div className="relative w-28">
                <Input
                  type="text"
                  inputMode="decimal"
                  value={focusedRateField === 'lender' ? displayRate : (formatPercentDisplay(displayRate || '', 3) || '')}
                  onFocus={() => setFocusedRateField('lender')}
                  onChange={(e) => {
                    let v = e.target.value.replace(/[^0-9.]/g, '');
                    const parts = v.split('.');
                    if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
                    const [intPart, decPart] = v.split('.');
                    if (decPart && decPart.length > 4) v = `${intPart}.${decPart.slice(0, 4)}`;
                    onChange({ ...data, lenderRate: v, rateLenderValue: v });
                  }}
                  onBlur={(e) => {
                    setFocusedRateField(null);
                    const raw = (e.target.value || '').replace(/[^0-9.]/g, '');
                    if (!raw) return;
                    const stored = roundPctForStorage(raw);
                    if (stored && stored !== data.lenderRate) {
                      onChange({ ...data, lenderRate: stored, rateLenderValue: stored });
                    }
                  }}
                  disabled={lenderRateDisabled}
                  className={cn('h-7 text-sm pr-6', lenderRateDisabled && 'opacity-50 bg-muted')}
                  placeholder="%"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">%</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground shrink-0 min-w-[110px]">Override</Label>
              <Checkbox
                checked={isOn}
                onCheckedChange={(checked) => {
                  const on = !!checked;
                  if (on) {
                    // Defer until user confirms in custom modal
                    setOverrideConfirmOpen(true);
                    return;
                  }
                  // Rule 4 audit metadata: snapshot on enable, clear on disable (Test 14 revert).
                  const calculatedSource = data.lenderRate || soldRateVal || '';
                  onChange({
                    ...data,
                    lenderRateOverride: false,
                    lenderRateOverrideValue: '',
                    lenderRateOverrideOriginal: '',
                    lenderRateOverrideAt: '',
                    lenderRateOverrideBy: '',
                    lenderRateOverrideReason: '',
                  });
                  void calculatedSource;
                }}
                className="h-3.5 w-3.5"
              />

              <div className="relative w-28">
                <Input
                  type="text"
                  inputMode="decimal"
                  value={focusedRateField === 'override' ? overrideVal : (formatPercentDisplay(overrideVal || '', 3) || '')}
                  onFocus={() => setFocusedRateField('override')}
                  onChange={(e) => {
                    let v = e.target.value.replace(/[^0-9.]/g, '');
                    const parts = v.split('.');
                    if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
                    const [intPart, decPart] = v.split('.');
                    if (decPart && decPart.length > 4) v = `${intPart}.${decPart.slice(0, 4)}`;
                    onChange({ ...data, lenderRateOverrideValue: v, rateLenderValue: v });
                  }}
                  onBlur={(e) => {
                    setFocusedRateField(null);
                    const raw = (e.target.value || '').replace(/[^0-9.]/g, '');
                    if (!raw) return;
                    const stored = roundPctForStorage(raw);
                    if (stored && stored !== overrideVal) {
                      onChange({ ...data, lenderRateOverrideValue: stored, rateLenderValue: stored });
                    }
                  }}
                  disabled={!isOn}
                  className={cn('h-7 text-sm pr-6', !isOn && 'opacity-50 bg-muted')}
                  placeholder="%"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">%</span>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="flex items-center gap-2">
        <Checkbox id="detail-brokerParticipates" checked={data.brokerParticipates} onCheckedChange={(checked) => handleChange('brokerParticipates', !!checked)} />
        <Label htmlFor="detail-brokerParticipates" className="text-sm font-medium leading-tight cursor-pointer">Lender is: The Broker, Employee or Family of Broker</Label>
      </div>

      <OverrideConfirmationDialog
        open={overrideConfirmOpen}
        onCancel={() => setOverrideConfirmOpen(false)}
        onConfirm={() => {
          const soldRateVal = (data.rateSoldValue || '').trim();
          const calculatedSource = data.lenderRate || soldRateVal || '';
          onChange({
            ...data,
            lenderRateOverride: true,
            lenderRateOverrideValue:
              data.lenderRateOverrideValue || data.lenderRate || soldRateVal,
            lenderRateOverrideOriginal:
              data.lenderRateOverrideOriginal || calculatedSource,
            lenderRateOverrideAt:
              data.lenderRateOverrideAt || new Date().toISOString(),
            lenderRateOverrideBy: data.lenderRateOverrideBy || '',
            lenderRateOverrideReason: data.lenderRateOverrideReason || '',
          });
          setOverrideConfirmOpen(false);
        }}
      />
    </div>
  );
};

export default FundingDetailForm;
