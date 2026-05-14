import React, { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Home, CalendarIcon } from 'lucide-react';
import { sanitizeInterestInput, normalizeInterestOnBlur } from '@/lib/interestValidation';
import { numericKeyDown, numericPaste, formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';
import { PhoneInput } from '@/components/ui/phone-input';
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
import type { LienData } from './LiensTableView';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';

interface LienDetailFormProps {
  lien: LienData;
  onChange: (field: keyof LienData, value: string) => void;
  disabled?: boolean;
  propertyOptions?: { id: string; label: string }[];
  loanValues?: Record<string, string>;
}

const SOURCE_OF_INFORMATION_OPTIONS = ['Borrower', 'Broker', 'Lender', 'Title / Prelim', 'Public Record'];
const LOAN_TYPE_DROPDOWN_OPTIONS = ['Conventional', 'Private Lender', 'Judgement', 'Other'];
const CONDITION_DROPDOWN_OPTIONS = ['Anticipated', 'Existing - Payoff', 'Remain - Paydown', 'Will Remain'];

const getThisLoanAutofillValues = (loanValues: Record<string, string>) => ({
  account: loanValues['Terms.LoanNumber'] || loanValues['loan_terms.loan_number'] || '',
  balanceAfter: loanValues['loan_terms.loan_amount'] || '',
  regularPayment: loanValues['loan_terms.regular_payment'] || '',
});

const DIRTY_KEY_MAP: Record<string, string> = {
  property: 'lien1.property',
  priority: 'lien1.priority',
  holder: 'lien1.holder',
  account: 'lien1.account',
  contact: 'lien1.contact',
  phone: 'lien1.phone',
  fax: 'lien1.fax',
  email: 'lien1.email',
  loanType: 'lien1.loan_type',
  loanTypeDropdown: 'lien1.loan_type_dropdown',
  anticipated: 'lien1.anticipated',
  anticipatedAmount: 'lien1.anticipated_amount',
  existingRemain: 'lien1.existing_remain',
  existingPaydown: 'lien1.existing_paydown',
  existingPayoff: 'lien1.existing_payoff',
  existingPaydownAmount: 'lien1.existing_paydown_amount',
  existingPayoffAmount: 'lien1.existing_payoff_amount',
  lienPriorityNow: 'lien1.lien_priority_now',
  lienPriorityAfter: 'lien1.lien_priority_after',
  remainingNewLienPriority: 'lien1.remaining_new_lien_priority',
  newRemainingBalance: 'lien1.new_remaining_balance',
  interestRate: 'lien1.interest_rate',
  maturityDate: 'lien1.maturity_date',
  originalBalance: 'lien1.original_balance',
  balanceAfter: 'lien1.balance_after',
  currentBalance: 'lien1.current_balance',
  regularPayment: 'lien1.regular_payment',
  balloon: 'lien1.balloon',
  balloonAmount: 'lien1.balloon_amount',
  recordingNumber: 'lien1.recording_number',
  recordingNumberFlag: 'lien1.recording_number_flag',
  recordingDate: 'lien1.recording_date',
  seniorLienTracking: 'lien1.senior_lien_tracking',
  sltActive: 'lien1.slt_active',
  lastVerified: 'lien1.last_verified',
  lastChecked: 'lien1.last_checked',
  sltCurrent: 'lien1.slt_current',
  sltDelinquent: 'lien1.slt_delinquent',
  sltDelinquentDays: 'lien1.slt_delinquent_days',
  sltUnderModification: 'lien1.slt_under_modification',
  sltForeclosure: 'lien1.slt_foreclosure',
  sltForeclosureDate: 'lien1.slt_foreclosure_date',
  sltPaidOff: 'lien1.slt_paid_off',
  sltLastPaymentMade: 'lien1.slt_last_payment_made',
  sltNextPaymentDue: 'lien1.slt_next_payment_due',
  sltCurrentBalance: 'lien1.slt_current_balance',
  sltRequestSubmitted: 'lien1.slt_request_submitted',
  sltResponseReceived: 'lien1.slt_response_received',
  sltUnableToVerify: 'lien1.slt_unable_to_verify',
  sltLenderNotified: 'lien1.slt_lender_notified',
  sltLenderNotifiedDate: 'lien1.slt_lender_notified_date',
  sltBorrowerNotified: 'lien1.slt_borrower_notified',
  sltBorrowerNotifiedDate: 'lien1.slt_borrower_notified_date',
  note: 'lien1.note',
  thisLoan: 'lien1.this_loan',
  estimate: 'lien1.estimate',
  status: 'lien1.status',
  delinquencies60day: 'lien1.delinquencies_60day',
  delinquenciesHowMany: 'lien1.delinquencies_how_many',
  currentlyDelinquent: 'lien1.currently_delinquent',
  currentlyDelinquentAmount: 'lien1.currently_delinquent_amount',
  paidByLoan: 'lien1.paid_by_loan',
  sourceOfPayment: 'lien1.source_of_payment',
  sourceOfInformation: 'lien1.source_of_information',
};

export const LienDetailForm: React.FC<LienDetailFormProps> = ({
  lien,
  onChange,
  disabled = false,
  propertyOptions = [],
  loanValues = {},
}) => {
  const isThisLoan = lien.thisLoan === 'true';
  const [datePickerStates, setDatePickerStates] = useState<Record<string, boolean>>({});

  const safeParseDateStr = (val: string): Date | undefined => {
    if (!val) return undefined;
    try {
      const d = parse(val, 'yyyy-MM-dd', new Date());
      return isValid(d) ? d : undefined;
    } catch { return undefined; }
  };

  const handleThisLoanChange = (checked: boolean) => {
    onChange('thisLoan', checked ? 'true' : 'false');
    if (checked) {
      const { account, balanceAfter, regularPayment } = getThisLoanAutofillValues(loanValues);
      onChange('account', account);
      onChange('balanceAfter', balanceAfter);
      onChange('regularPayment', regularPayment);
    }
  };

  // Sync Anticipated dropdown -> thisLoan flag for backwards-compat tagging.
  useEffect(() => {
    const wantThisLoan = lien.anticipated === 'This Loan';
    if (wantThisLoan && lien.thisLoan !== 'true') onChange('thisLoan', 'true');
    if (!wantThisLoan && lien.anticipated === 'Other' && lien.thisLoan === 'true') {
      onChange('thisLoan', 'false');
    }
  }, [lien.anticipated, lien.thisLoan, onChange]);

  useEffect(() => {
    if (!isThisLoan) return;
    const { account, balanceAfter, regularPayment } = getThisLoanAutofillValues(loanValues);
    if (lien.account !== account) onChange('account', account);
    if (lien.balanceAfter !== balanceAfter) onChange('balanceAfter', balanceAfter);
    if (lien.regularPayment !== regularPayment) onChange('regularPayment', regularPayment);
  }, [isThisLoan, loanValues, lien.account, lien.balanceAfter, lien.regularPayment, onChange]);

  // Recompute Remaining Balance when Current Balance / Paydown changes,
  // honoring the active Existing selection.
  useEffect(() => {
    const cur = parseFloat(unformatCurrencyDisplay(lien.currentBalance || '')) || 0;
    if (lien.existingPayoff === 'true') {
      const expected = '0.00';
      if (lien.newRemainingBalance !== expected) onChange('newRemainingBalance', expected);
    } else if (lien.existingRemain === 'true') {
      const expected = cur ? cur.toFixed(2) : '';
      if (unformatCurrencyDisplay(lien.newRemainingBalance || '') !== unformatCurrencyDisplay(expected)) {
        onChange('newRemainingBalance', expected);
      }
    } else if (lien.existingPaydown === 'true') {
      const pdRaw = unformatCurrencyDisplay(lien.existingPaydownAmount || '');
      const pd = parseFloat(pdRaw) || 0;
      // Clamp paydown to current balance.
      if (pd > cur && cur > 0) {
        onChange('existingPaydownAmount', cur.toFixed(2));
        return;
      }
      const remain = Math.max(0, cur - pd);
      const expected = remain ? remain.toFixed(2) : '';
      if (unformatCurrencyDisplay(lien.newRemainingBalance || '') !== unformatCurrencyDisplay(expected)) {
        onChange('newRemainingBalance', expected);
      }
    }
  }, [lien.currentBalance, lien.existingPaydownAmount, lien.existingPayoff, lien.existingPaydown, lien.existingRemain, lien.newRemainingBalance, onChange]);

  const renderField = (field: keyof LienData, label: string, props: Record<string, any> = {}, forceDisabled = false) => {
    if (props.type === 'date') {
      const val = lien[field] || '';
      return (
        <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP[field] || `lien1.${field}`}>
          <div className="flex items-center gap-3">
            <Label className="text-sm text-muted-foreground min-w-[140px] text-left shrink-0">{label}</Label>
            <Popover open={datePickerStates[field] || false} onOpenChange={(open) => setDatePickerStates(prev => ({ ...prev, [field]: open }))}>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn('h-7 text-sm flex-1 justify-start text-left font-normal', !val && 'text-muted-foreground', forceDisabled && 'opacity-50 cursor-not-allowed')} disabled={disabled || forceDisabled}>
                  {val && safeParseDateStr(val) ? format(safeParseDateStr(val)!, 'MM/dd/yyyy') : 'MM/DD/YYYY'}
                  <CalendarIcon className="ml-auto h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                <EnhancedCalendar mode="single" selected={safeParseDateStr(val)} onSelect={(date) => { if (date) onChange(field, format(date, 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, [field]: false })); }} onClear={() => { onChange(field, ''); setDatePickerStates(prev => ({ ...prev, [field]: false })); }} onToday={() => { onChange(field, format(new Date(), 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, [field]: false })); }} initialFocus />
              </PopoverContent>
            </Popover>
          </div>
        </DirtyFieldWrapper>
      );
    }
    return (
      <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP[field] || `lien1.${field}`}>
        <div className="flex items-center gap-3">
          <Label className="text-sm text-muted-foreground min-w-[140px] text-left shrink-0">{label}</Label>
          <Input value={lien[field]} onChange={(e) => onChange(field, e.target.value)} disabled={disabled || forceDisabled} className={`h-7 text-sm flex-1 ${forceDisabled ? 'opacity-50 bg-muted cursor-not-allowed' : ''}`} {...props} />
        </div>
      </DirtyFieldWrapper>
    );
  };

  const renderCurrency = (field: keyof LienData, label: string, forceDisabled = false) => (
    <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP[field] || `lien1.${field}`}>
      <div className="flex items-center gap-3">
        <Label className="text-sm text-muted-foreground min-w-[140px] text-left shrink-0">{label}</Label>
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
          <Input value={lien[field]} onChange={(e) => onChange(field, unformatCurrencyDisplay(e.target.value))} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (val) => onChange(field, val))} onBlur={() => { const raw = lien[field]; if (raw) onChange(field, formatCurrencyDisplay(raw)); }} onFocus={() => { const raw = lien[field]; if (raw) onChange(field, unformatCurrencyDisplay(raw)); }} disabled={disabled || forceDisabled} className={`h-7 text-sm pl-7 ${forceDisabled ? 'opacity-50 bg-muted cursor-not-allowed' : ''}`} inputMode="decimal" placeholder="0.00" />
        </div>
      </div>
    </DirtyFieldWrapper>
  );

  const renderCheckbox = (field: keyof LienData, label: string, forceDisabled = false) => (
    <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP[field] || `lien1.${field}`}>
      <div className="flex items-center gap-2">
        <Checkbox id={field} checked={lien[field] === 'true'} onCheckedChange={(checked) => onChange(field, checked ? 'true' : 'false')} disabled={disabled || forceDisabled} />
        <Label htmlFor={field} className="text-sm text-foreground">{label}</Label>
      </div>
    </DirtyFieldWrapper>
  );

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center gap-2">
        <Home className="h-5 w-5 text-primary" />
        <span className="font-semibold text-lg text-foreground">Lien Details</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-6 gap-y-0">
        <div className="space-y-3">
          <div className="border-b border-border pb-2">
            <span className="font-semibold text-sm text-primary">Lien Details</span>
          </div>

          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.thisLoan}>
            <div className="flex items-center gap-2">
              <Checkbox
                id="thisLoan"
                checked={lien.thisLoan === 'true'}
                onCheckedChange={(checked) => handleThisLoanChange(!!checked)}
                disabled={disabled}
              />
              <Label htmlFor="thisLoan" className="text-sm text-foreground">This Loan</Label>
            </div>
          </DirtyFieldWrapper>


          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.sourceOfInformation}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[140px] text-left shrink-0">Source of Information</Label>
              <Select value={lien.sourceOfInformation || undefined} onValueChange={(val) => onChange('sourceOfInformation', val)} disabled={disabled}>
                <SelectTrigger className="h-7 text-sm flex-1"><SelectValue placeholder="Select source" /></SelectTrigger>
                <SelectContent className="bg-background border border-border z-[9999]">
                  {SOURCE_OF_INFORMATION_OPTIONS.map(opt => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.property}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[140px] text-left shrink-0">Related Property</Label>
              <Select value={lien.property || 'unassigned'} onValueChange={(val) => onChange('property', val)} disabled={disabled}>
                <SelectTrigger className="h-7 text-sm flex-1"><SelectValue placeholder="Select property" /></SelectTrigger>
                <SelectContent className="bg-background border border-border z-[9999]">
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {propertyOptions.map(opt => (
                    <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.loanTypeDropdown}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[140px] text-left shrink-0">Loan Type</Label>
              <Select value={lien.loanTypeDropdown || undefined} onValueChange={(val) => onChange('loanTypeDropdown', val)} disabled={disabled || isThisLoan}>
                <SelectTrigger className={`h-7 text-sm flex-1 ${isThisLoan ? 'opacity-50 bg-muted cursor-not-allowed' : ''}`}><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent className="bg-background border border-border z-[9999]">
                  {LOAN_TYPE_DROPDOWN_OPTIONS.map(opt => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey="lien1.condition">
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[140px] text-left shrink-0">Condition</Label>
              <Select
                value={
                  lien.anticipated === 'true' || lien.anticipated === 'Anticipated' ? 'Anticipated' :
                  lien.existingPayoff === 'true' ? 'Existing - Payoff' :
                  lien.existingPaydown === 'true' ? 'Remain - Paydown' :
                  lien.existingRemain === 'true' ? 'Will Remain' : undefined
                }
                onValueChange={(val) => {
                  onChange('anticipated', val === 'Anticipated' ? 'true' : 'false');
                  onChange('existingPayoff', val === 'Existing - Payoff' ? 'true' : 'false');
                  onChange('existingPaydown', val === 'Remain - Paydown' ? 'true' : 'false');
                  onChange('existingRemain', val === 'Will Remain' ? 'true' : 'false');
                  // Auto-calc Remaining Balance based on selection
                  const cur = parseFloat(unformatCurrencyDisplay(lien.currentBalance || '')) || 0;
                  if (val === 'Existing - Payoff') {
                    onChange('newRemainingBalance', '0.00');
                    onChange('existingPaydownAmount', '');
                  } else if (val === 'Will Remain') {
                    onChange('newRemainingBalance', cur ? cur.toFixed(2) : '');
                    onChange('existingPaydownAmount', '');
                  } else if (val === 'Remain - Paydown') {
                    const pd = parseFloat(unformatCurrencyDisplay(lien.existingPaydownAmount || '')) || 0;
                    const remain = Math.max(0, cur - pd);
                    onChange('newRemainingBalance', remain ? remain.toFixed(2) : '');
                  }
                }}
                disabled={disabled}
              >
                <SelectTrigger className="h-7 text-sm flex-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="bg-background border border-border z-[9999]">
                  {CONDITION_DROPDOWN_OPTIONS.map(opt => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          {renderField('holder', 'Lien Holder Name', {}, isThisLoan)}
          {renderField('account', 'Account Number', {}, isThisLoan)}

          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.phone}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[140px] text-left shrink-0">Phone</Label>
              <PhoneInput value={lien.phone} onValueChange={(val) => onChange('phone', val)} disabled={disabled || isThisLoan} className={`h-7 text-sm flex-1 ${isThisLoan ? 'opacity-50 bg-muted cursor-not-allowed' : ''}`} />
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.fax}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[140px] text-left shrink-0">Fax</Label>
              <PhoneInput value={lien.fax} onValueChange={(val) => onChange('fax', val)} disabled={disabled || isThisLoan} className={`h-7 text-sm flex-1 ${isThisLoan ? 'opacity-50 bg-muted cursor-not-allowed' : ''}`} />
            </div>
          </DirtyFieldWrapper>

          {renderField('recordingDate', 'Recording Date', { type: 'date' })}
          {renderField('recordingNumber', 'Recording Number')}
          {renderField('maturityDate', 'Maturity Date', { type: 'date' }, isThisLoan)}

          <div className="flex items-center gap-3">
            {renderCheckbox('balloon', 'Balloon')}
          </div>
          {lien.balloon === 'true' && renderCurrency('balloonAmount', 'Amount of Balloon')}
        </div>

        <div className="space-y-3">
          <div className="border-b border-border pb-2">
            <span className="font-semibold text-sm text-primary">&nbsp;</span>
          </div>

          {renderField('lienPriorityNow', 'Lien Priority Now', { placeholder: 'e.g. 1st' })}
          {renderField('lienPriorityAfter', 'Lien Priority After', { placeholder: 'auto', readOnly: true }, true)}

          {renderCurrency('originalBalance', 'Original Balance', isThisLoan)}
          {renderCurrency('currentBalance', 'Current Balance')}

          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.anticipatedAmount}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[140px] text-left shrink-0 leading-tight">Anticipated Balance<br />(if new lien)</Label>
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                <Input value={lien.newRemainingBalance} onChange={(e) => onChange('newRemainingBalance', unformatCurrencyDisplay(e.target.value))} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (val) => onChange('newRemainingBalance', val))} onBlur={() => { const raw = lien.newRemainingBalance; if (raw) onChange('newRemainingBalance', formatCurrencyDisplay(raw)); }} onFocus={() => { const raw = lien.newRemainingBalance; if (raw) onChange('newRemainingBalance', unformatCurrencyDisplay(raw)); }} disabled={disabled} className="h-7 text-sm pl-7" inputMode="decimal" placeholder="0.00" />
              </div>
            </div>
          </DirtyFieldWrapper>

          {renderCurrency('existingPaydownAmount', 'Paydown Amount', lien.existingPaydown !== 'true')}

          {renderCurrency('existingPayoffAmount', 'Remaining Balance')}

          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.interestRate}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[140px] text-left shrink-0">Interest Rate</Label>
              <div className="relative flex-1">
                <Input value={lien.interestRate} onChange={(e) => onChange('interestRate', sanitizeInterestInput(e.target.value))} onBlur={() => { const v = normalizeInterestOnBlur(lien.interestRate, 3); if (v !== lien.interestRate) onChange('interestRate', v); }} disabled={disabled || isThisLoan} className={`h-7 text-sm text-right pr-6 ${isThisLoan ? 'opacity-50 bg-muted cursor-not-allowed' : ''}`} inputMode="decimal" placeholder="0.00" />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">%</span>
              </div>
            </div>
          </DirtyFieldWrapper>

          {renderCurrency('regularPayment', 'Regular Payment', isThisLoan)}

          {renderCurrency('currentlyDelinquentAmount', 'If Delinquent')}

          {renderCheckbox('paidByLoan', 'Will Be Paid By This Loan')}

          {renderField('sourceOfPayment', 'If No, Provide Source')}

          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.delinquenciesHowMany || 'lien1.delinquenciesHowMany'}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[140px] max-w-[140px] text-left shrink-0 leading-tight">Times 60-days Delinquent<br />(12 &lt; Months)</Label>
              <Input value={lien.delinquenciesHowMany} onChange={(e) => onChange('delinquenciesHowMany', e.target.value)} disabled={disabled} className="h-7 text-sm flex-1" />
            </div>
          </DirtyFieldWrapper>
        </div>
        <div className="space-y-3">
          <div className="border-b border-border pb-2 flex items-center justify-between gap-3">
            <span className="font-semibold text-sm text-primary">Senior Lien Tracking</span>
            {renderCheckbox('sltActive', 'Active')}
          </div>

          {renderField('lastVerified', 'Last Verified', { type: 'date' })}

          <div className="flex items-center gap-3">
            <Label className="text-sm font-semibold text-foreground min-w-[140px] text-left shrink-0">Status</Label>
          </div>

          {renderCheckbox('sltCurrent', 'Current')}

          <div className="flex items-center gap-3">
            <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.sltDelinquent}>
              <div className="flex items-center gap-2 min-w-[140px] shrink-0">
                <Checkbox id="sltDelinquent" checked={lien.sltDelinquent === 'true'} onCheckedChange={(checked) => onChange('sltDelinquent', checked ? 'true' : 'false')} disabled={disabled} />
                <Label htmlFor="sltDelinquent" className="text-sm text-foreground">Delinquent</Label>
              </div>
            </DirtyFieldWrapper>
            {lien.sltDelinquent === 'true' && (
              <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.sltDelinquentDays} className="flex-1">
                <Input value={lien.sltDelinquentDays} onChange={(e) => onChange('sltDelinquentDays', e.target.value)} disabled={disabled} className="h-7 text-sm w-full" placeholder="# of Days" />
              </DirtyFieldWrapper>
            )}
          </div>

          <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.sltUnderModification}>
            <div className="flex items-center gap-2">
              <Checkbox id="sltUnderModification" checked={lien.sltUnderModification === 'true'} onCheckedChange={(checked) => onChange('sltUnderModification', checked ? 'true' : 'false')} disabled={disabled} />
              <Label htmlFor="sltUnderModification" className="text-sm text-foreground whitespace-nowrap">Under Modification / FB Plan</Label>
            </div>
          </DirtyFieldWrapper>

          <div className="flex items-center gap-3">
            <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.sltForeclosure}>
              <div className="flex items-center gap-2 min-w-[140px] shrink-0">
                <Checkbox id="sltForeclosure" checked={lien.sltForeclosure === 'true'} onCheckedChange={(checked) => onChange('sltForeclosure', checked ? 'true' : 'false')} disabled={disabled} />
                <Label htmlFor="sltForeclosure" className="text-sm text-foreground">Foreclosure</Label>
              </div>
            </DirtyFieldWrapper>
            {lien.sltForeclosure === 'true' && (
              <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.sltForeclosureDate} className="flex-1">
                <Popover open={datePickerStates['sltForeclosureDate'] || false} onOpenChange={(open) => setDatePickerStates(prev => ({ ...prev, sltForeclosureDate: open }))}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn('h-7 text-sm w-full justify-start text-left font-normal', !lien.sltForeclosureDate && 'text-muted-foreground')} disabled={disabled}>
                      {lien.sltForeclosureDate && safeParseDateStr(lien.sltForeclosureDate) ? format(safeParseDateStr(lien.sltForeclosureDate)!, 'MM/dd/yyyy') : 'MM/DD/YYYY'}
                      <CalendarIcon className="ml-auto h-3.5 w-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                    <EnhancedCalendar mode="single" selected={safeParseDateStr(lien.sltForeclosureDate)} onSelect={(date) => { if (date) onChange('sltForeclosureDate', format(date, 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, sltForeclosureDate: false })); }} onClear={() => { onChange('sltForeclosureDate', ''); setDatePickerStates(prev => ({ ...prev, sltForeclosureDate: false })); }} onToday={() => { onChange('sltForeclosureDate', format(new Date(), 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, sltForeclosureDate: false })); }} initialFocus />
                  </PopoverContent>
                </Popover>
              </DirtyFieldWrapper>
            )}
          </div>

          {renderCheckbox('sltPaidOff', 'Paid Off')}

          {renderField('sltLastPaymentMade', 'Last Payment Made', { type: 'date' })}
          {renderField('sltNextPaymentDue', 'Next Payment Due', { type: 'date' })}
          {renderCurrency('sltCurrentBalance', 'Current Balance')}

          {renderCheckbox('sltUnableToVerify', 'Unable to Verify')}

          {renderField('sltRequestSubmitted', 'Request Submitted', { type: 'date' })}
          {renderField('sltResponseReceived', 'Response Received', { type: 'date' })}

          <div className="flex items-center gap-3">
            <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.sltBorrowerNotified}>
              <div className="flex items-center gap-2 min-w-[140px]">
                <Checkbox id="sltBorrowerNotified" checked={lien.sltBorrowerNotified === 'true'} onCheckedChange={(checked) => onChange('sltBorrowerNotified', checked ? 'true' : 'false')} disabled={disabled} />
                <Label htmlFor="sltBorrowerNotified" className="text-sm text-foreground">Borrower Notified</Label>
              </div>
            </DirtyFieldWrapper>
            <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.sltBorrowerNotifiedDate} className="flex-1">
              <Popover open={datePickerStates['sltBorrowerNotifiedDate'] || false} onOpenChange={(open) => setDatePickerStates(prev => ({ ...prev, sltBorrowerNotifiedDate: open }))}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('h-7 text-sm w-full justify-start text-left font-normal', !lien.sltBorrowerNotifiedDate && 'text-muted-foreground', lien.sltBorrowerNotified !== 'true' && 'opacity-50 cursor-not-allowed')} disabled={disabled || lien.sltBorrowerNotified !== 'true'}>
                    {lien.sltBorrowerNotifiedDate && safeParseDateStr(lien.sltBorrowerNotifiedDate) ? format(safeParseDateStr(lien.sltBorrowerNotifiedDate)!, 'MM/dd/yyyy') : 'Date'}
                    <CalendarIcon className="ml-auto h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                  <EnhancedCalendar mode="single" selected={safeParseDateStr(lien.sltBorrowerNotifiedDate)} onSelect={(date) => { if (date) onChange('sltBorrowerNotifiedDate', format(date, 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, sltBorrowerNotifiedDate: false })); }} onClear={() => { onChange('sltBorrowerNotifiedDate', ''); setDatePickerStates(prev => ({ ...prev, sltBorrowerNotifiedDate: false })); }} onToday={() => { onChange('sltBorrowerNotifiedDate', format(new Date(), 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, sltBorrowerNotifiedDate: false })); }} initialFocus />
                </PopoverContent>
              </Popover>
            </DirtyFieldWrapper>
          </div>

          <div className="flex items-center gap-3">
            <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.sltLenderNotified}>
              <div className="flex items-center gap-2 min-w-[140px]">
                <Checkbox id="sltLenderNotified" checked={lien.sltLenderNotified === 'true'} onCheckedChange={(checked) => onChange('sltLenderNotified', checked ? 'true' : 'false')} disabled={disabled} />
                <Label htmlFor="sltLenderNotified" className="text-sm text-foreground">Lender Notified</Label>
              </div>
            </DirtyFieldWrapper>
            <DirtyFieldWrapper fieldKey={DIRTY_KEY_MAP.sltLenderNotifiedDate} className="flex-1">
              <Popover open={datePickerStates['sltLenderNotifiedDate'] || false} onOpenChange={(open) => setDatePickerStates(prev => ({ ...prev, sltLenderNotifiedDate: open }))}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('h-7 text-sm w-full justify-start text-left font-normal', !lien.sltLenderNotifiedDate && 'text-muted-foreground', lien.sltLenderNotified !== 'true' && 'opacity-50 cursor-not-allowed')} disabled={disabled || lien.sltLenderNotified !== 'true'}>
                    {lien.sltLenderNotifiedDate && safeParseDateStr(lien.sltLenderNotifiedDate) ? format(safeParseDateStr(lien.sltLenderNotifiedDate)!, 'MM/dd/yyyy') : 'Date'}
                    <CalendarIcon className="ml-auto h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                  <EnhancedCalendar mode="single" selected={safeParseDateStr(lien.sltLenderNotifiedDate)} onSelect={(date) => { if (date) onChange('sltLenderNotifiedDate', format(date, 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, sltLenderNotifiedDate: false })); }} onClear={() => { onChange('sltLenderNotifiedDate', ''); setDatePickerStates(prev => ({ ...prev, sltLenderNotifiedDate: false })); }} onToday={() => { onChange('sltLenderNotifiedDate', format(new Date(), 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, sltLenderNotifiedDate: false })); }} initialFocus />
                </PopoverContent>
              </Popover>
            </DirtyFieldWrapper>
          </div>
        </div>
      </div>

    </div>
  );
};

export default LienDetailForm;
