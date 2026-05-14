import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import { EmailInput } from '@/components/ui/email-input';
import { ZipInput } from '@/components/ui/zip-input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { AddFundingModal, FundingFormData } from './AddFundingModal';
import { AddServiceModal, AddServiceFormData } from './AddServiceModal';
import type { FieldDefinition } from '@/hooks/useDealFields';
import { formatPercentDisplay } from '@/lib/precisionFormat';
import type { CalculationResult } from '@/lib/calculationEngine';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';
import { US_STATES } from '@/lib/usStates';
import {
  numericKeyDown,
  numericPaste,
  formatCurrencyDisplay,
  unformatCurrencyDisplay,
  formatPercentageDisplay,
  unformatPercentageDisplay,
} from '@/lib/numericInputFilter';

const SERVICING_AGENT_OPTIONS = ['Company', 'Other Servicer', 'Lender', 'Broker'];
const ASSESSED_OPTIONS = ['Yes', 'No', 'N/A'];
const PAYABLE_OPTIONS = ['Yes', 'No', 'N/A'];

const AGENT_FK = {
  servicing_agent: 'origination_svc.servicing_agent',
  assessed: 'origination_svc.assessed',
  payable: 'origination_svc.payable',
  tp_name: 'origination_svc.third_party.name',
  tp_street: 'origination_svc.third_party.street',
  tp_city: 'origination_svc.third_party.city',
  tp_state: 'origination_svc.third_party.state',
  tp_zip: 'origination_svc.third_party.zip',
  tp_phone: 'origination_svc.third_party.phone',
  tp_email: 'origination_svc.third_party.email',
  sp_same_as_tp: 'origination_svc.send_payments.same_as_third_party',
  sp_name: 'origination_svc.send_payments.name',
  sp_street: 'origination_svc.send_payments.street',
  sp_city: 'origination_svc.send_payments.city',
  sp_state: 'origination_svc.send_payments.state',
  sp_zip: 'origination_svc.send_payments.zip',
  sp_phone: 'origination_svc.send_payments.phone',
  sp_email: 'origination_svc.send_payments.email',
};

// Source field keys for auto-populate by agent type
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

interface LoanTermsServicingFormProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
  dealId?: string;
}

const SERVICE_ROWS = [
  { key: 'standard_servicing', label: 'Standard Servicing', isHeader: false },
  { key: 'high_touch', label: 'High Touch', isHeader: false },
  { key: 'default', label: 'Default', isHeader: false, isLink: true },
  { key: 'minimum_fee', label: 'Minimum Fee', isHeader: false },
  { key: 'minimum_per_lender', label: 'Minimum Per Lender', isHeader: false },
  { key: 'spacer_1', label: '', isHeader: false, isSpacer: true },
  { key: 'calfirpta', label: 'CALFIRPTA', isHeader: false },
  { key: 'multi_property', label: 'Multi-property', isHeader: false },
  { key: 'escrow_impound', label: 'Escrow Impound', isHeader: false },
  { key: 'insurance_tracking', label: 'Insurance Tracking', isHeader: false },
  { key: 'tax_tracking', label: 'Tax Tracking', isHeader: false },
  { key: 'tax_service', label: 'Tax Service', isHeader: false },
  { key: 'senior_lien_tracking', label: 'Senior Lien tracking', isHeader: false },
  { key: 'additional_disbursements', label: 'Additional Disbursements', isHeader: false },
  { key: 'document_storage', label: 'Document Storage', isHeader: false },
  { key: 'mail', label: 'Mail', isHeader: false },
  { key: 'ach', label: 'ACH', isHeader: false },
  { key: 'reserve_pass_through', label: 'Reserve Pass: Through', isHeader: false },
  { key: 'reserve_hold_and_pay', label: 'Reserve: Hold and Pay', isHeader: false },
  { key: 'late_notice', label: 'Late Notice', isHeader: false },
  { key: 'buyer_notice', label: 'Buyer Notice', isHeader: false },
  { key: 'seller_notice', label: 'Seller Notice', isHeader: false },
  { key: 'third_party_notice', label: '3rd Party Notice', isHeader: false },
];

