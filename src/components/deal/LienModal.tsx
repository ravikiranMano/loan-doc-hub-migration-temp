import React, { useState, useEffect, useCallback } from 'react';
import { Home, CalendarIcon } from 'lucide-react';
import { numericKeyDown, numericPaste, formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';
import { PhoneInput } from '@/components/ui/phone-input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmailInput } from '@/components/ui/email-input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { format, parse, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import { ModalSaveConfirmation } from './ModalSaveConfirmation';
import { hasModalFormData, hasValidEmails } from '@/lib/modalFormValidation';
import type { LienData } from './LiensTableView';
import { LienDetailForm } from './LienDetailForm';
import { sanitizeInterestInput, normalizeInterestOnBlur } from '@/lib/interestValidation';

interface LienModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lien: LienData | null;
  onSave: (lien: LienData) => Promise<boolean> | boolean | void;
  isEdit: boolean;
  propertyOptions?: { id: string; label: string }[];
  loanValues?: Record<string, string>;
  currentPropertyId?: string;
}

const LOAN_TYPE_OPTIONS = ['Conventional', 'Private Lender', 'Judgement', 'Other'];
const STATUS_OPTIONS = ['Current', 'Unable to Verify', '30-90', '90+', 'Foreclosure', 'Modification', 'Paid'];
const SOURCE_OF_INFORMATION_OPTIONS = ['Borrower', 'Broker', 'Lender', 'Title / Prelim', 'Public Record'];

const getThisLoanAutofillValues = (loanValues: Record<string, string>) => ({
  account: loanValues['Terms.LoanNumber'] || loanValues['loan_terms.loan_number'] || '',
  balanceAfter: loanValues['loan_terms.loan_amount'] || '',
  regularPayment: loanValues['loan_terms.regular_payment'] || '',
});

const getDefaultLien = (): LienData => ({
  id: '', property: '', priority: '1st', holder: '', account: '', contact: '', phone: '', fax: '', email: '',
  loanType: '', loanTypeDropdown: '', anticipated: 'false', anticipatedAmount: '', existingRemain: 'false', existingPaydown: 'false', existingPayoff: 'false',
  existingPaydownAmount: '', existingPayoffAmount: '', lienPriorityNow: '', lienPriorityAfter: '',
  remainingNewLienPriority: '', newRemainingBalance: '',
  interestRate: '',
  maturityDate: '', originalBalance: '', balanceAfter: '', currentBalance: '', regularPayment: '',
  balloon: 'false', balloonAmount: '',
  recordingNumber: '', recordingNumberFlag: 'false', recordingDate: '', seniorLienTracking: 'false',
  sltActive: 'false',
  lastVerified: '', lastChecked: '',
  sltCurrent: 'false', sltDelinquent: 'false', sltDelinquentDays: '', sltUnderModification: 'false',
  sltForeclosure: 'false', sltForeclosureDate: '', sltPaidOff: 'false',
  sltLastPaymentMade: '', sltNextPaymentDue: '', sltCurrentBalance: '',
  sltRequestSubmitted: '', sltResponseReceived: '', sltUnableToVerify: 'false',
  sltLenderNotified: 'false', sltLenderNotifiedDate: '',
  sltBorrowerNotified: 'false', sltBorrowerNotifiedDate: '',
  note: '', thisLoan: 'false', estimate: 'false', status: '',
  delinquencies60day: 'false', delinquenciesHowMany: '', currentlyDelinquent: 'false', currentlyDelinquentAmount: '',
  paidByLoan: 'false', sourceOfPayment: '',
  sourceOfInformation: '',
});

export const LienModal: React.FC<LienModalProps> = ({ open, onOpenChange, lien, onSave, isEdit, propertyOptions = [], loanValues = {}, currentPropertyId }) => {
  const [formData, setFormData] = useState<LienData>(getDefaultLien());
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (open) {
      if (lien) {
        setFormData(lien);
      } else {
        const seeded = getDefaultLien();
        if (currentPropertyId) seeded.property = currentPropertyId;
        setFormData(seeded);
      }
    }
  }, [open, lien, currentPropertyId]);

  const handleChange = (field: keyof LienData, value: string) => setFormData(prev => ({ ...prev, [field]: value }));

  const isFormFilled = hasModalFormData(formData, ['id', 'priority'], { anticipated: 'false', existingRemain: 'false', existingPaydown: 'false', existingPayoff: 'false', thisLoan: 'false', estimate: 'false', recordingNumberFlag: 'false', seniorLienTracking: 'false' });
  const emailsValid = hasValidEmails(formData as any, ['email']);

  const handleSaveClick = () => setShowConfirm(true);
  const handleConfirmSave = async () => {
    setShowConfirm(false);
    const success = await onSave(formData);
    if (success !== false) onOpenChange(false);
  };

  const isThisLoan = formData.thisLoan === 'true';
  const isAnticipated = formData.anticipated === 'true';
  const isPayoff = formData.existingPayoff === 'true';
  const isPaydown = formData.existingPaydown === 'true';

  const handleLienTypeSelect = useCallback((type: 'anticipated' | 'existingRemain' | 'existingPaydown' | 'existingPayoff', checked: boolean) => {
    setFormData(prev => {
      const next = {
        ...prev,
        anticipated: 'false',
        existingRemain: 'false',
        existingPaydown: 'false',
        existingPayoff: 'false',
      };
      if (checked) {
        next[type] = 'true';
        if (type === 'existingPayoff') next.balanceAfter = '0.00';
        if (type === 'anticipated') { next.originalBalance = ''; next.currentBalance = ''; }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!open || !isThisLoan) return;
    const { account, balanceAfter, regularPayment } = getThisLoanAutofillValues(loanValues);
    setFormData(prev => {
      if (prev.account === account && prev.balanceAfter === balanceAfter && prev.regularPayment === regularPayment) {
        return prev;
      }
      return { ...prev, account, balanceAfter, regularPayment };
    });
  }, [open, isThisLoan, loanValues]);

  const handleThisLoanToggle = (checked: boolean) => {
    if (checked) {
      const { account, balanceAfter, regularPayment } = getThisLoanAutofillValues(loanValues);
      setFormData(prev => ({
        ...prev,
        thisLoan: 'true',
        account,
        balanceAfter,
        regularPayment,
      }));
      return;
    }

    setFormData(prev => ({ ...prev, thisLoan: 'false' }));
  };

  const [datePickerStates, setDatePickerStates] = useState<Record<string, boolean>>({});

  const safeParseDateStr = (val: string): Date | undefined => {
    if (!val) return undefined;
    try {
      const d = parse(val, 'yyyy-MM-dd', new Date());
      return isValid(d) ? d : undefined;
    } catch { return undefined; }
  };

  const renderInlineField = (field: keyof LienData, label: string, type = 'text', forceDisabled = false) => {
    if (type === 'date') {
      const val = formData[field] || '';
      return (
        <div className="flex items-center gap-2">
          <Label className="w-[110px] shrink-0 text-xs text-foreground">{label}</Label>
          <Popover open={datePickerStates[field] || false} onOpenChange={(open) => setDatePickerStates(prev => ({ ...prev, [field]: open }))}>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn('h-7 text-xs flex-1 justify-start text-left font-normal', !val && 'text-muted-foreground', forceDisabled && 'opacity-50 cursor-not-allowed')} disabled={forceDisabled}>
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
    }
    return (
      <div className="flex items-center gap-2">
        <Label className="w-[110px] shrink-0 text-xs text-foreground">{label}</Label>
        <Input value={formData[field]} onChange={(e) => handleChange(field, e.target.value)} className={`h-7 text-xs flex-1 ${forceDisabled ? 'opacity-50 bg-muted' : ''}`} type={type} disabled={forceDisabled} />
      </div>
    );
  };

  const renderCurrencyField = (field: keyof LienData, label: string, forceDisabled = false) => (
    <div className="flex items-center gap-2">
      <Label className="w-[110px] shrink-0 text-xs text-foreground">{label}</Label>
      <div className="relative flex-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
        <Input
          value={formData[field]}
          onChange={(e) => handleChange(field, unformatCurrencyDisplay(e.target.value))}
          onKeyDown={numericKeyDown}
          onPaste={(e) => numericPaste(e, (val) => handleChange(field, val))}
          onBlur={() => { const raw = formData[field]; if (raw) handleChange(field, formatCurrencyDisplay(raw)); }}
          onFocus={() => { const raw = formData[field]; if (raw) handleChange(field, unformatCurrencyDisplay(raw)); }}
          className={`h-7 text-xs pl-7 ${forceDisabled ? 'opacity-50 bg-muted' : ''}`}
          inputMode="decimal"
          placeholder="0.00"
          disabled={forceDisabled}
        />
      </div>
    </div>
  );

  const renderPercentageField = (field: keyof LienData, label: string, forceDisabled = false) => (
    <div className="flex items-center gap-2">
      <Label className="w-[110px] shrink-0 text-xs text-foreground">{label}</Label>
      <div className="relative flex-1">
        <Input value={formData[field]} onChange={(e) => handleChange(field, sanitizeInterestInput(e.target.value))} onBlur={() => { const v = normalizeInterestOnBlur(formData[field], 3); if (v !== formData[field]) handleChange(field, v); }} className={`h-7 text-xs text-right pr-6 ${forceDisabled ? 'opacity-50 bg-muted' : ''}`} inputMode="decimal" placeholder="0.00" disabled={forceDisabled} />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
      </div>
    </div>
  );

  const handleFormChange = (field: keyof LienData, value: string) => {
    if (field === 'thisLoan') {
      handleThisLoanToggle(value === 'true');
      return;
    }
    handleChange(field, value);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Home className="h-4 w-4 text-primary" />
              Lien Details
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0 sleek-scrollbar mt-2">
            <LienDetailForm
              lien={formData}
              onChange={handleFormChange}
              propertyOptions={propertyOptions}
              loanValues={loanValues}
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border shrink-0 mt-0">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveClick} disabled={!isFormFilled || !emailsValid}>OK</Button>
          </div>
        </DialogContent>
      </Dialog>
      <ModalSaveConfirmation open={showConfirm} onConfirm={handleConfirmSave} onCancel={() => setShowConfirm(false)} />
    </>
  );
};

export default LienModal;
