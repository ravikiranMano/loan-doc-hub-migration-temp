import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';
import { sanitizeInterestInput, normalizeInterestOnBlur } from '@/lib/interestValidation';
import { numericKeyDown, numericPaste, formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { CalendarIcon, Search } from 'lucide-react';
import { formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dateOnly';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ChargesDetailFormProps {
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  disabled?: boolean;
}

import { CHARGES_DETAIL_KEYS } from '@/lib/fieldKeyMap';

const FIELD_KEYS = CHARGES_DETAIL_KEYS;

import { DEPARTMENT_OPTIONS, getDepartmentCategories, getCategoryDetails } from '@/lib/chargesCategoryData';

const BILLING_OPTIONS = ['Short Payment', 'Debit All Outgoing', 'Credit Card', 'Invoice / Link'];

const safeParse = (v: string): Date | undefined => {
  if (!v) return undefined;
  try {
    const d = parse(v, 'yyyy-MM-dd', new Date());
    if (isValid(d)) return d;
    const d2 = new Date(v);
    return isValid(d2) ? d2 : undefined;
  } catch { return undefined; }
};

export const ChargesDetailForm: React.FC<ChargesDetailFormProps> = ({
  values,
  onValueChange,
  disabled = false,
}) => {
  const [datePickerStates, setDatePickerStates] = useState<Record<string, boolean>>({});

  const departmentVal = values[FIELD_KEYS.department] || '';
  const categoryVal = values[FIELD_KEYS.category] || '';
  const categoryOptions = departmentVal ? getDepartmentCategories(departmentVal) : [];
  const detailsOptions = (departmentVal && categoryVal) ? getCategoryDetails(departmentVal, categoryVal) : [];

  const handleDepartmentChange = (val: string) => {
    onValueChange(FIELD_KEYS.department, val);
    onValueChange(FIELD_KEYS.category, '');
    onValueChange(FIELD_KEYS.details, '');
  };

  const handleCategoryChange = (val: string) => {
    onValueChange(FIELD_KEYS.category, val);
    onValueChange(FIELD_KEYS.details, '');
  };

  const renderDateField = (key: string, label: string) => {
    const val = values[key] || '';
    return (
      <DirtyFieldWrapper fieldKey={key}>
        <div className="flex items-center gap-3">
          <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">{label}</Label>
          <Popover open={datePickerStates[key] || false} onOpenChange={(open) => setDatePickerStates(prev => ({ ...prev, [key]: open }))}>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn('h-7 text-sm flex-1 justify-start text-left font-normal', !val && 'text-muted-foreground')} disabled={disabled}>
                {val && safeParse(val) ? formatDateOnly(safeParse(val), 'MM/dd/yyyy') : 'MM/DD/YYYY'}
                <CalendarIcon className="ml-auto h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 z-[9999]" align="start">
              <EnhancedCalendar mode="single" selected={safeParse(val)} onSelect={(date) => { if (date) onValueChange(key, formatDateOnly(date)); setDatePickerStates(prev => ({ ...prev, [key]: false })); }} onClear={() => { onValueChange(key, ''); setDatePickerStates(prev => ({ ...prev, [key]: false })); }} onToday={() => { onValueChange(key, todayDateOnly()); setDatePickerStates(prev => ({ ...prev, [key]: false })); }} initialFocus />
            </PopoverContent>
          </Popover>
        </div>
      </DirtyFieldWrapper>
    );
  };

  const renderTextField = (key: string, label: string, placeholder = '') => {
    const isAccountField = key === FIELD_KEYS.account;
    return (
      <DirtyFieldWrapper fieldKey={key}>
        <div className="flex items-center gap-3">
          <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">{label}</Label>
          <Input 
            value={values[key] || ''} 
            onChange={(e) => {
              // Block negative sign for account number field
              if (isAccountField && e.target.value.includes('-')) {
                toast.error('Account Number cannot be negative');
                return;
              }
              onValueChange(key, e.target.value);
            }} 
            disabled={disabled} 
            className="h-7 text-sm flex-1" 
            placeholder={placeholder} 
          />
        </div>
      </DirtyFieldWrapper>
    );
  };

  const renderCurrencyField = (key: string, label: string) => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center gap-3">
        <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">{label}</Label>
        <div className="relative flex-1">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
          <Input type="text" inputMode="decimal" value={values[key] || ''} onChange={(e) => onValueChange(key, unformatCurrencyDisplay(e.target.value))} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (val) => onValueChange(key, val))} onBlur={() => { const raw = values[key] || ''; if (raw) onValueChange(key, formatCurrencyDisplay(raw)); }} onFocus={() => { const raw = values[key] || ''; if (raw) onValueChange(key, unformatCurrencyDisplay(raw)); }} disabled={disabled} className="h-7 text-sm pl-6" placeholder="0.00" />
        </div>
      </div>
    </DirtyFieldWrapper>
  );

  const renderSelectField = (key: string, label: string, options: string[], selectDisabled = false, placeholder = 'Select...') => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center gap-3">
        <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">{label}</Label>
        <Select value={values[key] || undefined} onValueChange={(val) => onValueChange(key, val)} disabled={disabled || selectDisabled}>
          <SelectTrigger className="h-7 text-sm flex-1">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent className="z-[9999]">
            {options.map(opt => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </DirtyFieldWrapper>
  );

  return (
    <div className="space-y-4">
      {/* ─── Section: $ Charges ─── */}
      <div>
        <div className="bg-primary/10 border border-primary/20 rounded px-3 py-1.5 mb-3">
          <span className="font-semibold text-sm text-primary">$ Charges</span>
        </div>

        {/* Top row: Account Number + Borrower Name */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 px-1 mb-2">
          {renderTextField(FIELD_KEYS.account, 'Account Number', 'Enter account')}
          {renderTextField(FIELD_KEYS.borrowerFullName, 'Borrower Name', 'Enter name')}
        </div>

        {/* Two-column charge details - same order as modal */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 px-1">
          {/* Row 1 */}
          {renderDateField(FIELD_KEYS.dateOfCharge, 'Date of Charge')}
          {renderDateField(FIELD_KEYS.interestFrom, 'Interest From')}

          {/* Row 2: Department + Interest Rate */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.department}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Department</Label>
              <Select value={departmentVal || undefined} onValueChange={handleDepartmentChange} disabled={disabled}>
                <SelectTrigger className="h-7 text-sm flex-1">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent className="z-[9999]">
                  {DEPARTMENT_OPTIONS.map(opt => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.interestRate}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Interest Rate</Label>
              <div className="relative flex-1">
                <Input inputMode="decimal" value={values[FIELD_KEYS.interestRate] || ''} onChange={(e) => onValueChange(FIELD_KEYS.interestRate, sanitizeInterestInput(e.target.value))} onBlur={() => { const v = normalizeInterestOnBlur(values[FIELD_KEYS.interestRate] || '', 3); if (v !== (values[FIELD_KEYS.interestRate] || '')) onValueChange(FIELD_KEYS.interestRate, v); }} disabled={disabled} className="h-7 text-sm pr-6" placeholder="0.00" />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
            </div>
          </DirtyFieldWrapper>

          {/* Row 3: Category + Original Balance */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.category}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Category</Label>
              <Select value={categoryVal || undefined} onValueChange={handleCategoryChange} disabled={disabled || categoryOptions.length === 0}>
                <SelectTrigger className="h-7 text-sm flex-1">
                  <SelectValue placeholder={categoryOptions.length === 0 ? 'Select department first' : 'Select...'} />
                </SelectTrigger>
                <SelectContent className="z-[9999]">
                  {categoryOptions.map(opt => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>
          {renderCurrencyField(FIELD_KEYS.originalAmount, 'Original Balance')}

          {/* Row 4: Details + Current Balance */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.details}>
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0">Details</Label>
              <Select value={values[FIELD_KEYS.details] || undefined} onValueChange={(val) => onValueChange(FIELD_KEYS.details, val)} disabled={disabled || detailsOptions.length === 0}>
                <SelectTrigger className="h-7 text-sm flex-1">
                  <SelectValue placeholder={!categoryVal ? 'Select category first' : detailsOptions.length === 0 ? '--' : 'Select...'} />
                </SelectTrigger>
                <SelectContent className="z-[9999]">
                  {detailsOptions.map(opt => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>
          {renderCurrencyField(FIELD_KEYS.currentBalance, 'Current Balance')}

          {/* Row 5: Notes + Accrued Interest */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.notes}>
            <div className="flex items-start gap-3">
              <Label className="text-sm text-muted-foreground min-w-[120px] text-left shrink-0 pt-2">Notes</Label>
              <Textarea value={values[FIELD_KEYS.notes] || ''} onChange={(e) => onValueChange(FIELD_KEYS.notes, e.target.value)} disabled={disabled} className="text-sm min-h-[50px] flex-1" placeholder="Enter notes" />
            </div>
          </DirtyFieldWrapper>
          {renderCurrencyField(FIELD_KEYS.accruedInterest, 'Accrued Interest')}

          {/* Row 6: empty + Balance Due as of */}
          <div />
          {renderDateField(FIELD_KEYS.balanceDueAsOf, 'Balance Due as of')}

          {/* Row 7: empty + Balance Due */}
          <div />
          {renderCurrencyField(FIELD_KEYS.balanceDue, 'Balance Due')}
        </div>
      </div>

      {/* ─── Section: Distribution ─── */}
      <div>
        <div className="bg-primary/10 border border-primary/20 rounded px-3 py-1.5 mb-3">
          <span className="font-semibold text-sm text-primary">Distribution</span>
        </div>

        {/* Advanced By subsection */}
        <div className="px-1 mb-3">
          <div className="bg-muted/60 border border-border rounded px-2 py-1 mb-2">
            <span className="font-semibold text-xs text-foreground">Advanced By</span>
          </div>
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1fr_1fr_120px_1fr] bg-muted/50 border-b border-border">
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground">CUSTOMER ID</div>
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground">NAME</div>
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground">DEFERRED</div>
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground">AMOUNT</div>
            </div>
            <div className="grid grid-cols-[1fr_1fr_120px_1fr] border-b border-border items-center">
              <DirtyFieldWrapper fieldKey={FIELD_KEYS.advancedByAccount}>
                <div className="px-2 py-1.5">
                  <div className="relative">
                    <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    <Input value={values[FIELD_KEYS.advancedByAccount] || ''} onChange={(e) => onValueChange(FIELD_KEYS.advancedByAccount, e.target.value)} disabled={disabled} className="h-7 text-sm pl-6" placeholder="Search" />
                  </div>
                </div>
              </DirtyFieldWrapper>
              <DirtyFieldWrapper fieldKey={FIELD_KEYS.advancedByLenderName}>
                <div className="px-2 py-1.5"><Input value={values[FIELD_KEYS.advancedByLenderName] || ''} onChange={(e) => onValueChange(FIELD_KEYS.advancedByLenderName, e.target.value)} disabled={disabled} className="h-7 text-sm" /></div>
              </DirtyFieldWrapper>
              <DirtyFieldWrapper fieldKey={FIELD_KEYS.advancedByDeferred}>
                <div className="px-2 py-1.5">
                  <Select value={values[FIELD_KEYS.advancedByDeferred] || undefined} onValueChange={(val) => onValueChange(FIELD_KEYS.advancedByDeferred, val)} disabled={disabled}>
                    <SelectTrigger className="h-7 text-sm">
                      <SelectValue placeholder="Y/N" />
                    </SelectTrigger>
                    <SelectContent className="z-[9999]">
                      <SelectItem value="Y">Y</SelectItem>
                      <SelectItem value="N">N</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </DirtyFieldWrapper>
              <DirtyFieldWrapper fieldKey={FIELD_KEYS.advancedByAmount}>
                <div className="px-2 py-1.5">
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <Input type="text" inputMode="decimal" value={values[FIELD_KEYS.advancedByAmount] || ''} onChange={(e) => onValueChange(FIELD_KEYS.advancedByAmount, unformatCurrencyDisplay(e.target.value))} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (val) => onValueChange(FIELD_KEYS.advancedByAmount, val))} onBlur={() => { const raw = values[FIELD_KEYS.advancedByAmount] || ''; if (raw) onValueChange(FIELD_KEYS.advancedByAmount, formatCurrencyDisplay(raw)); }} onFocus={() => { const raw = values[FIELD_KEYS.advancedByAmount] || ''; if (raw) onValueChange(FIELD_KEYS.advancedByAmount, unformatCurrencyDisplay(raw)); }} disabled={disabled} className="h-7 text-sm pl-6" placeholder="0.00" />
                  </div>
                </div>
              </DirtyFieldWrapper>
            </div>
            {/* Total row */}
            <div className="grid grid-cols-[1fr_1fr_120px_1fr] items-center">
              <div />
              <div />
              <div className="px-3 py-2 text-sm font-semibold text-foreground text-right">Total</div>
              <DirtyFieldWrapper fieldKey={FIELD_KEYS.advancedByTotal}>
                <div className="px-2 py-1.5">
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <Input type="text" inputMode="decimal" value={values[FIELD_KEYS.advancedByTotal] || ''} onChange={(e) => onValueChange(FIELD_KEYS.advancedByTotal, unformatCurrencyDisplay(e.target.value))} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (val) => onValueChange(FIELD_KEYS.advancedByTotal, val))} onBlur={() => { const raw = values[FIELD_KEYS.advancedByTotal] || ''; if (raw) onValueChange(FIELD_KEYS.advancedByTotal, formatCurrencyDisplay(raw)); }} onFocus={() => { const raw = values[FIELD_KEYS.advancedByTotal] || ''; if (raw) onValueChange(FIELD_KEYS.advancedByTotal, unformatCurrencyDisplay(raw)); }} disabled={disabled} className="h-7 text-sm pl-6" placeholder="0.00" />
                  </div>
                </div>
              </DirtyFieldWrapper>
            </div>
          </div>
        </div>

        {/* On Behalf Of subsection */}
        <div className="px-1">
          <div className="bg-muted/60 border border-border rounded px-2 py-1 mb-2">
            <span className="font-semibold text-xs text-foreground">On Behalf Of</span>
          </div>
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1fr_1fr_120px_1fr] bg-muted/50 border-b border-border">
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground">CUSTOMER ID</div>
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground">NAME</div>
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground">BILLING</div>
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground">AMOUNT</div>
            </div>
            <div className="grid grid-cols-[1fr_1fr_120px_1fr] border-b border-border items-center">
              <DirtyFieldWrapper fieldKey={FIELD_KEYS.onBehalfOfAccount}>
                <div className="px-2 py-1.5">
                  <div className="relative">
                    <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    <Input value={values[FIELD_KEYS.onBehalfOfAccount] || ''} onChange={(e) => onValueChange(FIELD_KEYS.onBehalfOfAccount, e.target.value)} disabled={disabled} className="h-7 text-sm pl-6" placeholder="Search" />
                  </div>
                </div>
              </DirtyFieldWrapper>
              <DirtyFieldWrapper fieldKey={FIELD_KEYS.onBehalfOfLenderName}>
                <div className="px-2 py-1.5"><Input value={values[FIELD_KEYS.onBehalfOfLenderName] || ''} onChange={(e) => onValueChange(FIELD_KEYS.onBehalfOfLenderName, e.target.value)} disabled={disabled} className="h-7 text-sm" /></div>
              </DirtyFieldWrapper>
              <DirtyFieldWrapper fieldKey={FIELD_KEYS.onBehalfOfBilling}>
                <div className="px-2 py-1.5">
                  <Select value={values[FIELD_KEYS.onBehalfOfBilling] || undefined} onValueChange={(val) => onValueChange(FIELD_KEYS.onBehalfOfBilling, val)} disabled={disabled}>
                    <SelectTrigger className="h-7 text-sm">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent className="z-[9999]">
                      {BILLING_OPTIONS.map(opt => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </DirtyFieldWrapper>
              <DirtyFieldWrapper fieldKey={FIELD_KEYS.onBehalfOfAmount}>
                <div className="px-2 py-1.5">
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <Input type="text" inputMode="decimal" value={values[FIELD_KEYS.onBehalfOfAmount] || ''} onChange={(e) => onValueChange(FIELD_KEYS.onBehalfOfAmount, unformatCurrencyDisplay(e.target.value))} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (val) => onValueChange(FIELD_KEYS.onBehalfOfAmount, val))} onBlur={() => { const raw = values[FIELD_KEYS.onBehalfOfAmount] || ''; if (raw) onValueChange(FIELD_KEYS.onBehalfOfAmount, formatCurrencyDisplay(raw)); }} onFocus={() => { const raw = values[FIELD_KEYS.onBehalfOfAmount] || ''; if (raw) onValueChange(FIELD_KEYS.onBehalfOfAmount, unformatCurrencyDisplay(raw)); }} disabled={disabled} className="h-7 text-sm pl-6" placeholder="0.00" />
                  </div>
                </div>
              </DirtyFieldWrapper>
            </div>
            {/* Total row */}
            <div className="grid grid-cols-[1fr_1fr_120px_1fr] items-center">
              <div />
              <div />
              <div className="px-3 py-2 text-sm font-semibold text-foreground text-right">Total</div>
              <DirtyFieldWrapper fieldKey={FIELD_KEYS.onBehalfOfTotal}>
                <div className="px-2 py-1.5">
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <Input type="text" inputMode="decimal" value={values[FIELD_KEYS.onBehalfOfTotal] || ''} onChange={(e) => onValueChange(FIELD_KEYS.onBehalfOfTotal, unformatCurrencyDisplay(e.target.value))} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (val) => onValueChange(FIELD_KEYS.onBehalfOfTotal, val))} onBlur={() => { const raw = values[FIELD_KEYS.onBehalfOfTotal] || ''; if (raw) onValueChange(FIELD_KEYS.onBehalfOfTotal, formatCurrencyDisplay(raw)); }} onFocus={() => { const raw = values[FIELD_KEYS.onBehalfOfTotal] || ''; if (raw) onValueChange(FIELD_KEYS.onBehalfOfTotal, unformatCurrencyDisplay(raw)); }} disabled={disabled} className="h-7 text-sm pl-6" placeholder="0.00" />
                  </div>
                </div>
              </DirtyFieldWrapper>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChargesDetailForm;