const GRID_COLUMNS = [
  { key: 'cost', label: 'Cost' },
  { key: 'lender_percent', label: 'Lender(s) %' },
  { key: 'lenders_split', label: 'Lenders Split' },
  { key: 'borrower_amount', label: 'Borrower $' },
  { key: 'borrower_percent', label: 'Borrower %' },
  { key: 'broker', label: 'Broker' },
];

const CURRENCY_COLS = new Set(['cost', 'borrower_amount']);
const PERCENT_COLS = new Set(['lender_percent', 'borrower_percent']);

const ServicingInput: React.FC<{
  colKey: string;
  fieldKey: string;
  value: string;
  onValueChange: (fieldKey: string, value: string) => void;
  disabled: boolean;
}> = ({ colKey, fieldKey, value, onValueChange, disabled }) => {
  const isCurrency = CURRENCY_COLS.has(colKey);
  const isPercent = PERCENT_COLS.has(colKey);
  const [focused, setFocused] = React.useState(false);

  const displayValue = React.useMemo(() => {
    if (focused) return value;
    if (isCurrency) return formatCurrencyDisplay(value);
    if (isPercent) return formatPercentageDisplay(value);
    return value;
  }, [value, focused, isCurrency, isPercent]);

  const handleFocus = () => {
    setFocused(true);
    if (isCurrency) {
      onValueChange(fieldKey, unformatCurrencyDisplay(value));
    } else if (isPercent) {
      onValueChange(fieldKey, unformatPercentageDisplay(value));
    }
  };

  const handleBlur = () => {
    setFocused(false);
    if (isCurrency && value) {
      onValueChange(fieldKey, formatCurrencyDisplay(value));
    } else if (isPercent && value) {
      onValueChange(fieldKey, formatPercentageDisplay(value));
    }
  };

  const showDollar = isCurrency && !!displayValue;
  const showPercent = isPercent && !!displayValue && !focused;

  return (
    <div className="relative">
      {showDollar && (
        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none z-10">$</span>
      )}
      <Input
        value={displayValue}
        onChange={(e) => onValueChange(fieldKey, e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        {...(colKey !== 'broker' ? {
          onKeyDown: numericKeyDown,
          onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => numericPaste(e, (v) => onValueChange(fieldKey, v)),
          inputMode: 'decimal' as const,
        } : {})}
        disabled={disabled}
        className={`h-7 text-xs border-border ${isCurrency || isPercent ? 'text-right' : ''} ${showDollar ? 'pl-4' : ''} ${isPercent ? 'pr-5' : ''}`}
      />
      {showPercent && (
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none z-10">%</span>
      )}
    </div>
  );
};

export const LoanTermsServicingForm: React.FC<LoanTermsServicingFormProps> = ({
  fields,
  values,
  onValueChange,
  showValidation = false,
  disabled = false,
  calculationResults = {},
  dealId = '',
}) => {
  const v = (key: string) => values[key] || '';
  const sv = (key: string, val: string) => onValueChange(key, val);
  const bv = (key: string) => values[key] === 'true';
  const sbv = (key: string, val: boolean) => onValueChange(key, String(val));

  // Dynamic custom service rows – derive IDs from persisted values
  const [customServiceIds, setCustomServiceIds] = useState<string[]>(() => {
    const ids: string[] = [];
    const prefix = 'loan_terms.servicing.custom_';
    Object.keys(values).forEach((k) => {
      if (k.startsWith(prefix)) {
        const rest = k.slice(prefix.length);
        const id = rest.split('.')[0];
        if (id && !ids.includes(id)) ids.push(id);
      }
    });
    return ids.length > 0 ? ids : [];
  });

  const [addServiceModalOpen, setAddServiceModalOpen] = useState(false);

  // Collect existing custom service names for duplicate detection
  const existingServiceNames = useMemo(() => {
    const names: string[] = SERVICE_ROWS.map(r => r.label).filter(Boolean);
    customServiceIds.forEach(id => {
      const label = values[`loan_terms.servicing.custom_${id}.label`];
      if (label) names.push(label);
    });
    return names;
  }, [customServiceIds, values]);

  const addCustomService = useCallback((data: AddServiceFormData) => {
    const newId = Date.now().toString(36);
    setCustomServiceIds((prev) => [...prev, newId]);
    const prefix = `loan_terms.servicing.custom_${newId}`;
    onValueChange(`${prefix}.label`, data.label.trim());
    onValueChange(`${prefix}.enabled`, 'true');
    if (data.cost) onValueChange(`${prefix}.cost`, data.cost);
    if (data.lender_percent) onValueChange(`${prefix}.lender_percent`, data.lender_percent);
    if (data.lenders_split) onValueChange(`${prefix}.lenders_split`, data.lenders_split);
    if (data.borrower_amount) onValueChange(`${prefix}.borrower_amount`, data.borrower_amount);
    if (data.borrower_percent) onValueChange(`${prefix}.borrower_percent`, data.borrower_percent);
    if (data.broker) onValueChange(`${prefix}.broker`, data.broker);
  }, [onValueChange]);

  const removeCustomService = useCallback((id: string) => {
    setCustomServiceIds((prev) => prev.filter((i) => i !== id));
    // Clear persisted values for this row
    const prefix = `loan_terms.servicing.custom_${id}.`;
    Object.keys(values).forEach((k) => {
      if (k.startsWith(prefix)) onValueChange(k, '');
    });
    onValueChange(`loan_terms.servicing.custom_${id}.enabled`, '');
    onValueChange(`loan_terms.servicing.custom_${id}.label`, '');
  }, [values, onValueChange]);

  // Override Individual state
  const [overridePopoverOpen, setOverridePopoverOpen] = useState(false);
  const [participants, setParticipants] = useState<Array<{ id: string; name: string; role: string; contact_id: string | null }>>([]);
  const [selectedParticipant, setSelectedParticipant] = useState<{ id: string; name: string; role: string } | null>(null);
  const [fundingModalOpen, setFundingModalOpen] = useState(false);

  // Fetch broker/lender participants for the deal
  useEffect(() => {
    if (!dealId) return;
    const fetchParticipants = async () => {
      const { data } = await supabase
        .from('deal_participants')
        .select('id, name, email, role, contact_id')
        .eq('deal_id', dealId)
        .in('role', ['broker', 'lender']);
      if (data) {
        setParticipants(data.map(p => ({
          id: p.id,
          name: p.name || p.email || 'Unknown',
          role: p.role,
          contact_id: p.contact_id,
        })));
      }
    };
    fetchParticipants();
  }, [dealId]);

  const agentValue = v(AGENT_FK.servicing_agent);
  const sameAsTP = bv(AGENT_FK.sp_same_as_tp);

  // Auto-populate 3rd party address when agent changes to Company/Broker/Lender
  useEffect(() => {
    if (!agentValue) return;
    let sourceKeys: Record<string, string> | null = null;
    if (agentValue === 'Company') sourceKeys = COMPANY_SOURCE_KEYS;
    else if (agentValue === 'Broker') sourceKeys = BROKER_SOURCE_KEYS;
    else if (agentValue === 'Lender') sourceKeys = LENDER_SOURCE_KEYS;

    if (sourceKeys) {
      const mappings: [string, string][] = [
        [sourceKeys.name, AGENT_FK.tp_name],
        [sourceKeys.street, AGENT_FK.tp_street],
        [sourceKeys.city, AGENT_FK.tp_city],
        [sourceKeys.state, AGENT_FK.tp_state],
        [sourceKeys.zip, AGENT_FK.tp_zip],
        [sourceKeys.phone, AGENT_FK.tp_phone],
        [sourceKeys.email, AGENT_FK.tp_email],
      ];
      mappings.forEach(([src, dst]) => {
        const srcVal = src ? (values[src] || '') : '';
        sv(dst, srcVal);
      });
    }
  }, [agentValue]);

  // Auto-copy 3rd party values when "Same as 3rd Party" is checked
  useEffect(() => {
    if (sameAsTP) {
      const mappings: [string, string][] = [
        [AGENT_FK.tp_name, AGENT_FK.sp_name], [AGENT_FK.tp_street, AGENT_FK.sp_street],
        [AGENT_FK.tp_city, AGENT_FK.sp_city], [AGENT_FK.tp_state, AGENT_FK.sp_state],
        [AGENT_FK.tp_zip, AGENT_FK.sp_zip], [AGENT_FK.tp_phone, AGENT_FK.sp_phone],
        [AGENT_FK.tp_email, AGENT_FK.sp_email],
      ];
      mappings.forEach(([src, dst]) => {
        if (v(src) !== v(dst)) sv(dst, v(src));
      });
    }
  }, [sameAsTP, values[AGENT_FK.tp_name], values[AGENT_FK.tp_street], values[AGENT_FK.tp_city], values[AGENT_FK.tp_state], values[AGENT_FK.tp_zip], values[AGENT_FK.tp_phone], values[AGENT_FK.tp_email]]);

  const renderTextField = (label: string, key: string, extraDisabled = false) => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center gap-2">
        <Label className="w-[80px] text-sm shrink-0">{label}</Label>
        <Input value={v(key)} onChange={(e) => sv(key, e.target.value)} disabled={disabled || extraDisabled} className="h-7 text-sm" />
      </div>
    </DirtyFieldWrapper>
  );

  const renderAddressBlock = (keys: { name: string; street: string; city: string; state: string; zip: string; phone: string; email: string }, extraDisabled = false) => (
    <div className="space-y-2">
      {renderTextField('Name', keys.name, extraDisabled)}
      {renderTextField('Street', keys.street, extraDisabled)}
      {renderTextField('City', keys.city, extraDisabled)}
      <DirtyFieldWrapper fieldKey={keys.state}>
        <div className="flex items-center gap-2">
          <Label className="w-[80px] text-sm shrink-0">State</Label>
          <Select value={v(keys.state)} onValueChange={(val) => sv(keys.state, (val === '__select__' ? '' : val))} disabled={disabled || extraDisabled}>
            <SelectTrigger className="h-7 text-sm">
              <SelectValue placeholder="Select..." />
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

  const getFieldKey = (rowKey: string, colKey: string) => 
    `loan_terms.servicing.${rowKey}.${colKey}`;

  return (
    <div className="p-6 space-y-6">
      {/* Servicing Agent Section */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">Servicing Agent</h3>
        <DirtyFieldWrapper fieldKey={AGENT_FK.servicing_agent}>
          <div className="flex items-center gap-2 max-w-xs">
            <Label className="w-[120px] text-sm shrink-0">Servicing Agent</Label>
            <Select value={v(AGENT_FK.servicing_agent)} onValueChange={(val) => sv(AGENT_FK.servicing_agent, val)} disabled={disabled}>
              <SelectTrigger className="h-7 text-sm">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                {SERVICING_AGENT_OPTIONS.map((opt) => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </DirtyFieldWrapper>
        {/* Assessed and Payable dropdowns intentionally hidden per UI requirement.
            Underlying field keys (AGENT_FK.assessed / AGENT_FK.payable), options,
            and persistence logic are preserved unchanged. */}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-6">
        {/* Complete if 3rd Party */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">Complete if 3rd Party</h3>
          {renderAddressBlock({ name: AGENT_FK.tp_name, street: AGENT_FK.tp_street, city: AGENT_FK.tp_city, state: AGENT_FK.tp_state, zip: AGENT_FK.tp_zip, phone: AGENT_FK.tp_phone, email: AGENT_FK.tp_email })}
        </div>

        {/* Send Payments To */}
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-border pb-1">
            <h3 className="text-sm font-semibold text-foreground">Send Payments To</h3>
            <DirtyFieldWrapper fieldKey={AGENT_FK.sp_same_as_tp}>
              <div className="flex items-center gap-2">
                <Checkbox checked={sameAsTP} onCheckedChange={(c) => sbv(AGENT_FK.sp_same_as_tp, !!c)} disabled={disabled} />
                <Label className="text-sm cursor-pointer">Same as 3rd Party</Label>
              </div>
            </DirtyFieldWrapper>
          </div>
          {renderAddressBlock({ name: AGENT_FK.sp_name, street: AGENT_FK.sp_street, city: AGENT_FK.sp_city, state: AGENT_FK.sp_state, zip: AGENT_FK.sp_zip, phone: AGENT_FK.sp_phone, email: AGENT_FK.sp_email }, sameAsTP)}
        </div>
      </div>

      {/* Separator */}
      <div className="border-t border-border" />

      {/* Services and Rates heading */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Services and Rates</h3>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => setAddServiceModalOpen(true)}
          disabled={disabled}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Service
        </Button>
      </div>
      {/* Override, Per, Payable controls */}
      <div className="flex items-center gap-6 flex-wrap">
        <DirtyFieldWrapper fieldKey="loan_terms.servicing.override">
          <div className="flex items-center gap-3">
            <Label className="text-sm font-medium">Override All</Label>
            <Checkbox
              checked={values['loan_terms.servicing.override'] === 'true'}
              onCheckedChange={(checked) => 
                onValueChange('loan_terms.servicing.override', checked ? 'true' : 'false')
              }
              disabled={disabled}
            />
          </div>
        </DirtyFieldWrapper>

        {/* Override Individual */}
        <Popover open={overridePopoverOpen} onOpenChange={setOverridePopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" disabled={disabled}>
              Override Individual
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2 z-50" align="start">
            {participants.length === 0 ? (
              <div className="text-xs text-muted-foreground p-2 text-center">
                No Broker/Lender participants found.
                <br />
                <span className="text-primary">Add participants from the Participants section.</span>
              </div>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {participants.map((p) => (
                  <button
                    key={p.id}
                    className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted/50 flex items-center justify-between"
                    onClick={() => {
                      setSelectedParticipant(p);
                      setFundingModalOpen(true);
                      setOverridePopoverOpen(false);
                    }}
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="text-muted-foreground capitalize ml-2 shrink-0">{p.role}</span>
                  </button>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>

        {/* Fees Assessed */}
        <div className="flex items-center gap-2 border-l border-border pl-4">
          <Label className="text-sm font-medium shrink-0">Fees Assessed:</Label>
          <DirtyFieldWrapper fieldKey="loan_terms.servicing.fees_assessed">
            <Select
              value={v('loan_terms.servicing.fees_assessed') || undefined}
              onValueChange={(val) => sv('loan_terms.servicing.fees_assessed', val)}
              disabled={disabled}
            >
              <SelectTrigger className="h-7 text-xs w-[120px]">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                <SelectItem value="Monthly">Monthly</SelectItem>
                <SelectItem value="Quarterly">Quarterly</SelectItem>
                <SelectItem value="Annually">Annually</SelectItem>
              </SelectContent>
            </Select>
          </DirtyFieldWrapper>
        </div>

        {/* Payable */}
        <div className="flex items-center gap-2 border-l border-border pl-4">
          <Label className="text-sm font-medium shrink-0">Payable:</Label>
          <DirtyFieldWrapper fieldKey="loan_terms.servicing.payable">
            <Select
              value={v('loan_terms.servicing.payable') || undefined}
              onValueChange={(val) => sv('loan_terms.servicing.payable', val)}
              disabled={disabled}
            >
              <SelectTrigger className="h-7 text-xs w-[120px]">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                <SelectItem value="Monthly">Monthly</SelectItem>
                <SelectItem value="Quarterly">Quarterly</SelectItem>
                <SelectItem value="Annually">Annually</SelectItem>
              </SelectContent>
            </Select>
          </DirtyFieldWrapper>
        </div>
      </div>

      {/* Individual Funding Modal */}
      {selectedParticipant && (
        <AddFundingModal
          open={fundingModalOpen}
          onOpenChange={(open) => {
            setFundingModalOpen(open);
            if (!open) setSelectedParticipant(null);
          }}
          loanNumber={values['loan_terms.details_loan_number'] || ''}
          borrowerName={values['borrower.full_name'] || ''}
          onSubmit={(data) => {
            // Save individual override data for this participant
            const prefix = `loan_terms.servicing.individual.${selectedParticipant.id}`;
            Object.entries(data).forEach(([key, val]) => {
              if (val !== undefined && val !== null) {
                onValueChange(`${prefix}.${key}`, String(val));
              }
            });
            setFundingModalOpen(false);
            setSelectedParticipant(null);
          }}
          noteRate={values['loan_terms.balances_note_rate'] || ''}
          soldRate={values['loan_terms.balances_sold_rate'] || ''}
          totalPayment={values['loan_terms.balances_total_payment'] || ''}
          loanAmount={values['loan_terms.balances_loan_amount'] || ''}
        />
      )}

      {/* Services Grid */}
      {(() => {
        // Compute totals across all rows (static + custom)
        const SUMMABLE_COLS = ['cost', 'lender_percent', 'borrower_amount', 'borrower_percent', 'broker'];
        const allRowKeys = [
          ...SERVICE_ROWS.filter(r => !r.isSpacer).map(r => r.key),
          ...customServiceIds.map(id => `custom_${id}`),
        ];
        const totals: Record<string, number> = {};
        SUMMABLE_COLS.forEach(col => {
          let sum = 0;
          allRowKeys.forEach(rk => {
            const raw = values[`loan_terms.servicing.${rk}.${col}`] || '';
            const num = parseFloat(raw.replace(/,/g, ''));
            if (!isNaN(num)) sum += num;
          });
          totals[col] = sum;
        });

        return (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-3 py-2 font-medium text-foreground w-48">Services</th>
                    <th className="text-left px-1 py-2 font-medium text-foreground w-8"></th>
                    {GRID_COLUMNS.map((col) => (
                      <th key={col.key} className="text-left px-2 py-2 font-medium text-foreground min-w-24">
                        {col.label}
                      </th>
                    ))}
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {/* Static rows */}
                  {SERVICE_ROWS.map((row) => (
                    <tr 
                      key={row.key} 
                      className={`border-b border-border last:border-b-0 ${
                        row.isSpacer ? 'h-6 bg-muted/20' : 'hover:bg-muted/30'
                      }`}
                    >
                      <td className="px-3 py-1.5">
                        {row.isLink ? (
                          <span className="text-primary cursor-pointer hover:underline">{row.label}</span>
                        ) : (
                          <span className="text-foreground">{row.label}</span>
                        )}
                      </td>
                      <td className="px-1 py-1.5">
                        {!row.isSpacer && (
                          <DirtyFieldWrapper fieldKey={`loan_terms.servicing.${row.key}.enabled`}>
                            <Checkbox
                              checked={values[`loan_terms.servicing.${row.key}.enabled`] === 'true'}
                              onCheckedChange={(checked) => 
                                onValueChange(`loan_terms.servicing.${row.key}.enabled`, checked ? 'true' : 'false')
                              }
                              disabled={disabled}
                              className="h-4 w-4"
                            />
                          </DirtyFieldWrapper>
                        )}
                      </td>
                      {GRID_COLUMNS.map((col) => (
                        <td key={col.key} className="px-1 py-1">
                          {!row.isSpacer && (
                            <DirtyFieldWrapper fieldKey={getFieldKey(row.key, col.key)}>
                              {col.key === 'lenders_split' ? (
                                <Select
                                  value={values[getFieldKey(row.key, col.key)] || ''}
                                  onValueChange={(value) => onValueChange(getFieldKey(row.key, col.key), value)}
                                  disabled={disabled}
                                >
                                  <SelectTrigger className="h-7 text-xs border-border">
                                    <SelectValue placeholder="Select..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="fee_per_lender">Fee Per Lender - No Split</SelectItem>
                                    <SelectItem value="pro_rata">Pro Rata</SelectItem>
                                    <SelectItem value="split_50_50">Split 50/50</SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : (
                                <ServicingInput
                                  colKey={col.key}
                                  fieldKey={getFieldKey(row.key, col.key)}
                                  value={values[getFieldKey(row.key, col.key)] || ''}
                                  onValueChange={onValueChange}
                                  disabled={disabled}
                                />
                              )}
                            </DirtyFieldWrapper>
                          )}
                        </td>
                      ))}
                      <td></td>
                    </tr>
                  ))}

                  {/* Dynamic custom service rows */}
                  {customServiceIds.map((id) => {
                    const prefix = `loan_terms.servicing.custom_${id}`;
                    return (
                      <tr key={id} className="border-b border-border hover:bg-muted/30">
                        <td className="px-3 py-1.5">
                          <Input
                            value={values[`${prefix}.label`] || ''}
                            onChange={(e) => onValueChange(`${prefix}.label`, e.target.value)}
                            disabled={disabled}
                            placeholder="Custom service..."
                            className="h-7 text-xs border-border"
                          />
                        </td>
                        <td className="px-1 py-1.5">
                          <DirtyFieldWrapper fieldKey={`${prefix}.enabled`}>
                            <Checkbox
                              checked={values[`${prefix}.enabled`] === 'true'}
                              onCheckedChange={(checked) => 
                                onValueChange(`${prefix}.enabled`, checked ? 'true' : 'false')
                              }
                              disabled={disabled}
                              className="h-4 w-4"
                            />
                          </DirtyFieldWrapper>
                        </td>
                        {GRID_COLUMNS.map((col) => (
                          <td key={col.key} className="px-1 py-1">
                            <DirtyFieldWrapper fieldKey={`${prefix}.${col.key}`}>
                              {col.key === 'lenders_split' ? (
                                <Select
                                  value={values[`${prefix}.${col.key}`] || ''}
                                  onValueChange={(value) => onValueChange(`${prefix}.${col.key}`, value)}
                                  disabled={disabled}
                                >
                                  <SelectTrigger className="h-7 text-xs border-border">
                                    <SelectValue placeholder="Select..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="fee_per_lender">Fee Per Lender - No Split</SelectItem>
                                    <SelectItem value="pro_rata">Pro Rata</SelectItem>
                                    <SelectItem value="split_50_50">Split 50/50</SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : (
                                <ServicingInput
                                  colKey={col.key}
                                  fieldKey={`${prefix}.${col.key}`}
                                  value={values[`${prefix}.${col.key}`] || ''}
                                  onValueChange={onValueChange}
                                  disabled={disabled}
                                />
                              )}
                            </DirtyFieldWrapper>
                          </td>
                        ))}
                        <td className="px-1 py-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => removeCustomService(id)}
                            disabled={disabled}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}

                  {/* Total row */}
                  <tr className="bg-muted/60 border-t-2 border-border font-semibold">
                    <td className="px-3 py-2 text-foreground">Total</td>
                    <td></td>
                    {GRID_COLUMNS.map((col) => (
                      <td key={col.key} className="px-2 py-2 text-right text-foreground">
                        {SUMMABLE_COLS.includes(col.key) ? (
                          <span className="text-xs">
                            {CURRENCY_COLS.has(col.key) && totals[col.key] ? '$' : ''}
                            {totals[col.key]
                              ? (CURRENCY_COLS.has(col.key)
                                  ? totals[col.key].toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                  : PERCENT_COLS.has(col.key)
                                    ? formatPercentDisplay(totals[col.key], 4) + '%'
                                    : totals[col.key].toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
                              : '—'}
                          </span>
                        ) : null}
                      </td>
                    ))}
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Add Service Modal */}
            <AddServiceModal
              open={addServiceModalOpen}
              onOpenChange={setAddServiceModalOpen}
              onSave={addCustomService}
              existingNames={existingServiceNames}
            />
          </div>
        );
      })()}
    </div>
  );
};

export default LoanTermsServicingForm;
