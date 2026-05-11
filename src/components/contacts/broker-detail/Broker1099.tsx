import React, { useState, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { US_STATES } from '@/lib/usStates';
import { ZipInput } from '@/components/ui/zip-input';
import { MaskedInput } from '@/components/ui/masked-input';
import {
  formatTIN, maskTIN, validateTIN, stripTINInput,
  formatSSN, formatEIN,
} from '@/lib/tinValidation';
import { maskAccountNumber } from '@/lib/bankingValidation';

interface Broker1099Props {
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  onSave: () => Promise<void>;
  disabled?: boolean;
}

const Broker1099: React.FC<Broker1099Props> = ({ values, onValueChange, onSave, disabled = false }) => {
  // ── Local state from parent values ──
  const [designatedRecipient, setDesignatedRecipient] = useState(values['broker.1099.designated_recipient'] || '');
  const [name, setName] = useState(values['broker.1099.name'] || '');
  const [address, setAddress] = useState(values['broker.1099.address'] || '');
  const [city, setCity] = useState(values['broker.1099.city'] || values['broker.city'] || '');
  const [state, setState] = useState(values['broker.1099.state'] || values['broker.state'] || '');
  const [zip, setZip] = useState(values['broker.1099.zip'] || values['broker.primary_address.zip'] || '');
  const [accountNumber, setAccountNumber] = useState(values['broker.1099.account_number'] || '');
  const [tinType, setTinType] = useState<'SSN' | 'EIN'>((values['broker.1099.tin_type'] as any) || 'SSN');
  const [tinRaw, setTinRaw] = useState(values['broker.1099.tin'] || values['broker.tin'] || '');
  const [send1099, setSend1099] = useState(values['broker.1099.send_1099'] === 'true');

  // ── Masking state ──
  const [tinFocused, setTinFocused] = useState(false);
  const [acctFocused, setAcctFocused] = useState(false);

  // ── Validation state ──
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const markTouched = (f: string) => setTouched(p => ({ ...p, [f]: true }));

  // ── Sync to parent ──
  const sync = (key: string, value: string) => onValueChange(`broker.1099.${key}`, value);

  // ── Auto-populate on designated recipient change ──
  useEffect(() => {
    if (designatedRecipient === 'Broker') {
      const n = values['broker.full_name'] || values['broker.company'] || '';
      const a = values['broker.primary_address.street'] || '';
      const c = values['broker.city'] || '';
      const s = values['broker.state'] || '';
      const z = values['broker.primary_address.zip'] || '';
      setName(n); sync('name', n);
      setAddress(a); sync('address', a);
      setCity(c); sync('city', c);
      setState(s); sync('state', s);
      setZip(z); sync('zip', z);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designatedRecipient]);

  // ── Validation checks ──
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (touched.designatedRecipient && !designatedRecipient) e.designatedRecipient = 'Required';
    if (touched.name && !name.trim()) e.name = 'Name is required';
    if (touched.name && name.length > 150) e.name = 'Max 150 characters';
    if (touched.address && !address.trim()) e.address = 'Address is required';
    if (touched.address && address.length > 200) e.address = 'Max 200 characters';
    if (touched.city && !city.trim()) e.city = 'City is required';
    if (touched.city && city && !/^[A-Za-z\s]+$/.test(city)) e.city = 'Alphabets only';
    if (touched.state && !state) e.state = 'State is required';
    if (touched.zip && !zip) e.zip = 'ZIP is required';
    if (touched.tinType && !tinType) e.tinType = 'TIN Type is required';
    if (touched.tin && !tinRaw) e.tin = 'TIN is required';
    if (touched.tin && tinRaw && !validateTIN(tinRaw, tinType)) e.tin = 'Enter valid TIN';
    return e;
  }, [touched, designatedRecipient, name, address, city, state, zip, tinType, tinRaw]);

  const hasErrors = Object.keys(errors).length > 0;

  // ── TIN display value ──
  const tinDisplay = useMemo(() => {
    if (!tinRaw) return '';
    if (tinFocused) return formatTIN(tinRaw, tinType);
    return maskTIN(tinRaw, tinType);
  }, [tinRaw, tinType, tinFocused]);

  // ── Account display ──
  const acctDisplay = useMemo(() => {
    if (!accountNumber) return '';
    if (acctFocused) return accountNumber;
    return maskAccountNumber(accountNumber);
  }, [accountNumber, acctFocused]);

  const handleSave = async () => {
    if (disabled) return;
    // Touch all required fields
    const allFields = ['designatedRecipient', 'name', 'address', 'city', 'state', 'zip', 'tinType', 'tin'];
    const allTouched: Record<string, boolean> = {};
    allFields.forEach(f => allTouched[f] = true);
    setTouched(allTouched);

    // Re-check validation
    if (!designatedRecipient || !name.trim() || !address.trim() || !city.trim() || !state || !zip || !tinType) {
      toast.error('Please fill all required fields.');
      return;
    }
    if (tinRaw && !validateTIN(tinRaw, tinType)) {
      toast.error('Enter a valid TIN.');
      return;
    }
    await onSave();
    toast.success('1099 information saved.');
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h4 className="text-lg font-semibold text-foreground">1099 Tax Reporting</h4>

      {/* Section 1: Designated Recipient */}
      <div className="space-y-4">
        <h5 className="text-sm font-medium text-foreground border-b border-border pb-1">Designated Recipient</h5>
        <div>
          <Label>Designated Recipient <span className="text-destructive">*</span></Label>
          <Select
            value={designatedRecipient}
            onValueChange={v => {
              setDesignatedRecipient(v);
              sync('designated_recipient', v);
              markTouched('designatedRecipient');
            }}
            disabled={disabled}
          >
            <SelectTrigger className={errors.designatedRecipient ? 'border-destructive' : ''}>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Lender">Lender</SelectItem>
              <SelectItem value="Broker">Broker</SelectItem>
              <SelectItem value="Other">Other</SelectItem>
            </SelectContent>
          </Select>
          {errors.designatedRecipient && <span className="text-[10px] text-destructive">{errors.designatedRecipient}</span>}
        </div>
      </div>

      {/* Section 2: Recipient Details */}
      <div className="space-y-4">
        <h5 className="text-sm font-medium text-foreground border-b border-border pb-1">Recipient Details</h5>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>Name <span className="text-destructive">*</span></Label>
            <Input
              value={name}
              onChange={e => { const v = e.target.value.replace(/[^a-zA-Z\s.,'-]/g, ''); setName(v); sync('name', v); }}
              onBlur={() => markTouched('name')}
              maxLength={150}
              disabled={disabled}
              className={errors.name ? 'border-destructive' : ''}
            />
            {errors.name && <span className="text-[10px] text-destructive">{errors.name}</span>}
          </div>
          <div className="col-span-2">
            <Label>Address <span className="text-destructive">*</span></Label>
            <Input
              value={address}
              onChange={e => { setAddress(e.target.value); sync('address', e.target.value); }}
              onBlur={() => markTouched('address')}
              maxLength={200}
              disabled={disabled}
              className={errors.address ? 'border-destructive' : ''}
            />
            {errors.address && <span className="text-[10px] text-destructive">{errors.address}</span>}
          </div>
          <div>
            <Label>City <span className="text-destructive">*</span></Label>
            <Input
              value={city}
              onChange={e => {
                const v = e.target.value.replace(/[^A-Za-z\s]/g, '');
                setCity(v); sync('city', v);
              }}
              onBlur={() => markTouched('city')}
              disabled={disabled}
              className={errors.city ? 'border-destructive' : ''}
            />
            {errors.city && <span className="text-[10px] text-destructive">{errors.city}</span>}
          </div>
          <div>
            <Label>State <span className="text-destructive">*</span></Label>
            <Select value={state || '__select__'} onValueChange={v => { const nv = v === '__select__' ? '' : v; setState(nv); sync('state', nv); markTouched('state'); }} disabled={disabled}>
              <SelectTrigger className={errors.state ? 'border-destructive' : ''}>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__select__">Select</SelectItem>
                {US_STATES.map(s => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
              </SelectContent>
            </Select>
            {errors.state && <span className="text-[10px] text-destructive">{errors.state}</span>}
          </div>
          <div>
            <Label>ZIP <span className="text-destructive">*</span></Label>
            <ZipInput
              value={zip}
              onValueChange={v => { setZip(v); sync('zip', v); }}
              disabled={disabled}
            />
          </div>
        </div>
      </div>

      {/* Section 3: Tax & Account Info */}
      <div className="space-y-4">
        <h5 className="text-sm font-medium text-foreground border-b border-border pb-1">Tax & Account Info</h5>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>TIN Type <span className="text-destructive">*</span></Label>
            <Select
              value={tinType}
              onValueChange={v => {
                const t = v as 'SSN' | 'EIN';
                setTinType(t); sync('tin_type', t);
                markTouched('tinType');
              }}
              disabled={disabled}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SSN">SSN</SelectItem>
                <SelectItem value="EIN">EIN</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>TIN <span className="text-destructive">*</span></Label>
            <Input
              value={tinDisplay}
              onFocus={() => setTinFocused(true)}
              onBlur={() => { setTinFocused(false); markTouched('tin'); }}
              onChange={e => {
                const raw = stripTINInput(e.target.value);
                setTinRaw(raw);
                sync('tin', raw);
              }}
              disabled={disabled}
              maxLength={tinType === 'SSN' ? 11 : 10}
              className={errors.tin ? 'border-destructive' : ''}
              placeholder={tinType === 'SSN' ? 'XXX-XX-XXXX' : 'XX-XXXXXXX'}
            />
            {errors.tin && <span className="text-[10px] text-destructive">{errors.tin}</span>}
          </div>
          <div className="col-span-2">
            <Label>Account Number</Label>
            <Input
              value={acctDisplay}
              onFocus={() => setAcctFocused(true)}
              onBlur={() => setAcctFocused(false)}
              onChange={e => {
                const v = e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
                setAccountNumber(v); sync('account_number', v);
              }}
              disabled={disabled}
              maxLength={20}
              placeholder="Optional"
            />
          </div>
        </div>
      </div>

      {/* Section 4: Send 1099 */}
      <div className="flex items-center gap-2">
        <Checkbox
          checked={send1099}
          onCheckedChange={v => { setSend1099(!!v); sync('send_1099', String(!!v)); }}
          id="broker-send1099"
          disabled={disabled}
        />
        <Label htmlFor="broker-send1099">Send 1099</Label>
      </div>

      <div className="flex justify-end gap-2">
        <Button onClick={handleSave} disabled={disabled}>Save 1099</Button>
      </div>
    </div>
  );
};

export default Broker1099;
