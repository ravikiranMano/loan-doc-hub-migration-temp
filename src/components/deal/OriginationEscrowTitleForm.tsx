import React from 'react';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import { EmailInput } from '@/components/ui/email-input';
import { ZipInput } from '@/components/ui/zip-input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { CalendarIcon } from 'lucide-react';
import { format, parse } from 'date-fns';
import { cn } from '@/lib/utils';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';
import { US_STATES } from '@/lib/usStates';
import type { CalculationResult } from '@/lib/calculationEngine';

interface OriginationEscrowTitleFormProps {
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

const FK = {
  // Escrow
  escrow_number: 'origination_esc.escrow_number',
  escrow_company: 'origination_esc.escrow_company',
  escrow_street: 'origination_esc.escrow_street',
  escrow_city: 'origination_esc.escrow_city',
  escrow_state: 'origination_esc.escrow_state',
  escrow_zip: 'origination_esc.escrow_zip',
  escrow_officer: 'origination_esc.escrow_officer',
  escrow_contact: 'origination_esc.escrow_contact',
  escrow_telephone: 'origination_esc.escrow_telephone',
  escrow_email: 'origination_esc.escrow_email',
  // Title
  prelim_number: 'origination_esc.prelim_number',
  title_company: 'origination_esc.title_company',
  title_street: 'origination_esc.title_street',
  title_city: 'origination_esc.title_city',
  title_state: 'origination_esc.title_state',
  title_zip: 'origination_esc.title_zip',
  title_officer: 'origination_esc.title_officer',
  title_contact: 'origination_esc.title_contact',
  title_telephone: 'origination_esc.title_telephone',
  title_email: 'origination_esc.title_email',
  // Trustee
  trustee_type: 'origination_esc.trustee_type',
  trustee_name: 'origination_esc.trustee_name',
  trustee_company: 'origination_esc.trustee_company',
  trustee_street: 'origination_esc.trustee_street',
  trustee_city: 'origination_esc.trustee_city',
  trustee_state: 'origination_esc.trustee_state',
  trustee_zip: 'origination_esc.trustee_zip',
  trustee_officer: 'origination_esc.trustee_officer',
  trustee_contact: 'origination_esc.trustee_contact',
  trustee_telephone: 'origination_esc.trustee_telephone',
  // Details
  date_for_documents: 'origination_esc.date_for_documents',
  estimated_closing: 'origination_esc.estimated_closing',
  coverage_percent: 'origination_esc.coverage_percent',
  net_funded: 'origination_esc.net_funded',
  // Document Delivery
  send_title_policy: 'origination_esc.send_title_policy',
  send_recorded_deed: 'origination_esc.send_recorded_deed',
  send_original_documents: 'origination_esc.send_original_documents',
  // Other addresses
  tp_other_name: 'origination_esc.title_policy_other.name',
  tp_other_company: 'origination_esc.title_policy_other.company',
  tp_other_street: 'origination_esc.title_policy_other.street',
  tp_other_city: 'origination_esc.title_policy_other.city',
  tp_other_state: 'origination_esc.title_policy_other.state',
  tp_other_zip: 'origination_esc.title_policy_other.zip',
  tp_other_phone: 'origination_esc.title_policy_other.phone',
  rd_other_name: 'origination_esc.recorded_deed_other.name',
  rd_other_company: 'origination_esc.recorded_deed_other.company',
  rd_other_street: 'origination_esc.recorded_deed_other.street',
  rd_other_city: 'origination_esc.recorded_deed_other.city',
  rd_other_state: 'origination_esc.recorded_deed_other.state',
  rd_other_zip: 'origination_esc.recorded_deed_other.zip',
  rd_other_phone: 'origination_esc.recorded_deed_other.phone',
  od_other_name: 'origination_esc.original_docs_other.name',
  od_other_company: 'origination_esc.original_docs_other.company',
  od_other_street: 'origination_esc.original_docs_other.street',
  od_other_city: 'origination_esc.original_docs_other.city',
  od_other_state: 'origination_esc.original_docs_other.state',
  od_other_zip: 'origination_esc.original_docs_other.zip',
  od_other_phone: 'origination_esc.original_docs_other.phone',
  // Endorsements
  e_alta6: 'origination_esc.endorse.alta6_variable_rate',
  e_alta7: 'origination_esc.endorse.alta7_manufactured',
  e_alta9: 'origination_esc.endorse.alta9_encroachments',
  e_alta17_sfr: 'origination_esc.endorse.alta17_access_sfr',
  e_alta25_sfr: 'origination_esc.endorse.alta25_survey_sfr',
  e_alta4: 'origination_esc.endorse.alta4_condo',
  e_alta5: 'origination_esc.endorse.alta5_pud',
  e_alta32: 'origination_esc.endorse.alta32_loss_priority',
  e_alta17_const: 'origination_esc.endorse.alta17_access_const',
  e_alta25_const: 'origination_esc.endorse.alta25_survey_const',
  e_alta3: 'origination_esc.endorse.alta3_permitted_use',
  e_rehab_baseline: 'origination_esc.endorse.rehab_baseline',
  e_rehab_alta32: 'origination_esc.endorse.rehab_alta32',
};

const DELIVERY_OPTIONS = ['Company', 'Broker', 'Primary Lender', 'Authorized Party', '3rd Party Servicer', 'Other'];

export const OriginationEscrowTitleForm: React.FC<OriginationEscrowTitleFormProps> = ({
  values,
  onValueChange,
  disabled = false,
}) => {
  const v = (key: string) => values[key] || '';
  const sv = (key: string, val: string) => onValueChange(key, val);
  const bv = (key: string) => values[key] === 'true';
  const sbv = (key: string, val: boolean) => onValueChange(key, String(val));
  const [datePickerStates, setDatePickerStates] = React.useState<Record<string, boolean>>({});
  const parseDate = (val: string): Date | undefined => {
    if (!val) return undefined;
    try { return parse(val, 'yyyy-MM-dd', new Date()); } catch { return undefined; }
  };

  const renderTextField = (label: string, key: string) => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center gap-2">
        <Label className="w-[120px] text-sm shrink-0">{label}</Label>
        <Input value={v(key)} onChange={(e) => sv(key, e.target.value)} disabled={disabled} className="h-7 text-sm" />
      </div>
    </DirtyFieldWrapper>
  );

