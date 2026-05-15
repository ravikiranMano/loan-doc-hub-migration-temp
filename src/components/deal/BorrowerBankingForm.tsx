import React, { useEffect, useState } from 'react';
import { MaskedInput } from '@/components/ui/masked-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { CalendarIcon } from 'lucide-react';
import { formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dateOnly';
import { cn } from '@/lib/utils';
import type { FieldDefinition } from '@/hooks/useDealFields';
import type { CalculationResult } from '@/lib/calculationEngine';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';
import { BORROWER_BANKING_KEYS } from '@/lib/fieldKeyMap';

const FIELD_KEYS = BORROWER_BANKING_KEYS;

interface BorrowerBankingFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

const ACH_STATUS_OPTIONS = ['Active', 'Inactive', 'Pending', 'Hold'];
const ACCOUNT_TYPE_OPTIONS = ['Personal Savings', 'Personal Checking', 'Business Savings', 'Business Checking'];
const NAME_TYPE_OPTIONS = ['Entity Name', 'Individual / Signer', 'Other'];
const DEBIT_AMOUNT_TYPE_OPTIONS = ['Regular Payment', 'Other'];
const STOP_DEBIT_OPTIONS = ['At Payoff', 'Payoff Demand Issued', 'One Month Prior to Maturity', 'On Date'];
const APPLY_DEBIT_TO_OPTIONS = ['Regular Payment', 'Reserve', 'Suspense', 'Charges'];
const DEBIT_FREQUENCY_OPTIONS = [
  'Once Only', 'Monthly', 'Quarterly', 'Bi-Monthly', 'Bi-Weekly', 'Weekly',
  'Every 15 Days', 'Twice Per Month', '15th and EOM', 'Semi-Yearly', 'Yearly',
];
const YES_NO_OPTIONS = ['Yes', 'No'];

export const BorrowerBankingForm: React.FC<BorrowerBankingFormProps> = ({
  values,
  onValueChange,
  disabled = false,
}) => {
  const getValue = (key: keyof typeof FIELD_KEYS): string => values[FIELD_KEYS[key]] || '';
  const getBoolValue = (key: keyof typeof FIELD_KEYS): boolean => values[FIELD_KEYS[key]] === 'true';
  const handleChange = (key: keyof typeof FIELD_KEYS, value: string | boolean) => {
    onValueChange(FIELD_KEYS[key], String(value));
  };

  useEffect(() => {
    if (!getValue('debitFrequency')) handleChange('debitFrequency', 'Once Only');
  }, []);

  const debitFrequency = getValue('debitFrequency') || 'Once Only';
  const isOnceOnly = debitFrequency === 'Once Only';
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [lastDebitedOpen, setLastDebitedOpen] = useState(false);
  const [nextDebitOpen, setNextDebitOpen] = useState(false);
  const [stopOnDateOpen, setStopOnDateOpen] = useState(false);

  const RowLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Label className="w-36 text-sm text-foreground flex-shrink-0">{children}</Label>
  );

  const DateField = ({
    fieldKey, value, onChange, open, setOpen,
  }: { fieldKey: string; value: string; onChange: (v: string) => void; open: boolean; setOpen: (b: boolean) => void; }) => (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn("h-8 text-sm flex-1 justify-start text-left font-normal", !value && "text-muted-foreground")}
        >
          {value ? formatDateOnly(parseDateOnly(value), 'MM/dd/yyyy') : 'MM/DD/YYYY'}
          <CalendarIcon className="ml-auto h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 bg-background z-50" align="start">
        <EnhancedCalendar
          mode="single"
          selected={parseDateOnly(value)}
          onSelect={(date) => { onChange(date ? formatDateOnly(date) : ''); setOpen(false); }}
          onClear={() => { onChange(''); setOpen(false); }}
          onToday={() => { onChange(todayDateOnly()); setOpen(false); }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="border-b border-border pb-2 mb-4">
        <span className="font-semibold text-base text-foreground">ACH Information</span>
      </div>

      <div className="grid grid-cols-2 gap-x-12 gap-y-4">
        {/* ============== Left Column ============== */}
        <div className="space-y-4">
          {/* ACH Status */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.achStatus}>
            <div className="flex items-center gap-4">
              <RowLabel>ACH Status</RowLabel>
              <Select value={getValue('achStatus') || undefined} onValueChange={(v) => handleChange('achStatus', v)} disabled={disabled}>
                <SelectTrigger className="h-8 text-sm flex-1"><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent className="bg-background z-50">
                  {ACH_STATUS_OPTIONS.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          {/* Bank Name */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.bankName}>
            <div className="flex items-center gap-4">
              <RowLabel>Bank Name</RowLabel>
              <Input value={getValue('bankName')} onChange={(e) => handleChange('bankName', e.target.value)} disabled={disabled} className="h-8 text-sm flex-1" />
            </div>
          </DirtyFieldWrapper>

          {/* Routing Number */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.routingNumber}>
            <div className="flex items-center gap-4">
              <RowLabel>Routing Number</RowLabel>
              <MaskedInput
                value={getValue('routingNumber')}
                onChange={(e) => handleChange('routingNumber', e.target.value.replace(/\D/g, '').slice(0, 9))}
                disabled={disabled} placeholder="•••••••••" maxLength={9} inputMode="numeric"
              />
            </div>
          </DirtyFieldWrapper>

          {/* Account Number */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.accountNumber}>
            <div className="flex items-center gap-4">
              <RowLabel>Account Number</RowLabel>
              <MaskedInput
                value={getValue('accountNumber')}
                onChange={(e) => handleChange('accountNumber', e.target.value.replace(/\D/g, '').slice(0, 17))}
                disabled={disabled} placeholder="••••••••••••" maxLength={17} inputMode="numeric"
              />
            </div>
          </DirtyFieldWrapper>

          {/* Account Type */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.accountType}>
            <div className="flex items-center gap-4">
              <RowLabel>Account Type</RowLabel>
              <Select value={getValue('accountType') || undefined} onValueChange={(v) => handleChange('accountType', v)} disabled={disabled}>
                <SelectTrigger className="h-8 text-sm flex-1"><SelectValue placeholder="Select account type" /></SelectTrigger>
                <SelectContent className="bg-background z-50">
                  {ACCOUNT_TYPE_OPTIONS.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          {/* ID */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.idField}>
            <div className="flex items-center gap-4">
              <RowLabel>ID</RowLabel>
              <Input value={getValue('idField')} onChange={(e) => handleChange('idField', e.target.value)} disabled={disabled} className="h-8 text-sm flex-1" />
            </div>
          </DirtyFieldWrapper>

          {/* Name (dropdown) */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.nameType}>
            <div className="flex items-center gap-4">
              <RowLabel>Name</RowLabel>
              <Select value={getValue('nameType') || undefined} onValueChange={(v) => handleChange('nameType', v)} disabled={disabled}>
                <SelectTrigger className="h-8 text-sm flex-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="bg-background z-50">
                  {NAME_TYPE_OPTIONS.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          {/* Name - Other text input (only when Other selected) */}
          {getValue('nameType') === 'Other' && (
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.nameOther}>
              <div className="flex items-center gap-4">
                <RowLabel>Name (Other)</RowLabel>
                <Input value={getValue('nameOther')} onChange={(e) => handleChange('nameOther', e.target.value)} disabled={disabled} className="h-8 text-sm flex-1" placeholder="Enter name" />
              </div>
            </DirtyFieldWrapper>
          )}
        </div>

        {/* ============== Right Column ============== */}
        <div className="space-y-4">
          {/* Start Debit Date */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.startDebitDate}>
            <div className="flex items-center gap-4">
              <RowLabel>Start Debit Date</RowLabel>
              <DateField fieldKey={FIELD_KEYS.startDebitDate} value={getValue('startDebitDate')} onChange={(v) => handleChange('startDebitDate', v)} open={startDateOpen} setOpen={setStartDateOpen} />
            </div>
          </DirtyFieldWrapper>

          {/* Stop Debit (dropdown) */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.stopDebit}>
            <div className="flex items-center gap-4">
              <RowLabel>Stop Debit</RowLabel>
              <Select value={getValue('stopDebit') || undefined} onValueChange={(v) => handleChange('stopDebit', v)} disabled={disabled}>
                <SelectTrigger className="h-8 text-sm flex-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="bg-background z-50">
                  {STOP_DEBIT_OPTIONS.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          {/* Stop Debit - On Date picker (only when On Date selected) */}
          {getValue('stopDebit') === 'On Date' && (
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.stopDebitOnDate}>
              <div className="flex items-center gap-4">
                <RowLabel>Stop Date</RowLabel>
                <DateField fieldKey={FIELD_KEYS.stopDebitOnDate} value={getValue('stopDebitOnDate')} onChange={(v) => handleChange('stopDebitOnDate', v)} open={stopOnDateOpen} setOpen={setStopOnDateOpen} />
              </div>
            </DirtyFieldWrapper>
          )}

          {/* Debit Amount (dropdown: Regular Payment / Other) */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.debitAmountType}>
            <div className="flex items-center gap-4">
              <RowLabel>Debit Amount</RowLabel>
              <Select value={getValue('debitAmountType') || undefined} onValueChange={(v) => handleChange('debitAmountType', v)} disabled={disabled}>
                <SelectTrigger className="h-8 text-sm flex-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="bg-background z-50">
                  {DEBIT_AMOUNT_TYPE_OPTIONS.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          {/* Debit Amount - Other ($ text box, only when Other selected) */}
          {getValue('debitAmountType') === 'Other' && (
            <DirtyFieldWrapper fieldKey={FIELD_KEYS.debitAmount}>
              <div className="flex items-center gap-4">
                <RowLabel>Amount ($)</RowLabel>
                <div className="relative flex-1">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
                  <Input
                    value={getValue('debitAmount')}
                    onChange={(e) => handleChange('debitAmount', e.target.value.replace(/[^\d.]/g, ''))}
                    disabled={disabled} className="h-8 text-sm pl-6" placeholder="0.00" inputMode="decimal"
                  />
                </div>
              </div>
            </DirtyFieldWrapper>
          )}

          {/* Frequency */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.debitFrequency}>
            <div className="flex items-center gap-4">
              <RowLabel>Frequency</RowLabel>
              <Select value={debitFrequency} onValueChange={(v) => handleChange('debitFrequency', v)} disabled={disabled}>
                <SelectTrigger className="h-8 text-sm flex-1"><SelectValue placeholder="Select frequency" /></SelectTrigger>
                <SelectContent className="bg-background z-50">
                  {DEBIT_FREQUENCY_OPTIONS.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          {/* Debit Due Day */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.debitDueDay}>
            <div className="flex items-center gap-4">
              <RowLabel>Debit Due Day</RowLabel>
              <Input
                value={getValue('debitDueDay')}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  const num = parseInt(val, 10);
                  if (val === '' || (num >= 1 && num <= 31)) handleChange('debitDueDay', val);
                }}
                disabled={disabled || isOnceOnly}
                className={cn("h-8 text-sm flex-1", isOnceOnly && "bg-muted opacity-50")}
                placeholder={isOnceOnly ? "N/A" : "1-31"}
                inputMode="numeric"
              />
            </div>
          </DirtyFieldWrapper>

          {/* Apply Debit To */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.applyDebitTo}>
            <div className="flex items-center gap-4">
              <RowLabel>Apply Debit To</RowLabel>
              <Select value={getValue('applyDebitTo') || undefined} onValueChange={(v) => handleChange('applyDebitTo', v)} disabled={disabled}>
                <SelectTrigger className="h-8 text-sm flex-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="bg-background z-50">
                  {APPLY_DEBIT_TO_OPTIONS.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>

          {/* Last Debited On */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.lastDebitedOn}>
            <div className="flex items-center gap-4">
              <RowLabel>Last Debited On</RowLabel>
              <DateField fieldKey={FIELD_KEYS.lastDebitedOn} value={getValue('lastDebitedOn')} onChange={(v) => handleChange('lastDebitedOn', v)} open={lastDebitedOpen} setOpen={setLastDebitedOpen} />
            </div>
          </DirtyFieldWrapper>

          {/* Next Debit */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.nextDebitDate}>
            <div className="flex items-center gap-4">
              <RowLabel>Next Debit</RowLabel>
              <DateField fieldKey={FIELD_KEYS.nextDebitDate} value={getValue('nextDebitDate')} onChange={(v) => handleChange('nextDebitDate', v)} open={nextDebitOpen} setOpen={setNextDebitOpen} />
            </div>
          </DirtyFieldWrapper>

          {/* Resubmit NSF */}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.resubmitNsf}>
            <div className="flex items-center gap-4">
              <RowLabel>Resubmit NSF</RowLabel>
              <Select value={getValue('resubmitNsf') || undefined} onValueChange={(v) => handleChange('resubmitNsf', v)} disabled={disabled}>
                <SelectTrigger className="h-8 text-sm flex-1"><SelectValue placeholder="Yes / No" /></SelectTrigger>
                <SelectContent className="bg-background z-50">
                  {YES_NO_OPTIONS.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>
        </div>
      </div>

      {/* Disable Online Payment */}
      <div className="pt-4 border-t border-border">
        <DirtyFieldWrapper fieldKey={FIELD_KEYS.disableOnlinePayment}>
          <div className="flex items-center gap-2">
            <Checkbox
              id="disable-online-payment"
              checked={getBoolValue('disableOnlinePayment')}
              onCheckedChange={(checked) => handleChange('disableOnlinePayment', !!checked)}
              disabled={disabled}
              className="h-4 w-4"
            />
            <Label htmlFor="disable-online-payment" className="text-sm font-semibold text-foreground">Disable Online Payment</Label>
          </div>
        </DirtyFieldWrapper>
      </div>
    </div>
  );
};

export default BorrowerBankingForm;
