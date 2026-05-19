import React, { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import { EmailInput } from '@/components/ui/email-input';
import { ZipInput } from '@/components/ui/zip-input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';
import { US_STATES } from '@/lib/usStates';
import type { CalculationResult } from '@/lib/calculationEngine';

interface OriginationServicingFormProps {
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

const FK = {
  servicing_agent: 'origination_svc.servicing_agent',
  servicing_agent_name: 'oo_sa_servicingAgentName',
  // 3rd Party
  tp_name: 'origination_svc.third_party.name',
  tp_street: 'origination_svc.third_party.street',
  tp_city: 'origination_svc.third_party.city',
  tp_state: 'origination_svc.third_party.state',
  tp_zip: 'origination_svc.third_party.zip',
  tp_phone: 'origination_svc.third_party.phone',
  tp_email: 'origination_svc.third_party.email',
  // Company Properties
  cp_name: 'origination_svc.company.name',
  cp_street: 'origination_svc.company.street',
  cp_city: 'origination_svc.company.city',
  cp_state: 'origination_svc.company.state',
  cp_zip: 'origination_svc.company.zip',
  cp_phone: 'origination_svc.company.phone',
  cp_email: 'origination_svc.company.email',
  // Send Payments To
  sp_same_as_tp: 'origination_svc.send_payments.same_as_third_party',
  sp_name: 'origination_svc.send_payments.name',
  sp_street: 'origination_svc.send_payments.street',
  sp_city: 'origination_svc.send_payments.city',
  sp_state: 'origination_svc.send_payments.state',
  sp_zip: 'origination_svc.send_payments.zip',
  sp_phone: 'origination_svc.send_payments.phone',
  sp_email: 'origination_svc.send_payments.email',
  // Broker Servicing Fee
  fee_percent: 'origination_svc.broker_fee.percent',
  fee_plus: 'origination_svc.broker_fee.plus',
  fee_per: 'origination_svc.broker_fee.per',
  fee_payable: 'origination_svc.broker_fee.payable',
};

const AGENT_OPTIONS = ['Company', 'Broker', 'Lender', 'Other / Third Party'];
const PERIOD_OPTIONS = ['Monthly', 'Quarterly', 'Annually', 'Other'];

// Source field keys for auto-populate by agent type (mirrors LoanTermsServicingForm)
const COMPANY_SOURCE_KEYS = {
  name: 'loan_terms.details_company',
  street: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
  email: '',
};
const BROKER_SOURCE_KEYS = {
  name: 'broker.company',
  street: 'broker.address.street',
  city: 'broker.address.city',
  state: 'broker.address.state',
  zip: 'broker.address.zip',
  phone: 'broker.phone.work',
  email: 'broker.email',
};
const LENDER_SOURCE_KEYS = {
  name: 'lender.full_name',
  street: 'lender.primary_address.street',
  city: 'lender.primary_address.city',
  state: 'lender.primary_address.state',
  zip: 'lender.primary_address.zip',
  phone: 'lender.phone.work',
  email: 'lender.email',
};

export const OriginationServicingForm: React.FC<OriginationServicingFormProps> = ({
  values,
  onValueChange,
  disabled = false,
}) => {
  const v = (key: string) => values[key] || '';
  const sv = (key: string, val: string) => onValueChange(key, val);
  const bv = (key: string) => values[key] === 'true';
  const sbv = (key: string, val: boolean) => onValueChange(key, String(val));

  // Auto-populate 3rd Party fields when Servicing Agent changes
  // Company / Broker / Lender pull from existing keys; Other / Third Party leaves manual.
  // For multi-lender loans, picks the lender with the largest principalBalance.
  const agentValue = v(FK.servicing_agent);
  const lastAgentRef = useRef<string>(agentValue);
  useEffect(() => {
    if (!agentValue) { lastAgentRef.current = agentValue; return; }
    if (agentValue === lastAgentRef.current) return;
    lastAgentRef.current = agentValue;

    const writeFromKeys = (sourceKeys: Record<string, string>) => {
      const mappings: [string, string, string][] = [
        [sourceKeys.name, FK.tp_name, FK.sp_name],
        [sourceKeys.street, FK.tp_street, FK.sp_street],
        [sourceKeys.city, FK.tp_city, FK.sp_city],
        [sourceKeys.state, FK.tp_state, FK.sp_state],
        [sourceKeys.zip, FK.tp_zip, FK.sp_zip],
        [sourceKeys.phone, FK.tp_phone, FK.sp_phone],
        [sourceKeys.email, FK.tp_email, FK.sp_email],
      ];
      mappings.forEach(([src, dstTp, dstSp]) => {
        const srcVal = src ? (values[src] || '') : '';
        sv(dstTp, srcVal);
        sv(dstSp, srcVal);
      });
    };

    if (agentValue === 'Company') {
      writeFromKeys(COMPANY_SOURCE_KEYS);
    } else if (agentValue === 'Broker') {
      writeFromKeys(BROKER_SOURCE_KEYS);
    } else if (agentValue === 'Lender') {
      // Detect multi-lender via funding records JSON
      let largestLenderAccount = '';
      let largestLenderName = '';
      let isMultiLender = false;
      try {
        const raw = values['loan_terms.funding_records'];
        const records = raw ? JSON.parse(raw) : [];
        if (Array.isArray(records) && records.length > 1) {
          isMultiLender = true;
          const largest = records.reduce((max: any, r: any) =>
            Number(r?.principalBalance || 0) > Number(max?.principalBalance || 0) ? r : max,
            records[0]
          );
          largestLenderAccount = largest?.lenderAccount || '';
          largestLenderName = largest?.lenderName || '';
        }
      } catch { /* ignore parse errors */ }

      if (!isMultiLender) {
        writeFromKeys(LENDER_SOURCE_KEYS);
      } else if (largestLenderAccount && largestLenderAccount === values['lender.id']) {
        // Largest lender is the deal's primary lender — use existing keys
        writeFromKeys(LENDER_SOURCE_KEYS);
      } else if (largestLenderAccount) {
        // Look up the contact by contact_id and populate from contact_data
        (async () => {
          try {
            const { data } = await supabase
              .from('contacts')
              .select('full_name, contact_data')
              .eq('contact_id', largestLenderAccount)
              .eq('contact_type', 'lender')
              .maybeSingle();
            const cd = (data?.contact_data as Record<string, any>) || {};
            const addr = cd.primary_address || {};
            const phone = cd.phone || {};
            const nameVal = data?.full_name || cd.full_name || largestLenderName || '';
            const streetVal = addr.street || '';
            const cityVal = addr.city || '';
            const stateVal = addr.state || '';
            const zipVal = addr.zip || '';
            const phoneVal = phone.work || cd.phone_work || '';
            const emailVal = cd.email || '';
            sv(FK.tp_name, nameVal); sv(FK.sp_name, nameVal);
            sv(FK.tp_street, streetVal); sv(FK.sp_street, streetVal);
            sv(FK.tp_city, cityVal); sv(FK.sp_city, cityVal);
            sv(FK.tp_state, stateVal); sv(FK.sp_state, stateVal);
            sv(FK.tp_zip, zipVal); sv(FK.sp_zip, zipVal);
            sv(FK.tp_phone, phoneVal); sv(FK.sp_phone, phoneVal);
            sv(FK.tp_email, emailVal); sv(FK.sp_email, emailVal);
          } catch {
            // Fallback to existing lender keys if lookup fails
            writeFromKeys(LENDER_SOURCE_KEYS);
          }
        })();
      } else {
        writeFromKeys(LENDER_SOURCE_KEYS);
      }
    }
    // 'Other / Third Party': no auto-populate; fields remain manually editable.
  }, [agentValue]);

  // Auto-copy 3rd party values when "Same as 3rd Party" is checked
  const sameAsTP = bv(FK.sp_same_as_tp);
  useEffect(() => {
    if (sameAsTP) {
      const mappings = [
        [FK.tp_name, FK.sp_name], [FK.tp_street, FK.sp_street], [FK.tp_city, FK.sp_city],
        [FK.tp_state, FK.sp_state], [FK.tp_zip, FK.sp_zip], [FK.tp_phone, FK.sp_phone], [FK.tp_email, FK.sp_email],
      ];
      mappings.forEach(([src, dst]) => {
        if (v(src) !== v(dst)) sv(dst, v(src));
      });
    }
  }, [sameAsTP, values[FK.tp_name], values[FK.tp_street], values[FK.tp_city], values[FK.tp_state], values[FK.tp_zip], values[FK.tp_phone], values[FK.tp_email]]);

  const renderTextField = (label: string, key: string, extraDisabled = false) => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center gap-2">
        <Label className="w-[80px] text-sm shrink-0">{label}</Label>
        <Input value={v(key)} onChange={(e) => sv(key, e.target.value)} disabled={disabled || extraDisabled} className="h-7 text-sm" />
      </div>
    </DirtyFieldWrapper>
  );

  const renderAddressBlock = (prefix: string, keys: { name: string; street: string; city: string; state: string; zip: string; phone: string; email: string }, extraDisabled = false) => (
    <div className="space-y-2">
      {renderTextField('Name', keys.name, extraDisabled)}
      {renderTextField('Street', keys.street, extraDisabled)}
      {renderTextField('City', keys.city, extraDisabled)}
      <DirtyFieldWrapper fieldKey={keys.state}>
        <div className="flex items-center gap-2">
          <Label className="w-[80px] text-sm shrink-0">State</Label>
          <Select value={v(keys.state)} onValueChange={(val) => sv(keys.state, (val === '__select__' ? '' : val))} disabled={disabled || extraDisabled}>
            <SelectTrigger className="h-7 text-sm">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent className="bg-popover z-50">
              <SelectItem value="__select__">Select</SelectItem>
                  {US_STATES.map((st) => (
                <SelectItem key={st} value={st}>{st}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </DirtyFieldWrapper>
      <DirtyFieldWrapper fieldKey={keys.zip}>
        <div className="flex items-center gap-2">
          <Label className="w-[80px] text-sm shrink-0">ZIP</Label>
          <ZipInput value={v(keys.zip)} onValueChange={(val) => sv(keys.zip, val)} disabled={disabled || extraDisabled} className="h-7 text-sm" />
        </div>
      </DirtyFieldWrapper>
      <DirtyFieldWrapper fieldKey={keys.phone}>
        <div className="flex items-center gap-2">
          <Label className="w-[80px] text-sm shrink-0">Phone</Label>
          <PhoneInput value={v(keys.phone)} onValueChange={(val) => sv(keys.phone, val)} disabled={disabled || extraDisabled} className="h-7 text-sm" />
        </div>
      </DirtyFieldWrapper>
      <DirtyFieldWrapper fieldKey={keys.email}>
        <div className="flex items-center gap-2">
          <Label className="w-[80px] text-sm shrink-0">Email</Label>
          <EmailInput value={v(keys.email)} onValueChange={(val) => sv(keys.email, val)} disabled={disabled || extraDisabled} className="h-7 text-sm" />
        </div>
      </DirtyFieldWrapper>
    </div>
  );

  return (
    <div className="p-4 space-y-6">
      {/* Servicing Agent */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">Servicing Agent</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl">
          <DirtyFieldWrapper fieldKey={FK.servicing_agent}>
            <div className="flex items-center gap-2">
              <Label className="w-[120px] text-sm shrink-0">Servicing Agent</Label>
              <Select value={v(FK.servicing_agent)} onValueChange={(val) => sv(FK.servicing_agent, val)} disabled={disabled}>
                <SelectTrigger className="h-7 text-sm">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="bg-popover z-50">
                  {AGENT_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </DirtyFieldWrapper>
          <DirtyFieldWrapper fieldKey={FK.servicing_agent_name}>
            <div className="flex items-center gap-2">
              <Label className="w-[160px] text-sm shrink-0">Servicing Agent Name</Label>
              <Input
                value={v(FK.servicing_agent_name)}
                onChange={(e) => sv(FK.servicing_agent_name, e.target.value)}
                placeholder="Enter Servicing Agent Name"
                disabled={disabled}
                className="h-7 text-sm"
              />
            </div>
          </DirtyFieldWrapper>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-6">
        {/* Complete if 3rd Party */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">Complete if 3rd Party</h3>
          {renderAddressBlock('tp', { name: FK.tp_name, street: FK.tp_street, city: FK.tp_city, state: FK.tp_state, zip: FK.tp_zip, phone: FK.tp_phone, email: FK.tp_email })}
        </div>

        {/* Send Payments To */}
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-border pb-1">
            <h3 className="text-sm font-semibold text-foreground">Send Payments To</h3>
            <DirtyFieldWrapper fieldKey={FK.sp_same_as_tp}>
              <div className="flex items-center gap-2">
                <Checkbox checked={sameAsTP} onCheckedChange={(c) => sbv(FK.sp_same_as_tp, !!c)} disabled={disabled} />
                <Label className="text-sm cursor-pointer">Same as 3rd Party</Label>
              </div>
            </DirtyFieldWrapper>
          </div>
          {renderAddressBlock('sp', { name: FK.sp_name, street: FK.sp_street, city: FK.sp_city, state: FK.sp_state, zip: FK.sp_zip, phone: FK.sp_phone, email: FK.sp_email }, sameAsTP)}
        </div>

      </div>
    </div>
  );
};

export default OriginationServicingForm;
