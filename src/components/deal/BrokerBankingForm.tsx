import React, { useState, useCallback, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { ExpirationInput } from '@/components/ui/expiration-input';
import { EmailInput } from '@/components/ui/email-input';
import { ZipInput } from '@/components/ui/zip-input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { MaskedInput } from '@/components/ui/masked-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  maskCardNumber,
} from '@/lib/bankingValidation';

import { BROKER_BANKING_KEYS } from '@/lib/fieldKeyMap';

const FIELD_KEYS = BROKER_BANKING_KEYS;

interface BrokerBankingFormProps {
  disabled?: boolean;
  values?: Record<string, string>;
  onValueChange?: (fieldKey: string, value: string) => void;
}

export const BrokerBankingForm: React.FC<BrokerBankingFormProps> = ({ 
  disabled = false,
  values = {},
  onValueChange,
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
    if (onValueChange) {
      onValueChange(FIELD_KEYS[key], String(value));
    }
  };

  const markTouched = useCallback((key: string) => {
    setTouched(prev => ({ ...prev, [key]: true }));
  }, []);

  const isTouched = (key: keyof typeof FIELD_KEYS) => touched[key] === true;

  const byCheckEnabled = getBoolValue('byCheck');

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

    if (byCheckEnabled) {
      if (!getValue('checkAddress')) e.checkAddress = 'Address is required';
      const city = getValue('checkCity');
      if (!city) e.checkCity = 'City is required';
      else if (!validateAlphaOnly(city)) e.checkCity = 'Alphabets only';
    }

    const ccName = getValue('ccName');
    if (ccName && !validateAlphaOnly(ccName)) e.ccName = 'Enter card holder name (letters only)';

    const ccNum = getValue('ccNumber');
    if (ccNum && !validateCardLuhn(ccNum)) e.ccNumber = 'Enter valid card number';

    const cvv = getValue('ccSecurityCode');
    if (cvv && !validateCVV(cvv)) e.ccSecurityCode = 'Enter valid CVV (3–4 digits)';

    const exp = getValue('ccExpiration');
    if (exp && exp.length === 5 && !validateExpirationFuture(exp)) e.ccExpiration = 'Enter valid future expiration date';

    // Duplicate ACH email check
    const email1 = getValue('achEmail');
    // Broker form only has 1 ACH email field in current keys, but validate if present
    return e;
  }, [values]);

  const showErr = (key: keyof typeof FIELD_KEYS) => isTouched(key) && errors[key];
  const errorText = (key: keyof typeof FIELD_KEYS) =>
    showErr(key) ? <span className="text-[10px] text-destructive mt-0.5">{errors[key]}</span> : null;

  const renderField = (key: keyof typeof FIELD_KEYS, label: string, props: Record<string, any> = {}) => (
    <DirtyFieldWrapper fieldKey={FIELD_KEYS[key]}>
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground min-w-[120px] max-w-[120px] text-left shrink-0">{label}</Label>
          {key === 'routingNumber' || key === 'accountNumber' ? (
            <MaskedInput
              value={getValue(key)}
              onChange={(e) => handleChange(key, stripNonNumeric(e.target.value))}
              onBlur={() => markTouched(key)}
              disabled={disabled}
              className="w-[160px] 3xl:w-[200px]"
              maxLength={key === 'routingNumber' ? 9 : 17}
              {...props}
            />
          ) : key === 'ccExpiration' ? (
            <ExpirationInput value={getValue(key)} onValueChange={(v) => { handleChange(key, v); if (v.length === 5) markTouched(key); }} disabled={disabled} className="w-[160px] 3xl:w-[200px]" />
          ) : (
            <Input value={getValue(key)} onChange={(e) => handleChange(key, e.target.value)} onBlur={() => markTouched(key)} disabled={disabled} className="h-8 text-sm w-[160px] 3xl:w-[200px]" {...props} />
          )}
        </div>
        {errorText(key)}
      </div>
    </DirtyFieldWrapper>
  );

  return (
    <div className="space-y-4 overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Column 1 - ACH Section */}
        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-foreground border-b border-border pb-2">Bank / ACH</h3>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.achStatus}>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground min-w-[120px] max-w-[120px] text-left shrink-0">ACH Status</Label>
              <Select value={getValue('achStatus')} onValueChange={(v) => handleChange('achStatus', v)} disabled={disabled}>
                <SelectTrigger className="h-8 w-[160px] 3xl:w-[200px]"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>
          {renderField('bank', 'Bank', { placeholder: 'Enter bank name', maxLength: 100 })}
          {renderField('routingNumber', 'Routing Number', { placeholder: 'Enter routing' })}
          {renderField('accountNumber', 'Account Number', { placeholder: 'Enter account' })}
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.accountType}>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground min-w-[120px] max-w-[120px] text-left shrink-0">Type</Label>
              <Select value={getValue('accountType')} onValueChange={(v) => handleChange('accountType', v)} disabled={disabled}>
                <SelectTrigger className="h-8 w-[160px] 3xl:w-[200px]"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Personal Banking">Personal Banking</SelectItem>
                  <SelectItem value="Business Banking">Business Banking</SelectItem>
                  <SelectItem value="Personal Checking">Personal Checking</SelectItem>
                  <SelectItem value="Business Checking">Business Checking</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.accountName}>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground min-w-[120px] max-w-[120px] text-left shrink-0">Name</Label>
                <Input value={getValue('accountName')} onChange={(e) => { const v = e.target.value; if (!v || validateAlphaOnly(v)) handleChange('accountName', v); }} onBlur={() => markTouched('accountName')} disabled={disabled} className="h-8 text-sm w-[160px] 3xl:w-[200px]" placeholder="Enter name" />
              </div>
              {errorText('accountName')}
            </div>
          </DirtyFieldWrapper>
          {renderField('accountId', 'ID', { placeholder: 'Enter ID' })}
          {renderField('furtherCreditTo', 'Further Credit To', { placeholder: 'Enter info', maxLength: 100 })}
        </div>

        {/* Column 2 - Check/Mailing Section */}
        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-foreground border-b border-border pb-2">Check / Mailing</h3>
          
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.byCheck}>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground min-w-[120px] max-w-[120px] text-left shrink-0">By Check</Label>
              <div className="w-[160px] 3xl:w-[200px] flex items-center">
                <Checkbox id="byCheck" checked={byCheckEnabled} onCheckedChange={(checked) => handleChange('byCheck', !!checked)} disabled={disabled} />
              </div>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.checkSameAsMailing}>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground min-w-[120px] max-w-[120px] text-left shrink-0">Same as Mailing</Label>
              <div className="w-[160px] 3xl:w-[200px] flex items-center">
                <Checkbox id="checkSameAsMailing" checked={getBoolValue('checkSameAsMailing')} onCheckedChange={(checked) => {
                  const isChecked = !!checked;
                  handleChange('checkSameAsMailing', isChecked);
                  if (isChecked) {
                    handleChange('checkAddress', values['broker.mailing.street'] || '');
                    handleChange('checkCity', values['broker.mailing.city'] || '');
                    handleChange('checkZip', values['broker.mailing.zip'] || '');
                  } else {
                    handleChange('checkAddress', '');
                    handleChange('checkCity', '');
                    handleChange('checkZip', '');
                  }
                }} disabled={disabled || !byCheckEnabled} />
              </div>
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.checkOther}>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground min-w-[120px] max-w-[120px] text-left shrink-0">Other</Label>
              <Input value={getValue('checkOther')} onChange={(e) => handleChange('checkOther', e.target.value)} disabled={disabled || !byCheckEnabled} className="h-8 text-sm w-[160px] 3xl:w-[200px]" placeholder="Enter other" />
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.checkAddress}>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground min-w-[120px] max-w-[120px] text-left shrink-0">Address</Label>
                <Input value={getValue('checkAddress')} onChange={(e) => handleChange('checkAddress', e.target.value)} onBlur={() => markTouched('checkAddress')} disabled={disabled || !byCheckEnabled} className="h-8 text-sm w-[160px] 3xl:w-[200px]" placeholder="Enter address" />
              </div>
              {errorText('checkAddress')}
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.checkCity}>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground min-w-[120px] max-w-[120px] text-left shrink-0">City</Label>
                <Input value={getValue('checkCity')} onChange={(e) => { const v = e.target.value; if (!v || validateAlphaOnly(v)) handleChange('checkCity', v); }} onBlur={() => markTouched('checkCity')} disabled={disabled || !byCheckEnabled} className="h-8 text-sm w-[160px] 3xl:w-[200px]" placeholder="Enter city" />
              </div>
              {errorText('checkCity')}
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.checkZip}>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground min-w-[120px] max-w-[120px] text-left shrink-0">Zip Code</Label>
              <div className="w-[160px] 3xl:w-[200px]">
                <ZipInput value={getValue('checkZip')} onValueChange={(v) => handleChange('checkZip', v)} disabled={disabled || !byCheckEnabled} />
              </div>
            </div>
          </DirtyFieldWrapper>

        </div>

        {/* Column 3 - Credit Card Section */}
        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-foreground border-b border-border pb-2">Credit Card</h3>
          <DirtyFieldWrapper fieldKey={FIELD_KEYS.ccName}>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground min-w-[120px] max-w-[120px] text-left shrink-0">Cardholder Name</Label>
                <Input value={getValue('ccName')} onChange={(e) => { const v = e.target.value; if (!v || validateAlphaOnly(v)) handleChange('ccName', v); }} onBlur={() => markTouched('ccName')} disabled={disabled} className="h-8 text-sm w-[160px] 3xl:w-[200px]" placeholder="Enter name" />
              </div>
              {errorText('ccName')}
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.ccNumber}>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground min-w-[120px] max-w-[120px] text-left shrink-0">Card Number</Label>
                <Input
                  value={focusedField === 'ccNumber' ? getValue('ccNumber') : (getValue('ccNumber') ? maskCardNumber(getValue('ccNumber')) : '')}
                  onChange={(e) => { const v = stripNonNumeric(e.target.value); if (v.length <= 19) handleChange('ccNumber', v); }}
                  onFocus={() => setFocusedField('ccNumber')}
                  onBlur={() => { setFocusedField(null); markTouched('ccNumber'); }}
                  disabled={disabled}
                  className="h-8 text-sm w-[160px] 3xl:w-[200px]"
                  maxLength={19}
                  inputMode="numeric"
                  placeholder="Enter card number"
                />
              </div>
              {errorText('ccNumber')}
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.ccSecurityCode}>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground min-w-[120px] max-w-[120px] text-left shrink-0">Security Code</Label>
                <Input
                  value={getValue('ccSecurityCode')}
                  onChange={(e) => { const v = stripNonNumeric(e.target.value); if (v.length <= 4) handleChange('ccSecurityCode', v); }}
                  onBlur={() => markTouched('ccSecurityCode')}
                  disabled={disabled}
                  className="h-8 text-sm w-[160px] 3xl:w-[200px]"
                  maxLength={4}
                  type="password"
                  placeholder="CVV"
                />
              </div>
              {errorText('ccSecurityCode')}
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.ccExpiration}>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground min-w-[120px] max-w-[120px] text-left shrink-0">Expiration</Label>
                <ExpirationInput value={getValue('ccExpiration')} onValueChange={(v) => { handleChange('ccExpiration', v); if (v.length === 5) markTouched('ccExpiration'); }} disabled={disabled} className="w-[160px] 3xl:w-[200px]" />
              </div>
              {errorText('ccExpiration')}
            </div>
          </DirtyFieldWrapper>

          <DirtyFieldWrapper fieldKey={FIELD_KEYS.ccZip}>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground min-w-[120px] max-w-[120px] text-left shrink-0">Zip Code</Label>
              <div className="w-[160px] 3xl:w-[200px]">
                <ZipInput value={getValue('ccZip')} onValueChange={(v) => handleChange('ccZip', v)} disabled={disabled} />
              </div>
            </div>
          </DirtyFieldWrapper>
        </div>
      </div>
    </div>
  );
};

export default BrokerBankingForm;
