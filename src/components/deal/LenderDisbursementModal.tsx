import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { CalendarIcon } from 'lucide-react';
import { formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dateOnly';
import { cn } from '@/lib/utils';
import { AccountIdSearch } from './AccountIdSearch';
import { ModalSaveConfirmation } from './ModalSaveConfirmation';
import { numericKeyDown, numericPaste, formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';

export interface DisbursementFormData {
  accountId: string;
  name: string;
  debitPercent: string;
  debitOf: 'Payment' | 'Interest' | 'Principal' | 'NA' | '';
  plusAmount: string;
  minimumAmount: string;
  maximumAmount: string;
  startDate: string;
  debitThrough: 'date' | 'amount' | 'payments' | 'payoff' | '';
  debitThroughDate: string;
  debitThroughAmount: string;
  debitThroughPayments: string;
  from: 'Payment' | 'Interest' | 'Principal' | 'NA' | '';
  calculatedAmount: string;
  comments: string;
}

const emptyForm = (): DisbursementFormData => ({
  accountId: '',
  name: '',
  debitPercent: '',
  debitOf: '',
  plusAmount: '',
  minimumAmount: '',
  maximumAmount: '',
  startDate: '',
  debitThrough: '',
  debitThroughDate: '',
  debitThroughAmount: '',
  debitThroughPayments: '',
  from: '',
  calculatedAmount: '',
  comments: '',
});

interface LenderDisbursementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: DisbursementFormData) => void;
  editData?: DisbursementFormData | null;
  isEditing?: boolean;
  paymentShare?: number;
  interestShare?: number;
  principalShare?: number;
}

const parseNum = (s: string): number => parseFloat((s || '').toString().replace(/[$,]/g, '')) || 0;