  const renderDatePicker = (label: string, key: string) => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center gap-2">
        <Label className="w-[120px] text-sm shrink-0">{label}</Label>
        <Popover open={datePickerStates[key] || false} onOpenChange={(open) => setDatePickerStates(prev => ({ ...prev, [key]: open }))}>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn('h-7 w-full justify-start text-left font-normal text-sm', !v(key) && 'text-muted-foreground')} disabled={disabled}>
              {v(key) ? format(parseDate(v(key))!, 'MM/dd/yyyy') : 'Date'}
              <CalendarIcon className="ml-auto h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <EnhancedCalendar mode="single" selected={parseDate(v(key))}
              onSelect={(date) => { if (date) sv(key, format(date, 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, [key]: false })); }}
              onClear={() => { sv(key, ''); setDatePickerStates(prev => ({ ...prev, [key]: false })); }}
              onToday={() => { sv(key, format(new Date(), 'yyyy-MM-dd')); setDatePickerStates(prev => ({ ...prev, [key]: false })); }}
              initialFocus />
          </PopoverContent>
        </Popover>
      </div>
    </DirtyFieldWrapper>
  );

  const renderCheckboxField = (label: string, key: string) => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center gap-2">
        <Checkbox checked={bv(key)} onCheckedChange={(c) => sbv(key, !!c)} disabled={disabled} />
        <Label className="text-sm cursor-pointer">{label}</Label>
      </div>
    </DirtyFieldWrapper>
  );

  const renderDeliveryDropdown = (label: string, dropdownKey: string, otherKeys: { name: string; company: string; street: string; city: string; state: string; zip: string; phone: string }) => {
    const isOther = v(dropdownKey) === 'Other';
    return (
      <DirtyFieldWrapper fieldKey={dropdownKey}>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className="w-[160px] text-sm shrink-0">{label}</Label>
            <Select value={v(dropdownKey)} onValueChange={(val) => sv(dropdownKey, val)} disabled={disabled}>
              <SelectTrigger className="h-7 text-sm">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                {DELIVERY_OPTIONS.map((opt) => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isOther && (
            <div className="ml-[160px] space-y-1 pl-2 border-l-2 border-border">
              <div className="flex items-center gap-2">
                <Label className="w-[80px] text-sm shrink-0">Recipient Name <span className="text-destructive">*</span></Label>
                <Input value={v(otherKeys.name)} onChange={(e) => sv(otherKeys.name, e.target.value)} disabled={disabled} className="h-7 text-sm" placeholder="Required" />
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-[80px] text-sm shrink-0">Company</Label>
                <Input value={v(otherKeys.company)} onChange={(e) => sv(otherKeys.company, e.target.value)} disabled={disabled} className="h-7 text-sm" />
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-[80px] text-sm shrink-0">Street</Label>
                <Input value={v(otherKeys.street)} onChange={(e) => sv(otherKeys.street, e.target.value)} disabled={disabled} className="h-7 text-sm" />
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-[80px] text-sm shrink-0">City</Label>
                <Input value={v(otherKeys.city)} onChange={(e) => sv(otherKeys.city, e.target.value)} disabled={disabled} className="h-7 text-sm" />
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-[80px] text-sm shrink-0">State</Label>
                <Select value={v(otherKeys.state)} onValueChange={(val) => sv(otherKeys.state, (val === '__select__' ? '' : val))} disabled={disabled}>
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
              <div className="flex items-center gap-2">
                <Label className="w-[80px] text-sm shrink-0">ZIP</Label>
                <ZipInput value={v(otherKeys.zip)} onValueChange={(val) => sv(otherKeys.zip, val)} disabled={disabled} className="h-7 text-sm" />
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-[80px] text-sm shrink-0">Phone</Label>
                <PhoneInput value={v(otherKeys.phone)} onValueChange={(val) => sv(otherKeys.phone, val)} disabled={disabled} className="h-7 text-sm" />
              </div>
            </div>
          )}
        </div>
      </DirtyFieldWrapper>
    );
  };

  const trusteeType = v(FK.trustee_type);
  const isTrusteeOther = trusteeType === 'Other';

  return (
    <div className="p-4 space-y-6">
      {/* Escrow / Title / Trustee row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-6">
        {/* Escrow */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">Escrow</h3>
          <div className="space-y-2">
            {renderTextField('Escrow Number', FK.escrow_number)}
            {renderTextField('Escrow Company', FK.escrow_company)}
            {renderTextField('Street', FK.escrow_street)}
            {renderTextField('City', FK.escrow_city)}
            <DirtyFieldWrapper fieldKey={FK.escrow_state}>
              <div className="flex items-center gap-2">
                <Label className="w-[120px] text-sm shrink-0">State</Label>
                <Select value={v(FK.escrow_state)} onValueChange={(val) => sv(FK.escrow_state, (val === '__select__' ? '' : val))} disabled={disabled}>
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
            <DirtyFieldWrapper fieldKey={FK.escrow_zip}>
              <div className="flex items-center gap-2">
                <Label className="w-[120px] text-sm shrink-0">ZIP</Label>
                <ZipInput value={v(FK.escrow_zip)} onValueChange={(val) => sv(FK.escrow_zip, val)} disabled={disabled} className="h-7 text-sm" />
              </div>
            </DirtyFieldWrapper>
            {renderTextField('Escrow Officer Name', FK.escrow_officer)}
            {renderTextField('Escrow Contact', FK.escrow_contact)}
            <DirtyFieldWrapper fieldKey={FK.escrow_telephone}>
              <div className="flex items-center gap-2">
                <Label className="w-[120px] text-sm shrink-0">Escrow Telephone</Label>
                <PhoneInput value={v(FK.escrow_telephone)} onValueChange={(val) => sv(FK.escrow_telephone, val)} disabled={disabled} className="h-7 text-sm" />
              </div>
            </DirtyFieldWrapper>
            <DirtyFieldWrapper fieldKey={FK.escrow_email}>
              <div className="flex items-center gap-2">
                <Label className="w-[120px] text-sm shrink-0">Escrow Email</Label>
                <EmailInput value={v(FK.escrow_email)} onValueChange={(val) => sv(FK.escrow_email, val)} disabled={disabled} className="h-7 text-sm" />
              </div>
            </DirtyFieldWrapper>
          </div>
        </div>

        {/* Title */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">Title</h3>
          <div className="space-y-2">
            {renderTextField('Prelim Number', FK.prelim_number)}
            {renderTextField('Title Company', FK.title_company)}
            {renderTextField('Street', FK.title_street)}
            {renderTextField('City', FK.title_city)}
            <DirtyFieldWrapper fieldKey={FK.title_state}>
              <div className="flex items-center gap-2">
                <Label className="w-[120px] text-sm shrink-0">State</Label>
                <Select value={v(FK.title_state)} onValueChange={(val) => sv(FK.title_state, (val === '__select__' ? '' : val))} disabled={disabled}>
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
            <DirtyFieldWrapper fieldKey={FK.title_zip}>
              <div className="flex items-center gap-2">
                <Label className="w-[120px] text-sm shrink-0">ZIP</Label>
                <ZipInput value={v(FK.title_zip)} onValueChange={(val) => sv(FK.title_zip, val)} disabled={disabled} className="h-7 text-sm" />
              </div>
            </DirtyFieldWrapper>
            {renderTextField('Title Officer Name', FK.title_officer)}
            {renderTextField('Title Contact', FK.title_contact)}
            <DirtyFieldWrapper fieldKey={FK.title_telephone}>
              <div className="flex items-center gap-2">
                <Label className="w-[120px] text-sm shrink-0">Title Telephone</Label>
                <PhoneInput value={v(FK.title_telephone)} onValueChange={(val) => sv(FK.title_telephone, val)} disabled={disabled} className="h-7 text-sm" />
              </div>
            </DirtyFieldWrapper>
            <DirtyFieldWrapper fieldKey={FK.title_email}>
              <div className="flex items-center gap-2">
                <Label className="w-[120px] text-sm shrink-0">Title Email</Label>
                <EmailInput value={v(FK.title_email)} onValueChange={(val) => sv(FK.title_email, val)} disabled={disabled} className="h-7 text-sm" />
              </div>
            </DirtyFieldWrapper>
          </div>
        </div>

        {/* Trustee */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">Trustee</h3>
          <div className="space-y-2">
            <DirtyFieldWrapper fieldKey={FK.trustee_type}>
              <div className="flex items-center gap-2">
                <Label className="w-[120px] text-sm shrink-0">Trustee</Label>
                <Select value={trusteeType} onValueChange={(val) => sv(FK.trustee_type, val)} disabled={disabled}>
                  <SelectTrigger className="h-7 text-sm">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-50">
                    <SelectItem value="Company">Company</SelectItem>
                    <SelectItem value="Title Company">Title Company</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </DirtyFieldWrapper>
            {isTrusteeOther && (
              <DirtyFieldWrapper fieldKey={FK.trustee_name}>
                <div className="flex items-center gap-2">
                  <Label className="w-[120px] text-sm shrink-0">Trustee Name <span className="text-destructive">*</span></Label>
                  <Input value={v(FK.trustee_name)} onChange={(e) => sv(FK.trustee_name, e.target.value)} disabled={disabled} className="h-7 text-sm" placeholder="Required" />
                </div>
              </DirtyFieldWrapper>
            )}
            {renderTextField('Company', FK.trustee_company)}
            {renderTextField('Street', FK.trustee_street)}
            {renderTextField('City', FK.trustee_city)}
            <DirtyFieldWrapper fieldKey={FK.trustee_state}>
              <div className="flex items-center gap-2">
                <Label className="w-[120px] text-sm shrink-0">State</Label>
                <Select value={v(FK.trustee_state)} onValueChange={(val) => sv(FK.trustee_state, (val === '__select__' ? '' : val))} disabled={disabled}>
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
            <DirtyFieldWrapper fieldKey={FK.trustee_zip}>
              <div className="flex items-center gap-2">
                <Label className="w-[120px] text-sm shrink-0">ZIP</Label>
                <ZipInput value={v(FK.trustee_zip)} onValueChange={(val) => sv(FK.trustee_zip, val)} disabled={disabled} className="h-7 text-sm" />
              </div>
            </DirtyFieldWrapper>
            <DirtyFieldWrapper fieldKey={FK.trustee_telephone}>
              <div className="flex items-center gap-2">
                <Label className="w-[120px] text-sm shrink-0">Telephone</Label>
                <PhoneInput value={v(FK.trustee_telephone)} onValueChange={(val) => sv(FK.trustee_telephone, val)} disabled={disabled} className="h-7 text-sm" />
              </div>
            </DirtyFieldWrapper>
          </div>
        </div>
      </div>

      {/* Details & Document Delivery */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">Details</h3>
          <div className="space-y-2">
            {renderDatePicker('Date for Docs', FK.date_for_documents)}
            {renderDatePicker('Est. Closing', FK.estimated_closing)}
            {renderTextField('Coverage %', FK.coverage_percent)}
            {renderCheckboxField('Loan will be net-funded', FK.net_funded)}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">Document Delivery</h3>
          <div className="space-y-3">
            {renderDeliveryDropdown('Send Title Policy', FK.send_title_policy,
              { name: FK.tp_other_name, company: FK.tp_other_company, street: FK.tp_other_street, city: FK.tp_other_city, state: FK.tp_other_state, zip: FK.tp_other_zip, phone: FK.tp_other_phone })}
            {renderDeliveryDropdown('Send Recorded Deed', FK.send_recorded_deed,
              { name: FK.rd_other_name, company: FK.rd_other_company, street: FK.rd_other_street, city: FK.rd_other_city, state: FK.rd_other_state, zip: FK.rd_other_zip, phone: FK.rd_other_phone })}
            {renderDeliveryDropdown('Send Original Docs', FK.send_original_documents,
              { name: FK.od_other_name, company: FK.od_other_company, street: FK.od_other_street, city: FK.od_other_city, state: FK.od_other_state, zip: FK.od_other_zip, phone: FK.od_other_phone })}
          </div>
        </div>
      </div>

      {/* Title Policy / Endorsements */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">Title Policy / Endorsements</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-4">
          {/* Miscellaneous */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">Miscellaneous</p>
            {renderCheckboxField('ALTA 6 / CLTA 111.5 Variable rate', FK.e_alta6)}
            {renderCheckboxField('ALTA 7 Manufactured housing', FK.e_alta7)}
          </div>

          {/* SFR 1-4 Baseline Pack */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">SFR 1–4 Baseline Pack (non-owner)</p>
            {renderCheckboxField('ALTA 9 / CLTA 100.1 Encroachments', FK.e_alta9)}
            {renderCheckboxField('ALTA 17 / CLTA 103.11 Access and Entry', FK.e_alta17_sfr)}
            {renderCheckboxField('ALTA 25 / CLTA 116.1 Survey', FK.e_alta25_sfr)}
            {renderCheckboxField('ALTA 4 / CLTA 115.1 Condo', FK.e_alta4)}
            {renderCheckboxField('ALTA 5 / CLTA 115.2 PUD', FK.e_alta5)}
          </div>

          {/* Construction */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">Construction</p>
            {renderCheckboxField('ALTA 32.06 / CLTA 137.06 Loss of Priority', FK.e_alta32)}
            {renderCheckboxField('ALTA 17 / CLTA 103.11 Access and Entry', FK.e_alta17_const)}
            {renderCheckboxField('ALTA 25 / CLTA 116.1 Survey', FK.e_alta25_const)}
            {renderCheckboxField('ALTA 3 series / CLTA 123 Permitted Use', FK.e_alta3)}
          </div>
        </div>

        {/* Rehab */}
        <div className="pt-2 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Rehab</p>
          <div className="space-y-2">
            {renderCheckboxField('Baseline Pack', FK.e_rehab_baseline)}
            {renderCheckboxField('ALTA 32.06 / CLTA 137.06', FK.e_rehab_alta32)}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OriginationEscrowTitleForm;
