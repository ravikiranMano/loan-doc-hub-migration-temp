import React, { useState, useEffect } from 'react';
import { DollarSign, CalendarIcon, Search } from 'lucide-react';
import { sanitizeInterestInput, normalizeInterestOnBlur } from '@/lib/interestValidation';
import { numericKeyDown, numericPaste, formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ModalSaveConfirmation } from './ModalSaveConfirmation';
import { hasModalFormData } from '@/lib/modalFormValidation';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dateOnly';
import type { ChargeData } from './ChargesTableView';

interface ChargesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  charge?: ChargeData | null;
  onSave: (charge: ChargeData) => void;
  isEdit?: boolean;
}

const generateChargeId = () => `charge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const getEmptyCharge = (): ChargeData => ({
  id: generateChargeId(), description: '', unpaidBalance: '', owedTo: '', owedFrom: '', totalDue: '',
  interestFrom: '', dateOfCharge: '', interestRate: '', notes: '', reference: '', chargeType: '',
  deferred: '', originalAmount: '', account: '', borrowerFullName: '', advancedByAccount: '',
  advancedByLenderName: '', advancedByAmount: '', onBehalfOfAccount: '', onBehalfOfLenderName: '',
  onBehalfOfAmount: '', amountOwedByBorrower: '', accruedInterest: '', distributeBetweenAllLenders: '',
  department: '', category: '', details: '', currentBalance: '', balanceDueAsOf: '', balanceDue: '',
  advancedByDeferred: '', advancedByTotal: '', onBehalfOfBilling: '', onBehalfOfTotal: '',
});

import { DEPARTMENT_OPTIONS, getDepartmentCategories, getCategoryDetails } from '@/lib/chargesCategoryData';

const BILLING_OPTIONS = ['Short Payment', 'Debit All Outgoing', 'Credit Card', 'Invoice / Link'];

export const ChargesModal: React.FC<ChargesModalProps> = ({ open, onOpenChange, charge, onSave, isEdit = false }) => {
  const [formData, setFormData] = useState<ChargeData>(getEmptyCharge());
  const [showConfirm, setShowConfirm] = useState(false);
  const [datePickerStates, setDatePickerStates] = useState<Record<string, boolean>>({});
  const [focusedCurrencyField, setFocusedCurrencyField] = useState<string | null>(null);

  useEffect(() => {
    if (open) setFormData(charge ? charge : getEmptyCharge());
  }, [open, charge]);

  const handleFieldChange = (field: keyof ChargeData, value: string) => setFormData(prev => ({ ...prev, [field]: value }));

  const isFormFilled = hasModalFormData(formData, ['id']);

  /** Validate account number - must not be negative */
  const validateAccountNumber = (account: string): boolean => {
    if (!account) return true; // Empty is allowed
    const num = parseFloat(account);
    return !isNaN(num) && num >= 0;
  };

  const handleSaveClick = () => {
    // Validate Account Number before showing confirmation
    if (!validateAccountNumber(formData.account || '')) {
      toast.error('Account Number cannot be negative. Please enter a positive value.');
      return;
    }
    setShowConfirm(true);
  };
  const handleConfirmSave = () => { setShowConfirm(false); onSave(formData); onOpenChange(false); };

  const safeParse = (v: string): Date | undefined => parseDateOnly(v);

  const renderDateField = (field: keyof ChargeData, label: string, labelWidth = 'w-[110px]') => {
    const val = formData[field] || '';
    return (
      <div className="flex items-center gap-2">
        <Label className={cn(labelWidth, 'shrink-0 text-xs font-semibold text-foreground')}>{label}</Label>
        <Popover open={datePickerStates[field] || false} onOpenChange={(o) => setDatePickerStates(prev => ({ ...prev, [field]: o }))}>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn('h-7 text-xs flex-1 justify-start text-left font-normal', !val && 'text-muted-foreground')}>
              {val && safeParse(val) ? formatDateOnly(safeParse(val), 'MM/dd/yyyy') : 'MM/DD/YYYY'}
              <CalendarIcon className="ml-auto h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 !z-[9999]" align="start">
            <EnhancedCalendar mode="single" selected={safeParse(val)} onSelect={(date) => { if (date) handleFieldChange(field, formatDateOnly(date)); setDatePickerStates(prev => ({ ...prev, [field]: false })); }} onClear={() => { handleFieldChange(field, ''); setDatePickerStates(prev => ({ ...prev, [field]: false })); }} onToday={() => { handleFieldChange(field, todayDateOnly()); setDatePickerStates(prev => ({ ...prev, [field]: false })); }} initialFocus />
          </PopoverContent>
        </Popover>
      </div>
    );
  };

  const renderTextField = (field: keyof ChargeData, label: string, labelWidth = 'w-[110px]') => (
    <div className="flex items-center gap-2">
      <Label className={cn(labelWidth, 'shrink-0 text-xs font-semibold text-foreground')}>{label}</Label>
      <Input 
        value={formData[field]} 
        onChange={(e) => {
          // Block negative sign for account field
          if (field === 'account' && e.target.value.includes('-')) {
            toast.error('Account Number cannot be negative');
            return;
          }
          handleFieldChange(field, e.target.value);
        }} 
        className="h-7 text-xs flex-1" 
      />
    </div>
  );

  const renderCurrencyField = (field: keyof ChargeData, label: string, labelWidth = 'w-[110px]') => (
    <div className="flex items-center gap-2">
      <Label className={cn(labelWidth, 'shrink-0 text-xs font-semibold text-foreground')}>{label}</Label>
      <div className="relative flex-1">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
        <Input
          inputMode="decimal"
          value={focusedCurrencyField === field ? formData[field] : formatCurrencyDisplay(formData[field])}
          onFocus={() => { setFocusedCurrencyField(field); handleFieldChange(field, unformatCurrencyDisplay(formData[field])); }}
          onBlur={() => { setFocusedCurrencyField(null); const v = formatCurrencyDisplay(formData[field]); if (v) handleFieldChange(field, unformatCurrencyDisplay(v)); }}
          onChange={(e) => handleFieldChange(field, e.target.value)}
          onKeyDown={numericKeyDown}
          onPaste={(e) => numericPaste(e, (v) => handleFieldChange(field, v))}
          className="h-7 text-xs pl-5"
          placeholder="0.00"
        />
      </div>
    </div>
  );

  const renderPercentageField = (field: keyof ChargeData, label: string, labelWidth = 'w-[110px]') => (
    <div className="flex items-center gap-2">
      <Label className={cn(labelWidth, 'shrink-0 text-xs font-semibold text-foreground')}>{label}</Label>
      <div className="relative flex-1">
        <Input inputMode="decimal" value={formData[field]} onChange={(e) => handleFieldChange(field, sanitizeInterestInput(e.target.value))} onBlur={() => { const v = normalizeInterestOnBlur(formData[field], 3); if (v !== formData[field]) handleFieldChange(field, v); }} className="h-7 text-xs pr-5" placeholder="0.00" />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
      </div>
    </div>
  );

  const renderSelectField = (field: keyof ChargeData, label: string, options: string[], labelWidth = 'w-[110px]') => (
    <div className="flex items-center gap-2">
      <Label className={cn(labelWidth, 'shrink-0 text-xs font-semibold text-foreground')}>{label}</Label>
      <Select value={formData[field] || undefined} onValueChange={(val) => handleFieldChange(field, val)}>
        <SelectTrigger className="h-7 text-xs flex-1">
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
        <SelectContent className="!z-[9999]" position="popper" sideOffset={4}>
          {options.map(opt => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const categoryOptions = formData.department ? getDepartmentCategories(formData.department) : [];
  const detailsOptions = (formData.department && formData.category) ? getCategoryDetails(formData.department, formData.category) : [];

  // Reset dependent dropdowns when parent changes
  const handleDepartmentChange = (val: string) => {
    setFormData(prev => ({ ...prev, department: val, category: '', details: '' }));
  };
  const handleCategoryChange = (val: string) => {
    setFormData(prev => ({ ...prev, category: val, details: '' }));
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <DollarSign className="h-4 w-4 text-primary" />
              {isEdit ? 'Edit Charge' : 'New Charge'}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0 sleek-scrollbar space-y-4 mt-3">
            {/* ─── Section: $ Charges ─── */}
            <div>
              <div className="bg-primary/10 border border-primary/20 rounded px-2 py-1 mb-2">
                <span className="font-semibold text-xs text-primary">$ Charges</span>
              </div>

              {/* Top row: Account Number + Borrower Name */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-1 mb-2">
                {renderTextField('account', 'Account Number')}
                {renderTextField('borrowerFullName', 'Borrower Name')}
              </div>

              {/* Two-column charge details */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-1">
                {/* Left column */}
                {renderDateField('dateOfCharge', 'Date of Charge')}
                {/* Right column */}
                {renderDateField('interestFrom', 'Interest From')}

                {/* Department dropdown */}
                <div className="flex items-center gap-2">
                  <Label className="w-[110px] shrink-0 text-xs font-semibold text-foreground">Department</Label>
                  <Select value={formData.department || undefined} onValueChange={handleDepartmentChange}>
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent className="!z-[9999]" position="popper" sideOffset={4}>
                      {DEPARTMENT_OPTIONS.map(opt => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Interest Rate */}
                {renderPercentageField('interestRate', 'Interest Rate')}

                {/* Category dependent dropdown */}
                <div className="flex items-center gap-2">
                  <Label className="w-[110px] shrink-0 text-xs font-semibold text-foreground">Category</Label>
                  <Select value={formData.category || undefined} onValueChange={handleCategoryChange} disabled={categoryOptions.length === 0}>
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue placeholder={categoryOptions.length === 0 ? 'Select department first' : 'Select...'} />
                    </SelectTrigger>
                    <SelectContent className="!z-[9999]" position="popper" sideOffset={4}>
                      {categoryOptions.map(opt => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Original Balance */}
                {renderCurrencyField('originalAmount', 'Original Balance')}

                {/* Details dependent dropdown */}
                <div className="flex items-center gap-2">
                  <Label className="w-[110px] shrink-0 text-xs font-semibold text-foreground">Details</Label>
                  <Select value={formData.details || undefined} onValueChange={(val) => handleFieldChange('details', val)} disabled={detailsOptions.length === 0}>
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue placeholder={!formData.category ? 'Select category first' : detailsOptions.length === 0 ? '--' : 'Select...'} />
                    </SelectTrigger>
                    <SelectContent className="!z-[9999]" position="popper" sideOffset={4}>
                      {detailsOptions.map(opt => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Current Balance */}
                {renderCurrencyField('currentBalance', 'Current Balance')}

                {/* Notes */}
                <div className="flex items-center gap-2">
                  <Label className="w-[110px] shrink-0 text-xs font-semibold text-foreground">Notes</Label>
                  <Textarea value={formData.notes} onChange={(e) => handleFieldChange('notes', e.target.value)} className="text-xs min-h-[40px] flex-1" />
                </div>
                {/* Accrued Interest */}
                {renderCurrencyField('accruedInterest', 'Accrued Interest')}

                {/* Empty left cell for alignment */}
                <div />
                {/* Balance Due as of */}
                {renderDateField('balanceDueAsOf', 'Balance Due as of')}

                {/* Empty left cell */}
                <div />
                {/* Balance Due */}
                {renderCurrencyField('balanceDue', 'Balance Due')}
              </div>
            </div>

            {/* ─── Section: Distribution ─── */}
            <div>
              <div className="bg-primary/10 border border-primary/20 rounded px-2 py-1 mb-2">
                <span className="font-semibold text-xs text-primary">Distribution</span>
              </div>

              {/* Advanced By subsection */}
              <div className="mb-3">
                <div className="bg-muted/60 border border-border rounded px-2 py-1 mb-2">
                  <span className="font-semibold text-xs text-foreground">Advanced By</span>
                </div>
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="grid grid-cols-[1fr_1fr_120px_1fr] bg-muted/50 border-b border-border">
                    <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">CUSTOMER ID</div>
                    <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">NAME</div>
                    <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">DEFERRED</div>
                    <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">AMOUNT</div>
                  </div>
                  <div className="grid grid-cols-[1fr_1fr_120px_1fr] border-b border-border items-center">
                    <div className="px-1.5 py-1">
                      <div className="relative">
                        <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                        <Input value={formData.advancedByAccount} onChange={(e) => handleFieldChange('advancedByAccount', e.target.value)} className="h-6 text-xs pl-6" placeholder="Search" />
                      </div>
                    </div>
                    <div className="px-1.5 py-1"><Input value={formData.advancedByLenderName} onChange={(e) => handleFieldChange('advancedByLenderName', e.target.value)} className="h-6 text-xs" /></div>
                    <div className="px-1.5 py-1">
                      <Select value={formData.advancedByDeferred || undefined} onValueChange={(val) => handleFieldChange('advancedByDeferred', val)}>
                        <SelectTrigger className="h-6 text-xs">
                          <SelectValue placeholder="Y/N" />
                        </SelectTrigger>
                        <SelectContent className="!z-[9999]" position="popper" sideOffset={4}>
                          <SelectItem value="Y">Y</SelectItem>
                          <SelectItem value="N">N</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="px-1.5 py-1">
                      <div className="relative">
                        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span>
                        <Input inputMode="decimal" value={focusedCurrencyField === 'advancedByAmount' ? formData.advancedByAmount : formatCurrencyDisplay(formData.advancedByAmount)} onFocus={() => { setFocusedCurrencyField('advancedByAmount'); handleFieldChange('advancedByAmount', unformatCurrencyDisplay(formData.advancedByAmount)); }} onBlur={() => setFocusedCurrencyField(null)} onChange={(e) => handleFieldChange('advancedByAmount', e.target.value)} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (v) => handleFieldChange('advancedByAmount', v))} className="h-6 text-xs pl-4" placeholder="0.00" />
                      </div>
                    </div>
                  </div>
                  {/* Total row */}
                  <div className="grid grid-cols-[1fr_1fr_120px_1fr] items-center">
                    <div />
                    <div />
                    <div className="px-2 py-1 text-xs font-semibold text-foreground text-right">Total</div>
                    <div className="px-1.5 py-1">
                      <div className="relative">
                        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span>
                        <Input inputMode="decimal" value={focusedCurrencyField === 'advancedByTotal' ? formData.advancedByTotal : formatCurrencyDisplay(formData.advancedByTotal)} onFocus={() => { setFocusedCurrencyField('advancedByTotal'); handleFieldChange('advancedByTotal', unformatCurrencyDisplay(formData.advancedByTotal)); }} onBlur={() => setFocusedCurrencyField(null)} onChange={(e) => handleFieldChange('advancedByTotal', e.target.value)} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (v) => handleFieldChange('advancedByTotal', v))} className="h-6 text-xs pl-4" placeholder="0.00" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* On Behalf Of subsection */}
              <div>
                <div className="bg-muted/60 border border-border rounded px-2 py-1 mb-2">
                  <span className="font-semibold text-xs text-foreground">On Behalf Of</span>
                </div>
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="grid grid-cols-[1fr_1fr_120px_1fr] bg-muted/50 border-b border-border">
                    <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">CUSTOMER ID</div>
                    <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">NAME</div>
                    <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">BILLING</div>
                    <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">AMOUNT</div>
                  </div>
                  <div className="grid grid-cols-[1fr_1fr_120px_1fr] border-b border-border items-center">
                    <div className="px-1.5 py-1">
                      <div className="relative">
                        <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                        <Input value={formData.onBehalfOfAccount} onChange={(e) => handleFieldChange('onBehalfOfAccount', e.target.value)} className="h-6 text-xs pl-6" placeholder="Search" />
                      </div>
                    </div>
                    <div className="px-1.5 py-1"><Input value={formData.onBehalfOfLenderName} onChange={(e) => handleFieldChange('onBehalfOfLenderName', e.target.value)} className="h-6 text-xs" /></div>
                    <div className="px-1.5 py-1">
                      <Select value={formData.onBehalfOfBilling || undefined} onValueChange={(val) => handleFieldChange('onBehalfOfBilling', val)}>
                        <SelectTrigger className="h-6 text-xs">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent className="!z-[9999]" position="popper" sideOffset={4}>
                          {BILLING_OPTIONS.map(opt => (
                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="px-1.5 py-1">
                      <div className="relative">
                        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span>
                        <Input inputMode="decimal" value={focusedCurrencyField === 'onBehalfOfAmount' ? formData.onBehalfOfAmount : formatCurrencyDisplay(formData.onBehalfOfAmount)} onFocus={() => { setFocusedCurrencyField('onBehalfOfAmount'); handleFieldChange('onBehalfOfAmount', unformatCurrencyDisplay(formData.onBehalfOfAmount)); }} onBlur={() => setFocusedCurrencyField(null)} onChange={(e) => handleFieldChange('onBehalfOfAmount', e.target.value)} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (v) => handleFieldChange('onBehalfOfAmount', v))} className="h-6 text-xs pl-4" placeholder="0.00" />
                      </div>
                    </div>
                  </div>
                  {/* Total row */}
                  <div className="grid grid-cols-[1fr_1fr_120px_1fr] items-center">
                    <div />
                    <div />
                    <div className="px-2 py-1 text-xs font-semibold text-foreground text-right">Total</div>
                    <div className="px-1.5 py-1">
                      <div className="relative">
                        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">$</span>
                        <Input inputMode="decimal" value={focusedCurrencyField === 'onBehalfOfTotal' ? formData.onBehalfOfTotal : formatCurrencyDisplay(formData.onBehalfOfTotal)} onFocus={() => { setFocusedCurrencyField('onBehalfOfTotal'); handleFieldChange('onBehalfOfTotal', unformatCurrencyDisplay(formData.onBehalfOfTotal)); }} onBlur={() => setFocusedCurrencyField(null)} onChange={(e) => handleFieldChange('onBehalfOfTotal', e.target.value)} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (v) => handleFieldChange('onBehalfOfTotal', v))} className="h-6 text-xs pl-4" placeholder="0.00" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-border pt-3">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveClick} disabled={!isFormFilled}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ModalSaveConfirmation open={showConfirm} onConfirm={handleConfirmSave} onCancel={() => setShowConfirm(false)} />
    </>
  );
};

export default ChargesModal;
