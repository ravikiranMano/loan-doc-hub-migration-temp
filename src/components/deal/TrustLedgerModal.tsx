import React, { useState, useEffect, useCallback } from 'react';
import { Building, CalendarIcon } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dateOnly';
import { cn } from '@/lib/utils';
import { ModalSaveConfirmation } from './ModalSaveConfirmation';
import { hasModalFormData } from '@/lib/modalFormValidation';
import { numericKeyDown, numericPaste, formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';
import type { TrustLedgerEntry } from './TrustLedgerTableView';

interface TrustLedgerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry?: TrustLedgerEntry | null;
  onSave: (entry: TrustLedgerEntry) => void;
  isEdit?: boolean;
}

const getEmptyEntry = (): TrustLedgerEntry => ({
  id: `trust_ledger_${Date.now()}`,
  date: todayDateOnly(),
  reference: '',
  fromWhomReceivedPaid: '',
  memo: '',
  payment: '',
  clr: '',
  deposit: '',
  balance: '',
  category: 'all',
});

export const TrustLedgerModal: React.FC<TrustLedgerModalProps> = ({
  open, onOpenChange, entry, onSave, isEdit = false,
}) => {
  const [formData, setFormData] = useState<TrustLedgerEntry>(getEmptyEntry());
  const [showConfirm, setShowConfirm] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [paymentFocused, setPaymentFocused] = useState(false);
  const [depositFocused, setDepositFocused] = useState(false);
  const [balanceFocused, setBalanceFocused] = useState(false);
  const [mutualError, setMutualError] = useState('');

  const safeParseDateStr = (val: string): Date | undefined => parseDateOnly(val);

  useEffect(() => {
    if (open) {
      setFormData(entry ? { ...entry } : getEmptyEntry());
      setMutualError('');
    }
  }, [open, entry]);

  // Check mutual exclusivity
  useEffect(() => {
    const p = unformatCurrencyDisplay(formData.payment || '').replace(/\$/g, '');
    const d = unformatCurrencyDisplay(formData.deposit || '').replace(/\$/g, '');
    const hasPayment = p !== '' && parseFloat(p) > 0;
    const hasDeposit = d !== '' && parseFloat(d) > 0;
    setMutualError(hasPayment && hasDeposit ? 'Enter either Payment or Deposit, not both' : '');
  }, [formData.payment, formData.deposit]);

  const isFormValid = useCallback(() => {
    if (!formData.date || !formData.fromWhomReceivedPaid?.trim() || !formData.category) return false;
    if (mutualError) return false;
    return hasModalFormData(formData, ['id', 'date', 'category']);
  }, [formData, mutualError]);

  const handleSaveClick = () => setShowConfirm(true);
  const handleConfirmSave = () => {
    // Format currency values before saving (store raw numbers)
    const saveData = { ...formData };
    ['payment', 'deposit', 'balance'].forEach(key => {
      const raw = unformatCurrencyDisplay((saveData as any)[key] || '').replace(/\$/g, '');
      (saveData as any)[key] = raw;
    });
    setShowConfirm(false);
    onSave(saveData);
    onOpenChange(false);
  };

  const handleChange = (field: keyof TrustLedgerEntry, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleCurrencyBlur = (field: 'payment' | 'deposit' | 'balance') => {
    const raw = unformatCurrencyDisplay(formData[field] || '').replace(/\$/g, '');
    if (raw) {
      handleChange(field, formatCurrencyDisplay(raw));
    }
    if (field === 'payment') setPaymentFocused(false);
    if (field === 'deposit') setDepositFocused(false);
    if (field === 'balance') setBalanceFocused(false);
  };

  const handleCurrencyFocus = (field: 'payment' | 'deposit' | 'balance') => {
    const raw = unformatCurrencyDisplay(formData[field] || '').replace(/\$/g, '');
    handleChange(field, raw);
    if (field === 'payment') setPaymentFocused(true);
    if (field === 'deposit') setDepositFocused(true);
    if (field === 'balance') setBalanceFocused(true);
  };

  const handleCurrencyPaste = (field: 'payment' | 'deposit' | 'balance') => (e: React.ClipboardEvent<HTMLInputElement>) => {
    numericPaste(e, (val) => handleChange(field, val));
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Building className="h-4 w-4 text-primary" />
              {isEdit ? 'Edit Trust Ledger Entry' : 'Add Trust Ledger Entry'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 mt-3 flex-1 overflow-y-auto overflow-x-hidden min-h-0">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-foreground">Date <span className="text-destructive">*</span></Label>
                <Popover open={dateOpen} onOpenChange={setDateOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn('h-8 text-xs w-full justify-start text-left font-normal', !formData.date && 'text-muted-foreground')}>
                      {formData.date && safeParseDateStr(formData.date) ? formatDateOnly(safeParseDateStr(formData.date), 'MM/dd/yyyy') : 'MM/DD/YYYY'}
                      <CalendarIcon className="ml-auto h-3.5 w-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                    <EnhancedCalendar
                      mode="single"
                      selected={safeParseDateStr(formData.date)}
                      onSelect={(date) => { if (date) handleChange('date', formatDateOnly(date)); setDateOpen(false); }}
                      onClear={() => { handleChange('date', ''); setDateOpen(false); }}
                      onToday={() => { handleChange('date', todayDateOnly()); setDateOpen(false); }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-foreground">Reference</Label>
                <Input value={formData.reference} onChange={e => handleChange('reference', e.target.value.slice(0, 50))} className="h-8 text-xs" placeholder="e.g. V-Check" maxLength={50} />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-foreground">From Whom Received / Paid <span className="text-destructive">*</span></Label>
              <Input value={formData.fromWhomReceivedPaid} onChange={e => handleChange('fromWhomReceivedPaid', e.target.value.slice(0, 100))} className="h-8 text-xs" maxLength={100} />
              {!formData.fromWhomReceivedPaid?.trim() && formData.date && <p className="text-[10px] text-destructive">From Whom is required</p>}
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-foreground">Memo</Label>
              <Input value={formData.memo} onChange={e => handleChange('memo', e.target.value.slice(0, 200))} className="h-8 text-xs" placeholder="e.g. Borrower Payment" maxLength={200} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-foreground">Payment</Label>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={formData.payment}
                    onChange={e => handleChange('payment', e.target.value)}
                    onKeyDown={numericKeyDown}
                    onPaste={handleCurrencyPaste('payment')}
                    onFocus={() => handleCurrencyFocus('payment')}
                    onBlur={() => handleCurrencyBlur('payment')}
                    className="h-8 text-xs pl-5 text-right"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-foreground">Deposit</Label>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={formData.deposit}
                    onChange={e => handleChange('deposit', e.target.value)}
                    onKeyDown={numericKeyDown}
                    onPaste={handleCurrencyPaste('deposit')}
                    onFocus={() => handleCurrencyFocus('deposit')}
                    onBlur={() => handleCurrencyBlur('deposit')}
                    className="h-8 text-xs pl-5 text-right"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>
            {mutualError && <p className="text-[10px] text-destructive font-medium">{mutualError}</p>}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-foreground">Balance</Label>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={formData.balance}
                    onChange={e => handleChange('balance', e.target.value)}
                    onKeyDown={numericKeyDown}
                    onPaste={handleCurrencyPaste('balance')}
                    onFocus={() => handleCurrencyFocus('balance')}
                    onBlur={() => handleCurrencyBlur('balance')}
                    className="h-8 text-xs pl-5 text-right"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-foreground">CLR</Label>
                <div className="flex items-center h-8 gap-2">
                  <Checkbox
                    checked={formData.clr === 'R' || formData.clr === 'true'}
                    onCheckedChange={(checked) => handleChange('clr', checked ? 'R' : '')}
                  />
                  <span className="text-xs text-muted-foreground">{formData.clr === 'R' || formData.clr === 'true' ? 'Cleared' : 'Pending'}</span>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-foreground">Category <span className="text-destructive">*</span></Label>
              <Select value={formData.category} onValueChange={v => handleChange('category', v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="bg-background border border-border z-[10000] max-h-60">
                  <SelectItem value="all">All Transactions</SelectItem>
                  <SelectItem value="reserve">Reserve</SelectItem>
                  <SelectItem value="impound">Impound</SelectItem>
                  <SelectItem value="fee">Fee</SelectItem>
                  <SelectItem value="interest">Interest</SelectItem>
                  <SelectItem value="payment">Payment</SelectItem>
                  <SelectItem value="adjustment">Adjustment</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="mt-4 shrink-0">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveClick} disabled={!isFormValid()}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ModalSaveConfirmation open={showConfirm} onConfirm={handleConfirmSave} onCancel={() => setShowConfirm(false)} />
    </>
  );
};

export default TrustLedgerModal;
