import React from 'react';
import { Input } from '@/components/ui/input';
import { EmailInput } from '@/components/ui/email-input';
import { PhoneInput } from '@/components/ui/phone-input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { CalendarIcon } from 'lucide-react';
import { format, parse } from 'date-fns';
import { cn } from '@/lib/utils';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';
import { numericKeyDown, numericPaste, integerKeyDown, integerPaste, formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';
import type { CalculationResult } from '@/lib/calculationEngine';

interface OriginationApplicationFormProps {
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

const FIELD_KEYS = {
  // Borrower
  dob: 'origination_app.borrower.dob',
  occupation: 'origination_app.borrower.occupation',
  employer: 'origination_app.borrower.employer',
  employed_since: 'origination_app.borrower.employed_since',
  contact: 'origination_app.borrower.contact',
  phone: 'origination_app.borrower.phone',
  email: 'origination_app.borrower.email',
  filed_bankruptcy: 'origination_app.borrower.filed_bankruptcy',
  discharged: 'origination_app.borrower.discharged',
  credit_score: 'origination_app.borrower.credit_score',
  extra_label_1: 'origination_app.borrower.extra_label_1',
  extra_value_1: 'origination_app.borrower.extra_value_1',
  extra_label_2: 'origination_app.borrower.extra_label_2',
  extra_value_2: 'origination_app.borrower.extra_value_2',
  info_provided_by: 'origination_app.borrower.info_provided_by',
  source_of_information: 'origination_app.borrower.source_of_information',
  is_borrower_also_broker: 'origination_app.borrower.is_borrower_also_broker',
  employer_contact_name: 'origination_app.borrower.employer_contact_name',

  // Gross Monthly Income
  income_salary: 'origination_app.income.salary',
  income_interest: 'origination_app.income.interest',
  income_dividend: 'origination_app.income.dividend',
  income_rental: 'origination_app.income.rental',
  income_other: 'origination_app.income.other',

  // Gross Monthly Expenses
  expense_credit_card: 'origination_app.expense.credit_card',
  expense_mortgage: 'origination_app.expense.mortgage',
  expense_spousal_child_support: 'origination_app.expense.spousal_child_support',
  expense_insurance: 'origination_app.expense.insurance',
  expense_automobile: 'origination_app.expense.automobile',
  expense_other: 'origination_app.expense.other',

  // Document Request
  doc_balance_sheet: 'origination_app.doc.balance_sheet_received',
  doc_balance_sheet_2: 'origination_app.doc.balance_sheet_reviewed',
  doc_income_statement: 'origination_app.doc.income_statement_received',
  doc_income_statement_2: 'origination_app.doc.income_statement_reviewed',
  doc_audited_financials: 'origination_app.doc.audited_financials',
  doc_audited_financials_2: 'origination_app.doc.audited_financials_reviewed',
  doc_periods_reviewed: 'origination_app.doc.periods_reviewed',
  is_broker_borrower_yes: 'origination_app.doc.is_broker_also_borrower_yes',
  is_broker_borrower_no: 'origination_app.doc.is_broker_also_borrower_no',
  doc_additional_info: 'origination_app.doc.additional_info_attached',

  // Financials (additive — extends existing Application area)
  fin_bank_statements_yn: 'origination_app.financials.bank_statements_yn',
  fin_bank_statements_status: 'origination_app.financials.bank_statements_status',
  fin_balance_sheet_pl_yn: 'origination_app.financials.balance_sheet_pl_yn',
  fin_balance_sheet_pl_assurance: 'origination_app.financials.balance_sheet_pl_assurance',
  fin_balance_sheet_pl_status: 'origination_app.financials.balance_sheet_pl_status',
  fin_balance_sheet_as_of_date: 'origination_app.financials.balance_sheet_as_of_date',
  fin_pl_period_begin: 'origination_app.financials.pl_period_begin',
  fin_pl_period_end: 'origination_app.financials.pl_period_end',
  fin_performed_by: 'origination_app.financials.performed_by',
  fin_rent_rolls_leases_yn: 'origination_app.financials.rent_rolls_leases_yn',
  fin_rent_rolls_leases_status: 'origination_app.financials.rent_rolls_leases_status',
};

const STATUS_OPTIONS = ['Requested', 'Partially Received', 'Received'];
const ASSURANCE_OPTIONS = ['Unaudited', 'Audited'];
const PERFORMED_BY_OPTIONS = ['Borrower', 'CPA', 'Other'];

// Additional rows: 8 rows with text + 2 checkboxes each
const ADDITIONAL_ROWS = Array.from({ length: 8 }, (_, i) => ({
  text: `origination_app.doc.additional_row_${i + 1}_text`,
  check1: `origination_app.doc.additional_row_${i + 1}_check1`,
  check2: `origination_app.doc.additional_row_${i + 1}_check2`,
}));

export const OriginationApplicationForm: React.FC<OriginationApplicationFormProps> = ({
  values,
  onValueChange,
  disabled = false,
}) => {
  const getValue = (key: string) => values[key] || '';
  const setValue = (key: string, value: string) => onValueChange(key, value);
  const getBoolValue = (key: string) => values[key] === 'true';
  const setBoolValue = (key: string, value: boolean) => onValueChange(key, String(value));
  const [datePickerStates, setDatePickerStates] = React.useState<Record<string, boolean>>({});
  const parseDate = (val: string): Date | undefined => {
    if (!val) return undefined;
    try { return parse(val, 'yyyy-MM-dd', new Date()); } catch { return undefined; }
  };

  const renderDatePicker = (label: string, key: string) => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center gap-2">
        <Label className="w-[140px] text-sm shrink-0">{label}</Label>
        <Popover open={datePickerStates[key] || false} onOpenChange={(open) => setDatePickerStates(prev => ({ ...prev, [key]: open }))}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn('h-7 w-full justify-start text-left font-normal text-sm', !getValue(key) && 'text-muted-foreground')}
              disabled={disabled}
            >
              {getValue(key) ? format(parseDate(getValue(key))!, 'MM/dd/yyyy') : 'MM/DD/YYYY'}
              <CalendarIcon className="ml-auto h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 z-[9999]" align="start">
            <EnhancedCalendar
              mode="single"
              selected={parseDate(getValue(key))}
              onSelect={(date) => { if (date) setValue(key, format(date, 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, [key]: false })); }}
              onClear={() => { setValue(key, ''); setDatePickerStates(prev => ({ ...prev, [key]: false })); }}
              onToday={() => { setValue(key, format(new Date(), 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, [key]: false })); }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
    </DirtyFieldWrapper>
  );

  const renderTextField = (label: string, key: string) => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center gap-2">
        <Label className="w-[140px] text-sm shrink-0">{label}</Label>
        <Input
          value={getValue(key)}
          onChange={(e) => setValue(key, e.target.value)}
          disabled={disabled}
          className="h-7 text-sm"
        />
      </div>
    </DirtyFieldWrapper>
  );

  const renderCurrencyField = (label: string, key: string) => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center gap-2">
        <Label className="w-[140px] text-sm shrink-0">{label}</Label>
        <div className="relative flex-1">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
          <Input
            type="text"
            inputMode="decimal"
            value={getValue(key)}
            onChange={(e) => setValue(key, unformatCurrencyDisplay(e.target.value))}
            onKeyDown={numericKeyDown}
            onPaste={(e) => numericPaste(e, (val) => setValue(key, val))}
            onBlur={() => { const raw = getValue(key); if (raw) setValue(key, formatCurrencyDisplay(raw)); }}
            onFocus={() => { const raw = getValue(key); if (raw) setValue(key, unformatCurrencyDisplay(raw)); }}
            disabled={disabled}
            placeholder="0.00"
            className="h-7 text-sm pl-6 text-left"
          />
        </div>
      </div>
    </DirtyFieldWrapper>
  );

  const renderCheckboxField = (label: string, key: string) => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center gap-2">
        <Checkbox
          checked={getBoolValue(key)}
          onCheckedChange={(checked) => setBoolValue(key, !!checked)}
          disabled={disabled}
        />
        <Label className="text-sm cursor-pointer">{label}</Label>
      </div>
    </DirtyFieldWrapper>
  );

  const renderDualCheckboxField = (label: string, key1: string, key2: string) => (
    <DirtyFieldWrapper fieldKey={key1}>
      <div className="flex items-center gap-2">
        <Label className="text-sm shrink-0 flex-1">{label}</Label>
        <Checkbox
          checked={getBoolValue(key1)}
          onCheckedChange={(checked) => setBoolValue(key1, !!checked)}
          disabled={disabled}
        />
        <Checkbox
          checked={getBoolValue(key2)}
          onCheckedChange={(checked) => setBoolValue(key2, !!checked)}
          disabled={disabled}
        />
      </div>
    </DirtyFieldWrapper>
  );

  const renderLabelInputPair = (labelKey: string, valueKey: string) => (
    <DirtyFieldWrapper fieldKey={valueKey}>
      <div className="flex items-center gap-2">
        <Input
          value={getValue(labelKey)}
          onChange={(e) => setValue(labelKey, e.target.value)}
          disabled={disabled}
          className="h-7 text-sm w-[140px] shrink-0"
        />
        <Input
          value={getValue(valueKey)}
          onChange={(e) => setValue(valueKey, e.target.value)}
          disabled={disabled}
          className="h-7 text-sm"
        />
      </div>
    </DirtyFieldWrapper>
  );

  const renderAdditionalDocRow = (row: typeof ADDITIONAL_ROWS[0]) => (
    <DirtyFieldWrapper fieldKey={row.text} key={row.text}>
      <div className="flex items-center gap-2">
        <Input
          value={getValue(row.text)}
          onChange={(e) => setValue(row.text, e.target.value)}
          disabled={disabled}
          className="h-7 text-sm flex-1"
        />
        <Checkbox
          checked={getBoolValue(row.check1)}
          onCheckedChange={(checked) => setBoolValue(row.check1, !!checked)}
          disabled={disabled}
        />
        <Checkbox
          checked={getBoolValue(row.check2)}
          onCheckedChange={(checked) => setBoolValue(row.check2, !!checked)}
          disabled={disabled}
        />
      </div>
    </DirtyFieldWrapper>
  );

  const renderYNToggle = (label: string, key: string) => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center gap-2">
        <Label className="w-[180px] text-sm shrink-0">{label}</Label>
        <Switch
          checked={getBoolValue(key)}
          onCheckedChange={(checked) => setBoolValue(key, !!checked)}
          disabled={disabled}
        />
      </div>
    </DirtyFieldWrapper>
  );

  const renderDropdownField = (label: string, key: string, options: string[]) => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center gap-2">
        <Label className="w-[180px] text-sm shrink-0">{label}</Label>
        <Select
          value={getValue(key) || undefined}
          onValueChange={(val) => setValue(key, val)}
          disabled={disabled}
        >
          <SelectTrigger className="h-7 text-sm flex-1">
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent className="z-[9999]">
            {options.map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </DirtyFieldWrapper>
  );

  const renderFinancialsDatePicker = (label: string, key: string) => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center gap-2">
        <Label className="w-[180px] text-sm shrink-0">{label}</Label>
        <Popover open={datePickerStates[key] || false} onOpenChange={(open) => setDatePickerStates(prev => ({ ...prev, [key]: open }))}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn('h-7 flex-1 justify-start text-left font-normal text-sm', !getValue(key) && 'text-muted-foreground')}
              disabled={disabled}
            >
              {getValue(key) ? format(parseDate(getValue(key))!, 'MM/dd/yyyy') : 'MM/DD/YYYY'}
              <CalendarIcon className="ml-auto h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 z-[9999]" align="start">
            <EnhancedCalendar
              mode="single"
              selected={parseDate(getValue(key))}
              onSelect={(date) => { if (date) setValue(key, format(date, 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, [key]: false })); }}
              onClear={() => { setValue(key, ''); setDatePickerStates(prev => ({ ...prev, [key]: false })); }}
              onToday={() => { setValue(key, format(new Date(), 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, [key]: false })); }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
    </DirtyFieldWrapper>
  );

  return (
    <div className="p-4 space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-6">
        {/* Column 1: Borrower */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">Borrower</h3>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.info_provided_by}>
            <div className="flex items-center gap-2">
              <Label className="w-[140px] text-sm shrink-0">Information Provided By</Label>
              <Select
                value={getValue(FIELD_KEYS.info_provided_by) || undefined}
                onValueChange={(val) => setValue(FIELD_KEYS.info_provided_by, val)}
                disabled={disabled}
              >
                <SelectTrigger className="h-7 text-sm flex-1">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="z-[9999]">
                  <SelectItem value="Broker">Broker</SelectItem>
                  <SelectItem value="Borrower">Borrower</SelectItem>
                  <SelectItem value="Lender">Lender</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.source_of_information}>
            <div className="flex items-center gap-2">
              <Label className="w-[140px] text-sm shrink-0">Source of Information</Label>
              <Select
                value={getValue(FIELD_KEYS.source_of_information) || undefined}
                onValueChange={(val) => setValue(FIELD_KEYS.source_of_information, val)}
                disabled={disabled}
              >
                <SelectTrigger className="h-7 text-sm flex-1">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="z-[9999]">
                  <SelectItem value="Borrower">Borrower</SelectItem>
                  <SelectItem value="Broker">Broker</SelectItem>
                  <SelectItem value="Credit Report">Credit Report</SelectItem>
                  <SelectItem value="Third Party">Third Party</SelectItem>
                  <SelectItem value="Internal Referral">Internal Referral</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.is_borrower_also_broker}>
            <div className="flex items-center gap-2">
              <Label className="w-[140px] text-sm shrink-0">Is Borrower also the Broker</Label>
              <Select
                value={getValue(FIELD_KEYS.is_borrower_also_broker) || undefined}
                onValueChange={(val) => setValue(FIELD_KEYS.is_borrower_also_broker, val)}
                disabled={disabled}
              >
                <SelectTrigger className="h-7 text-sm flex-1">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="z-[9999]">
                  <SelectItem value="Yes">Yes</SelectItem>
                  <SelectItem value="No">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>
          {renderDatePicker('DOB', FIELD_KEYS.dob)}
          {renderTextField('Occupation', FIELD_KEYS.occupation)}
          {renderTextField('Employer', FIELD_KEYS.employer)}
          {renderDatePicker('Employed Since', FIELD_KEYS.employed_since)}
          {renderTextField('Employer Contact Name', FIELD_KEYS.employer_contact_name)}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.contact}>
            <div className="flex items-center gap-2">
              <Label className="w-[140px] text-sm shrink-0">Contact</Label>
              <PhoneInput value={getValue(FIELD_KEYS.contact)} onValueChange={(val) => setValue(FIELD_KEYS.contact, val)} disabled={disabled} className="h-7 text-sm" />
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.phone}>
            <div className="flex items-center gap-2">
              <Label className="w-[140px] text-sm shrink-0">Phone</Label>
              <PhoneInput value={getValue(FIELD_KEYS.phone)} onValueChange={(val) => setValue(FIELD_KEYS.phone, val)} disabled={disabled} className="h-7 text-sm" />
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.email}>
            <div className="flex items-center gap-2">
              <Label className="w-[140px] text-sm shrink-0">Email</Label>
              <EmailInput value={getValue(FIELD_KEYS.email)} onValueChange={(val) => setValue(FIELD_KEYS.email, val)} disabled={disabled} className="h-7 text-sm" />
            </div>
          </DirtyFieldWrapper>
          <div className="pt-1 space-y-2">
            {renderCheckboxField('Filed for Bankruptcy (12 Months)', FIELD_KEYS.filed_bankruptcy)}
            {renderCheckboxField('Discharged?', FIELD_KEYS.discharged)}
          </div>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.credit_score}>
            <div className="flex items-center gap-2">
              <Label className="w-[140px] text-sm shrink-0">Credit Score</Label>
              <Input
                value={getValue(FIELD_KEYS.credit_score)}
                onChange={(e) => setValue(FIELD_KEYS.credit_score, e.target.value)}
                onKeyDown={integerKeyDown}
                onPaste={(e) => integerPaste(e, (val) => setValue(FIELD_KEYS.credit_score, val))}
                disabled={disabled}
                inputMode="numeric"
                maxLength={3}
                className="h-7 text-sm"
              />
            </div>
          </DirtyFieldWrapper>
        </div>

        {/* Column 2: Income & Expenses */}
        <div className="space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">Gross Monthly Income</h3>
            {renderCurrencyField('Salary', FIELD_KEYS.income_salary)}
            {renderCurrencyField('Interest', FIELD_KEYS.income_interest)}
            {renderCurrencyField('Dividend', FIELD_KEYS.income_dividend)}
            {renderCurrencyField('Rental', FIELD_KEYS.income_rental)}
            {renderCurrencyField('Other', FIELD_KEYS.income_other)}
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">Gross Monthly Expenses</h3>
            {renderCurrencyField('Credit Card', FIELD_KEYS.expense_credit_card)}
            {renderCurrencyField('Mortgage', FIELD_KEYS.expense_mortgage)}
            {renderCurrencyField('Spousal / Child Support', FIELD_KEYS.expense_spousal_child_support)}
            {renderCurrencyField('Insurance', FIELD_KEYS.expense_insurance)}
            {renderCurrencyField('Automobile', FIELD_KEYS.expense_automobile)}
            {renderCurrencyField('Other', FIELD_KEYS.expense_other)}
          </div>
        </div>

        {/* Column 3: Financials */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">Financials</h3>
          {renderYNToggle('Bank Statements', FIELD_KEYS.fin_bank_statements_yn)}
          {renderDropdownField('Status', FIELD_KEYS.fin_bank_statements_status, STATUS_OPTIONS)}
          {renderYNToggle('Balance Sheet / P&L', FIELD_KEYS.fin_balance_sheet_pl_yn)}
          {renderDropdownField('Assurance Level', FIELD_KEYS.fin_balance_sheet_pl_assurance, ASSURANCE_OPTIONS)}
          {renderDropdownField('Status', FIELD_KEYS.fin_balance_sheet_pl_status, STATUS_OPTIONS)}
          {renderFinancialsDatePicker('Balance Sheet as of Date', FIELD_KEYS.fin_balance_sheet_as_of_date)}
          {renderFinancialsDatePicker('P&L Period Begin', FIELD_KEYS.fin_pl_period_begin)}
          {renderFinancialsDatePicker('P&L Period End', FIELD_KEYS.fin_pl_period_end)}
          {renderDropdownField('Performed By', FIELD_KEYS.fin_performed_by, PERFORMED_BY_OPTIONS)}
          {renderYNToggle('Rent Rolls / Leases', FIELD_KEYS.fin_rent_rolls_leases_yn)}
          {renderDropdownField('Status', FIELD_KEYS.fin_rent_rolls_leases_status, STATUS_OPTIONS)}
          <div className="pt-2">
            {renderCheckboxField('Additional Information Attached', FIELD_KEYS.doc_additional_info)}
          </div>
        </div>

      </div>
    </div>
  );
};

export default OriginationApplicationForm;