export const LenderDisbursementModal: React.FC<LenderDisbursementModalProps> = ({
  open,
  onOpenChange,
  onSubmit,
  editData,
  isEditing = false,
  paymentShare = 0,
  interestShare = 0,
  principalShare = 0,
}) => {
  const [formData, setFormData] = useState<DisbursementFormData>(emptyForm());
  const [showConfirm, setShowConfirm] = useState(false);
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [debitDateOpen, setDebitDateOpen] = useState(false);

  // Only re-initialize the form when the modal transitions from closed -> open.
  // Using `open` alone (not editData) prevents the parent's inline-recreated editData object
  // from wiping user input on every parent re-render while editing.
  const wasOpenRef = React.useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setFormData(editData ? { ...emptyForm(), ...editData } : emptyForm());
    }
    wasOpenRef.current = open;
  }, [open, editData]);

  const handleChange = (field: keyof DisbursementFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Auto-default Type to "NA" when % <= 0; clear "NA" when % becomes > 0
  const debitPercentNum = parseNum(formData.debitPercent);
  const isPercentZeroOrLess = debitPercentNum <= 0;
  useEffect(() => {
    if (isPercentZeroOrLess) {
      if (formData.debitOf !== 'NA') {
        setFormData(prev => ({ ...prev, debitOf: 'NA' }));
      }
    } else if (formData.debitOf === 'NA') {
      setFormData(prev => ({ ...prev, debitOf: '' }));
    }
  }, [isPercentZeroOrLess, formData.debitOf]);

  // Live calculation
  const calculatedAmount = useMemo(() => {
    let base = 0;
    if (formData.debitOf === 'Payment') base = paymentShare;
    else if (formData.debitOf === 'Interest') base = interestShare;
    else if (formData.debitOf === 'Principal') base = principalShare;
    const pct = parseNum(formData.debitPercent);
    const plus = parseNum(formData.plusAmount);
    const min = formData.minimumAmount ? parseNum(formData.minimumAmount) : null;
    const max = formData.maximumAmount ? parseNum(formData.maximumAmount) : null;
    let calc = base * (pct / 100) + plus;
    if (min !== null && calc < min) calc = min;
    if (max !== null && calc > max) calc = max;
    return calc;
  }, [formData.debitOf, formData.debitPercent, formData.plusAmount, formData.minimumAmount, formData.maximumAmount, paymentShare, interestShare, principalShare]);

  // Sync calculatedAmount into form
  useEffect(() => {
    setFormData(prev => ({ ...prev, calculatedAmount: calculatedAmount.toFixed(2) }));
  }, [calculatedAmount]);

  // Validation
  const minMaxError =
    formData.minimumAmount && formData.maximumAmount &&
    parseNum(formData.minimumAmount) > parseNum(formData.maximumAmount);
  const isValid =
    !!formData.accountId &&
    parseNum(formData.debitPercent) >= 0 &&
    !!formData.startDate &&
    !!formData.debitThrough &&
    !minMaxError &&
    (formData.debitThrough !== 'date' || !!formData.debitThroughDate) &&
    (formData.debitThrough !== 'amount' || !!formData.debitThroughAmount) &&
    (formData.debitThrough !== 'payments' || !!formData.debitThroughPayments);

  const handleSaveClick = () => setShowConfirm(true);
  const handleConfirmSave = () => {
    setShowConfirm(false);
    onSubmit({ ...formData, from: formData.debitOf });
    onOpenChange(false);
  };

  const handleCancel = () => onOpenChange(false);

  const startDateValue = parseDateOnly(formData.startDate);
  const debitDateValue = parseDateOnly(formData.debitThroughDate);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[560px] p-0 gap-0 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 pr-10">
            <span className="text-xs font-bold">Lender Disbursements</span>
          </div>

          <div className="px-3 py-3 space-y-2">
            {/* Payee */}
            <div className="flex items-center gap-1">
              <Label className="text-[11px] font-bold min-w-[80px] shrink-0">Payee</Label>
              <AccountIdSearch
                value={formData.accountId}
                onChange={(accountId, name) => {
                  setFormData(prev => ({
                    ...prev,
                    accountId,
                    ...(name ? { name } : {}),
                  }));
                }}
                className="h-6 text-[11px]"
              />
            </div>

            {/* Name */}
            <div className="flex items-center gap-1">
              <Label className="text-[11px] font-bold min-w-[80px] shrink-0">Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                className="h-6 text-[11px]"
              />
            </div>

            {/* Debit ___% of [Type] */}
            <div className="flex items-center gap-1">
              <Label className="text-[11px] font-bold min-w-[80px] shrink-0">Debit</Label>
              <div className="relative w-[70px]">
                <Input
                  value={formData.debitPercent}
                  onChange={(e) => handleChange('debitPercent', e.target.value.replace(/[^0-9.]/g, ''))}
                  onKeyDown={numericKeyDown}
                  className="h-6 text-[11px] pr-5"
                  inputMode="decimal"
                />
                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">%</span>
              </div>
              <span className="text-[11px] text-muted-foreground">of</span>
              <Select
                value={formData.debitOf || undefined}
                onValueChange={(val) => handleChange('debitOf', val)}
                disabled={isPercentZeroOrLess}
              >
                <SelectTrigger className="h-6 text-[11px] w-[110px]">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="!z-[9999]" position="popper" sideOffset={4}>
                  <SelectItem value="Payment">Payment</SelectItem>
                  <SelectItem value="Interest">Interest</SelectItem>
                  <SelectItem value="Principal">Principal</SelectItem>
                  <SelectItem value="NA">NA</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Plus */}
            <div className="flex items-center gap-1">
              <Label className="text-[11px] font-bold min-w-[80px] shrink-0">Plus</Label>
              <div className="relative flex-1">
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span>
                <Input
                  value={formData.plusAmount}
                  onChange={(e) => handleChange('plusAmount', e.target.value.replace(/[^0-9.]/g, ''))}
                  onKeyDown={numericKeyDown}
                  onPaste={(e) => numericPaste(e, (val) => handleChange('plusAmount', val))}
                  onBlur={() => { if (formData.plusAmount) handleChange('plusAmount', formatCurrencyDisplay(formData.plusAmount)); }}
                  onFocus={() => { if (formData.plusAmount) handleChange('plusAmount', unformatCurrencyDisplay(formData.plusAmount)); }}
                  className="h-6 text-[11px] pl-4"
                  inputMode="decimal"
                  placeholder="-"
                />
              </div>
            </div>

            {/* Minimum */}
            <div className="flex items-center gap-1">
              <Label className="text-[11px] font-bold min-w-[80px] shrink-0">Minimum</Label>
              <div className="relative flex-1">
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span>
                <Input
                  value={formData.minimumAmount}
                  onChange={(e) => handleChange('minimumAmount', e.target.value.replace(/[^0-9.]/g, ''))}
                  onKeyDown={numericKeyDown}
                  onPaste={(e) => numericPaste(e, (val) => handleChange('minimumAmount', val))}
                  onBlur={() => { if (formData.minimumAmount) handleChange('minimumAmount', formatCurrencyDisplay(formData.minimumAmount)); }}
                  onFocus={() => { if (formData.minimumAmount) handleChange('minimumAmount', unformatCurrencyDisplay(formData.minimumAmount)); }}
                  className="h-6 text-[11px] pl-4"
                  inputMode="decimal"
                  placeholder="-"
                />
              </div>
            </div>

            {/* Maximum (NEW) */}
            <div className="flex items-center gap-1">
              <Label className="text-[11px] font-bold min-w-[80px] shrink-0">Maximum</Label>
              <div className="relative flex-1">
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span>
                <Input
                  value={formData.maximumAmount}
                  onChange={(e) => handleChange('maximumAmount', e.target.value.replace(/[^0-9.]/g, ''))}
                  onKeyDown={numericKeyDown}
                  onPaste={(e) => numericPaste(e, (val) => handleChange('maximumAmount', val))}
                  onBlur={() => { if (formData.maximumAmount) handleChange('maximumAmount', formatCurrencyDisplay(formData.maximumAmount)); }}
                  onFocus={() => { if (formData.maximumAmount) handleChange('maximumAmount', unformatCurrencyDisplay(formData.maximumAmount)); }}
                  className="h-6 text-[11px] pl-4"
                  inputMode="decimal"
                  placeholder="-"
                />
              </div>
            </div>
            {minMaxError && (
              <p className="text-[10px] text-destructive font-medium pl-[84px]">Minimum must be ≤ Maximum</p>
            )}

            {/* Calculated Amount (read-only) */}
            <div className="flex items-center gap-1">
              <Label className="text-[11px] font-bold min-w-[80px] shrink-0">Amount</Label>
              <div className="relative flex-1">
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span>
                <Input
                  value={formatCurrencyDisplay(calculatedAmount.toFixed(2))}
                  readOnly
                  className="h-6 text-[11px] pl-4 bg-muted/30 font-semibold"
                />
              </div>
            </div>

            {/* Start Date */}
            <div className="flex items-center gap-1 pt-1 border-t border-border mt-2">
              <Label className="text-[11px] font-bold min-w-[80px] shrink-0">Start Date</Label>
              <Popover open={startDateOpen} onOpenChange={setStartDateOpen} modal={false}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('h-6 text-[11px] flex-1 justify-start text-left font-normal', !startDateValue && 'text-muted-foreground')}>
                    {startDateValue && !isNaN(startDateValue.getTime()) ? formatDateOnly(startDateValue, 'MM/dd/yyyy') : 'MM/DD/YYYY'}
                    <CalendarIcon className="ml-auto h-3 w-3" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                  <EnhancedCalendar
                    mode="single"
                    selected={startDateValue}
                    onSelect={(d) => { handleChange('startDate', d ? formatDateOnly(d) : ''); setStartDateOpen(false); }}
                    onClear={() => { handleChange('startDate', ''); setStartDateOpen(false); }}
                    onToday={() => { handleChange('startDate', todayDateOnly()); setStartDateOpen(false); }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Debit Through */}
            <div className="flex items-center gap-1">
              <Label className="text-[11px] font-bold min-w-[80px] shrink-0">Debit Through</Label>
              <Select value={formData.debitThrough || undefined} onValueChange={(val) => handleChange('debitThrough', val)}>
                <SelectTrigger className="h-6 text-[11px] flex-1">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="!z-[9999]" position="popper" sideOffset={4}>
                  <SelectItem value="date">Date</SelectItem>
                  <SelectItem value="amount">Amount</SelectItem>
                  <SelectItem value="payments">Number of Payments</SelectItem>
                  <SelectItem value="payoff">Payoff</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Dynamic field based on selection */}
            {formData.debitThrough === 'date' && (
              <div className="flex items-center gap-1">
                <Label className="text-[11px] min-w-[80px] shrink-0">Date</Label>
                <Popover open={debitDateOpen} onOpenChange={setDebitDateOpen} modal={false}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn('h-6 text-[11px] flex-1 justify-start text-left font-normal', !debitDateValue && 'text-muted-foreground')}>
                      {debitDateValue && !isNaN(debitDateValue.getTime()) ? formatDateOnly(debitDateValue, 'MM/dd/yyyy') : 'MM/DD/YYYY'}
                      <CalendarIcon className="ml-auto h-3 w-3" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                    <EnhancedCalendar
                      mode="single"
                      selected={debitDateValue}
                      onSelect={(d) => { handleChange('debitThroughDate', d ? formatDateOnly(d) : ''); setDebitDateOpen(false); }}
                      onClear={() => { handleChange('debitThroughDate', ''); setDebitDateOpen(false); }}
                      onToday={() => { handleChange('debitThroughDate', todayDateOnly()); setDebitDateOpen(false); }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            )}
            {formData.debitThrough === 'amount' && (
              <div className="flex items-center gap-1">
                <Label className="text-[11px] min-w-[80px] shrink-0">Amount</Label>
                <div className="relative flex-1">
                  <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span>
                  <Input
                    value={formData.debitThroughAmount}
                    onChange={(e) => handleChange('debitThroughAmount', e.target.value.replace(/[^0-9.]/g, ''))}
                    onKeyDown={numericKeyDown}
                    onBlur={() => { if (formData.debitThroughAmount) handleChange('debitThroughAmount', formatCurrencyDisplay(formData.debitThroughAmount)); }}
                    onFocus={() => { if (formData.debitThroughAmount) handleChange('debitThroughAmount', unformatCurrencyDisplay(formData.debitThroughAmount)); }}
                    className="h-6 text-[11px] pl-4"
                    inputMode="decimal"
                    placeholder="-"
                  />
                </div>
              </div>
            )}
            {formData.debitThrough === 'payments' && (
              <div className="flex items-center gap-1">
                <Label className="text-[11px] min-w-[80px] shrink-0"># Payments</Label>
                <Input
                  value={formData.debitThroughPayments}
                  onChange={(e) => handleChange('debitThroughPayments', e.target.value.replace(/[^0-9]/g, ''))}
                  className="h-6 text-[11px] flex-1"
                  inputMode="numeric"
                  placeholder="-"
                />
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0 border-t border-border px-3 py-2">
            <Button variant="outline" size="sm" onClick={handleCancel}>Cancel</Button>
            <Button size="sm" onClick={handleSaveClick} disabled={!isValid}>
              {isEditing ? 'Update' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ModalSaveConfirmation open={showConfirm} onConfirm={handleConfirmSave} onCancel={() => setShowConfirm(false)} />
    </>
  );
};

export default LenderDisbursementModal;
