import React, { useState, useCallback, useMemo } from 'react';
import { MaskedInput } from '@/components/ui/masked-input';
import { Input } from '@/components/ui/input';
import { ExpirationInput } from '@/components/ui/expiration-input';
import { EmailInput } from '@/components/ui/email-input';
import { ZipInput } from '@/components/ui/zip-input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FieldDefinition } from '@/hooks/useDealFields';
import type { CalculationResult } from '@/lib/calculationEngine';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';
import {
  validateRoutingNumber,
  validateAccountNumber,
  validateCardLuhn,
  validateCVV,
  validateExpirationFuture,
  validateAlphaOnly,
  validateBankName,
  stripNonNumeric,
  maskAccountNumber,
  maskCardNumber,
} from '@/lib/bankingValidation';

import { LENDER_BANKING_KEYS } from '@/lib/fieldKeyMap';

const FIELD_KEYS = LENDER_BANKING_KEYS;

interface LenderBankingFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

export const LenderBankingForm: React.FC<LenderBankingFormProps> = ({
  fields,
  values,
  onValueChange,
  showValidation = false,
  disabled = false,
  calculationResults = {},
}) => {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const getValue = (key: keyof typeof FIELD_KEYS): string => {
    return values[FIELD_KEYS[key]] || '';
  };

  const getBoolValue = (key: keyof typeof FIELD_KEYS): boolean => {
    return values[FIELD_KEYS[key]] === 'true';
  };

  const handleChange = (key: keyof typeof FIELD_KEYS, value: string | boolean) => {
    onValueChange(FIELD_KEYS[key], String(value));
  };

  const markTouched = useCallback((key: string) => {
    setTouched(prev => ({ ...prev, [key]: true }));
  }, []);

  const isTouched = (key: keyof typeof FIELD_KEYS) => touched[key] === true;

  const byCheckEnabled = getBoolValue('byCheck');

  // Validation state
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    const bank = getValue('bank');
    if (bank && !validateBankName(bank)) e.bank = 'Bank name is required (max 100 chars)';

    const routing = getValue('routingNumber');
    if (routing && !validateRoutingNumber(routing)) e.routingNumber = 'Enter valid 9-digit routing number';

    const account = getValue('accountNumber');
    if (account && !validateAccountNumber(account)) e.accountNumber = 'Enter valid account number (6–17 digits)';

    const accName = getValue('accountName');
    if (accName && !validateAlphaOnly(accName)) e.accountName = 'Enter account holder name (letters only)';

    const furtherCredit = getValue('furtherCreditTo');
    if (furtherCredit && furtherCredit.length > 100) e.furtherCreditTo = 'Max 100 characters';

    // Check/Mailing conditional
    if (byCheckEnabled) {
      if (!getValue('checkAddress')) e.checkAddress = 'Address is required';
      const city = getValue('checkCity');
      if (!city) e.checkCity = 'City is required';
      else if (!validateAlphaOnly(city)) e.checkCity = 'Alphabets only';
    }

    // Credit card
    const ccName = getValue('ccName');
    if (ccName && !validateAlphaOnly(ccName)) e.ccName = 'Enter card holder name (letters only)';

    const ccNum = getValue('ccNumber');
    if (ccNum && !validateCardLuhn(ccNum)) e.ccNumber = 'Enter valid card number';

    const cvv = getValue('ccSecurityCode');
    if (cvv && !validateCVV(cvv)) e.ccSecurityCode = 'Enter valid CVV (3–4 digits)';

    const exp = getValue('ccExpiration');
    if (exp && exp.length === 5 && !validateExpirationFuture(exp)) e.ccExpiration = 'Enter valid future expiration date';

    // Duplicate ACH email
    const email1 = getValue('achEmail');
    const email2 = getValue('achEmail2');
    if (email1 && email2 && email1.trim().toLowerCase() === email2.trim().toLowerCase()) {
      e.achEmail2 = 'Duplicate email not allowed';
    }

    return e;
  }, [values]);

  const showErr = (key: keyof typeof FIELD_KEYS) => isTouched(key) && errors[key];

  const wrapField = (key: keyof typeof FIELD_KEYS, children: React.ReactNode) => (
    <DirtyFieldWrapper fieldKey={FIELD_KEYS[key]}>{children}</DirtyFieldWrapper>
  );

  const errorText = (key: keyof typeof FIELD_KEYS) =>
    showErr(key) ? <span className="text-[10px] text-destructive mt-0.5">{errors[key]}</span> : null;

  return (
    <div className="p-6 space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* ACH Section */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground border-b pb-2">Bank / ACH</h3>
          <div className="space-y-3">
            {wrapField('achStatus', <div className="grid grid-cols-2 gap-2 items-center">
              <Label className="text-sm text-muted-foreground">ACH Status</Label>
              <Select value={getValue('achStatus')} onValueChange={(v) => handleChange('achStatus', v)} disabled={disabled}>
                <SelectTrigger className="h-8"><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>)}

            {wrapField('bank', <div className="flex flex-col">
              <div className="grid grid-cols-2 gap-2 items-center">
                <Label className="text-sm text-muted-foreground">Bank</Label>
                <Input value={getValue('bank')} onChange={(e) => handleChange('bank', e.target.value)} onBlur={() => markTouched('bank')} disabled={disabled} className="h-8" maxLength={100} placeholder="Enter bank name" />
              </div>
              {errorText('bank')}
            </div>)}

            {wrapField('routingNumber', <div className="flex flex-col">
              <div className="grid grid-cols-2 gap-2 items-center">
                <Label className="text-sm text-muted-foreground">Routing Number</Label>
                <MaskedInput value={getValue('routingNumber')} onChange={(e) => handleChange('routingNumber', stripNonNumeric(e.target.value))} disabled={disabled} maxLength={9} inputMode="numeric" />
              </div>
              {isTouched('routingNumber') && errors.routingNumber && <span className="text-[10px] text-destructive mt-0.5">{errors.routingNumber}</span>}
            </div>)}

            {wrapField('accountNumber', <div className="flex flex-col">
              <div className="grid grid-cols-2 gap-2 items-center">
                <Label className="text-sm text-muted-foreground">Account Number</Label>
                <MaskedInput value={getValue('accountNumber')} onChange={(e) => handleChange('accountNumber', stripNonNumeric(e.target.value))} disabled={disabled} maxLength={17} inputMode="numeric" />
              </div>
              {errorText('accountNumber')}
            </div>)}

            {wrapField('accountType', <div className="grid grid-cols-2 gap-2 items-center">
              <Label className="text-sm text-muted-foreground">Type</Label>
              <Select value={getValue('accountType')} onValueChange={(value) => handleChange('accountType', value)} disabled={disabled}>
                <SelectTrigger className="h-8"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Personal Banking">Personal Banking</SelectItem>
                  <SelectItem value="Business Banking">Business Banking</SelectItem>
                  <SelectItem value="Personal Checking">Personal Checking</SelectItem>
                  <SelectItem value="Business Checking">Business Checking</SelectItem>
                </SelectContent>
              </Select>
            </div>)}

            {wrapField('accountName', <div className="flex flex-col">
              <div className="grid grid-cols-2 gap-2 items-center">
                <Label className="text-sm text-muted-foreground">Name</Label>
                <Input value={getValue('accountName')} onChange={(e) => { const v = e.target.value; if (!v || validateAlphaOnly(v)) handleChange('accountName', v); }} onBlur={() => markTouched('accountName')} disabled={disabled} className="h-8" placeholder="Enter name" />
              </div>
              {errorText('accountName')}
            </div>)}

            {wrapField('accountId', <div className="grid grid-cols-2 gap-2 items-center">
              <Label className="text-sm text-muted-foreground">ID</Label>
              <Input value={getValue('accountId')} onChange={(e) => handleChange('accountId', e.target.value)} disabled={disabled} className="h-8" placeholder="Enter ID" />
            </div>)}

            {wrapField('furtherCreditTo', <div className="flex flex-col">
              <div className="grid grid-cols-2 gap-2 items-center">
                <Label className="text-sm text-muted-foreground">Further Credit To</Label>
                <Input value={getValue('furtherCreditTo')} onChange={(e) => handleChange('furtherCreditTo', e.target.value)} onBlur={() => markTouched('furtherCreditTo')} disabled={disabled} className="h-8" maxLength={100} placeholder="Enter info" />
              </div>
              {errorText('furtherCreditTo')}
            </div>)}
          </div>
        </div>

        {/* Check/Mailing Section */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground border-b pb-2">Check / Mailing</h3>
          <div className="space-y-3">
            {wrapField('byCheck', <div className="grid grid-cols-2 gap-2 items-center">
              <Label className="text-sm text-muted-foreground">By Check</Label>
              <Checkbox checked={byCheckEnabled} onCheckedChange={(checked) => handleChange('byCheck', !!checked)} disabled={disabled} />
            </div>)}

            {wrapField('checkSameAsMailing', <div className="grid grid-cols-2 gap-2 items-center">
              <Label className="text-sm text-muted-foreground">Same as Mailing</Label>
              <Checkbox checked={getBoolValue('checkSameAsMailing')} onCheckedChange={(checked) => {
                const isChecked = !!checked;
                handleChange('checkSameAsMailing', isChecked);
                if (isChecked) {
                  handleChange('checkAddress', values['lender.mailing.street'] || '');
                  handleChange('checkCity', values['lender.mailing.city'] || '');
                  handleChange('checkZip', values['lender.mailing.zip'] || '');
                } else {
                  handleChange('checkAddress', '');
                  handleChange('checkCity', '');
                  handleChange('checkZip', '');
                }
              }} disabled={disabled || !byCheckEnabled} />
            </div>)}

            {wrapField('checkOther', <div className="grid grid-cols-2 gap-2 items-center">
              <Label className="text-sm text-muted-foreground">Other</Label>
              <Input value={getValue('checkOther')} onChange={(e) => handleChange('checkOther', e.target.value)} disabled={disabled || !byCheckEnabled} className="h-8" placeholder="Enter other" />
            </div>)}

            {wrapField('checkAddress', <div className="flex flex-col">
              <div className="grid grid-cols-2 gap-2 items-center">
                <Label className="text-sm text-muted-foreground">Address</Label>
                <Input value={getValue('checkAddress')} onChange={(e) => handleChange('checkAddress', e.target.value)} onBlur={() => markTouched('checkAddress')} disabled={disabled || !byCheckEnabled} className="h-8" placeholder="Enter address" />
              </div>
              {errorText('checkAddress')}
            </div>)}

            {wrapField('checkCity', <div className="flex flex-col">
              <div className="grid grid-cols-2 gap-2 items-center">
                <Label className="text-sm text-muted-foreground">City</Label>
                <Input value={getValue('checkCity')} onChange={(e) => { const v = e.target.value; if (!v || validateAlphaOnly(v)) handleChange('checkCity', v); }} onBlur={() => markTouched('checkCity')} disabled={disabled || !byCheckEnabled} className="h-8" placeholder="Enter city" />
              </div>
              {errorText('checkCity')}
            </div>)}

            {wrapField('checkZip', <div className="grid grid-cols-2 gap-2 items-center">
              <Label className="text-sm text-muted-foreground">Zip Code</Label>
              <ZipInput value={getValue('checkZip')} onValueChange={(v) => handleChange('checkZip', v)} disabled={disabled || !byCheckEnabled} />
            </div>)}
          </div>

        </div>

        {/* Credit Card Section */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground border-b pb-2">Credit Card</h3>
          <div className="space-y-3">
            {wrapField('ccName', <div className="flex flex-col">
              <div className="grid grid-cols-2 gap-2 items-center">
                <Label className="text-sm text-muted-foreground">Cardholder Name</Label>
                <Input value={getValue('ccName')} onChange={(e) => { const v = e.target.value; if (!v || validateAlphaOnly(v)) handleChange('ccName', v); }} onBlur={() => markTouched('ccName')} disabled={disabled} className="h-8" placeholder="Enter name" />
              </div>
              {errorText('ccName')}
            </div>)}

            {wrapField('ccNumber', <div className="flex flex-col">
              <div className="grid grid-cols-2 gap-2 items-center">
                <Label className="text-sm text-muted-foreground">Card Number</Label>
                <div className="relative flex-1">
                  <Input
                    value={focusedField === 'ccNumber' ? getValue('ccNumber') : (getValue('ccNumber') ? maskCardNumber(getValue('ccNumber')) : '')}
                    onChange={(e) => { const v = stripNonNumeric(e.target.value); if (v.length <= 19) handleChange('ccNumber', v); }}
                    onFocus={() => setFocusedField('ccNumber')}
                    onBlur={() => { setFocusedField(null); markTouched('ccNumber'); }}
                    disabled={disabled}
                    className="h-8 text-sm"
                    maxLength={19}
                    inputMode="numeric"
                    placeholder="Enter card number"
                  />
                </div>
              </div>
              {errorText('ccNumber')}
            </div>)}

            {wrapField('ccSecurityCode', <div className="flex flex-col">
              <div className="grid grid-cols-2 gap-2 items-center">
                <Label className="text-sm text-muted-foreground">Security Code</Label>
                <Input
                  value={getValue('ccSecurityCode')}
                  onChange={(e) => { const v = stripNonNumeric(e.target.value); if (v.length <= 4) handleChange('ccSecurityCode', v); }}
                  onBlur={() => markTouched('ccSecurityCode')}
                  disabled={disabled}
                  className="h-8"
                  maxLength={4}
                  type="password"
                  placeholder="CVV"
                />
              </div>
              {errorText('ccSecurityCode')}
            </div>)}

            {wrapField('ccExpiration', <div className="flex flex-col">
              <div className="grid grid-cols-2 gap-2 items-center">
                <Label className="text-sm text-muted-foreground">Expiration</Label>
                <ExpirationInput value={getValue('ccExpiration')} onValueChange={(v) => { handleChange('ccExpiration', v); if (v.length === 5) markTouched('ccExpiration'); }} disabled={disabled} />
              </div>
              {errorText('ccExpiration')}
            </div>)}

            {wrapField('ccZip', <div className="grid grid-cols-2 gap-2 items-center">
              <Label className="text-sm text-muted-foreground">Zip Code</Label>
              <ZipInput value={getValue('ccZip')} onValueChange={(v) => handleChange('ccZip', v)} disabled={disabled} />
            </div>)}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LenderBankingForm;
