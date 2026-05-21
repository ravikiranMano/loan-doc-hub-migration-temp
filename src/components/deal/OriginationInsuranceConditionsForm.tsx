import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';
import { numericKeyDown, numericPaste, formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';
import type { CalculationResult } from '@/lib/calculationEngine';

interface OriginationInsuranceConditionsFormProps {
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

const FK = {
  // Insurance section
  carrier_a_minus: 'origination_ins.carrier_rating_a_minus',
  carrier_a: 'origination_ins.carrier_rating_a',
  carrier_a_plus: 'origination_ins.carrier_rating_a_plus',
  carrier_other: 'origination_ins.carrier_rating_other',
  carrier_other_text: 'origination_ins.carrier_rating_other_text',
  lender_control_proceeds: 'origination_ins.lender_control_proceeds',
  max_deductible: 'origination_ins.max_deductible',
  additional_insured_liability: 'origination_ins.additional_insured_liability',
  additional_insured_builders_risk: 'origination_ins.additional_insured_builders_risk',
  mortgagee: 'origination_ins.mortgagee',
  mortgage_clause: 'origination_ins.mortgage_clause',

  // Policy Types
  policy_property_hazard: 'origination_ins.policy_property_hazard',
  policy_dwelling_fire: 'origination_ins.policy_dwelling_fire',
  policy_builders_risk: 'origination_ins.policy_builders_risk',
  policy_general_liability: 'origination_ins.policy_general_liability',
  policy_flood: 'origination_ins.policy_flood',
  policy_earthquake: 'origination_ins.policy_earthquake',
  policy_wind_hail: 'origination_ins.policy_wind_hail',
  policy_umbrella: 'origination_ins.policy_umbrella',
  policy_loss_of_rents: 'origination_ins.policy_loss_of_rents',
  policy_vacancy: 'origination_ins.policy_vacancy',
  policy_construction_amount: 'origination_ins.policy_construction_amount',

  // Coverage Limits
  coverage_loan_amount: 'origination_ins.coverage_loan_amount',
  coverage_replacement_cost: 'origination_ins.coverage_replacement_cost',
  coverage_specific_dollar: 'origination_ins.coverage_specific_dollar',
  coverage_specific_dollar_amount: 'origination_ins.coverage_specific_dollar_amount',
  coverage_flood_building: 'origination_ins.coverage_flood_building',
  coverage_flood_contents: 'origination_ins.coverage_flood_contents',
  coverage_earthquake_amount: 'origination_ins.coverage_earthquake_amount',
  coverage_earthquake_percent: 'origination_ins.coverage_earthquake_percent',
  coverage_loss_rents_per_month: 'origination_ins.coverage_loss_rents_per_month',
  coverage_loss_rents_months: 'origination_ins.coverage_loss_rents_months',
  coverage_loss_rents_total: 'origination_ins.coverage_loss_rents_total',

  // Other Coverage
  oc_general_liability: 'origination_ins.oc_general_liability',
  oc_general_liability_amount: 'origination_ins.oc_general_liability_amount',
  oc_flood: 'origination_ins.oc_flood',
  oc_earthquake: 'origination_ins.oc_earthquake',
  oc_wind_hail: 'origination_ins.oc_wind_hail',
  oc_wind_hail_amount: 'origination_ins.oc_wind_hail_amount',
  oc_umbrella: 'origination_ins.oc_umbrella',
  oc_umbrella_months: 'origination_ins.oc_umbrella_months',
  oc_umbrella_per: 'origination_ins.oc_umbrella_per',
  oc_loss_of_rents: 'origination_ins.oc_loss_of_rents',
  oc_vacancy: 'origination_ins.oc_vacancy',
  oc_other: 'origination_ins.oc_other',
  oc_other_amount: 'origination_ins.oc_other_amount',

  // Required Endorsement
  re_mortgagee: 'origination_ins.re_mortgagee',
  re_loss_payee: 'origination_ins.re_loss_payee',
  re_additional_insured: 'origination_ins.re_additional_insured',
  re_builders_risk: 'origination_ins.re_builders_risk',

  // Send Notices
  sn_lenders: 'origination_ins.sn_lenders',
  sn_servicing_agent: 'origination_ins.sn_servicing_agent',
  sn_broker: 'origination_ins.sn_broker',

  // Multiple Lenders
  ml_endorse_behalf: 'origination_ins.ml_endorse_behalf',
  ml_authorized_endorse: 'origination_ins.ml_authorized_endorse',

  // Special Endorsement
  special_endorsement: 'origination_ins.special_endorsement',

  // Policy - Other & Replacement Cost & Dollar amount
  policy_other: 'origination_ins.policy_other',
  policy_other_text: 'origination_ins.policy_other_text',
  policy_other_amount: 'origination_ins.policy_other_amount',
  policy_replacement_cost: 'origination_ins.policy_replacement_cost',
  policy_dollar_amount: 'origination_ins.policy_dollar_amount',
};

export const OriginationInsuranceConditionsForm: React.FC<OriginationInsuranceConditionsFormProps> = ({
  values,
  onValueChange,
  disabled = false,
}) => {
  const v = (key: string) => values[key] || '';
  const sv = (key: string, val: string) => onValueChange(key, val);
  const bv = (key: string) => values[key] === 'true';
  const sbv = (key: string, val: boolean) => onValueChange(key, String(val));

  const renderCheckbox = (label: string, key: string) => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className="flex items-center gap-2">
        <Checkbox checked={bv(key)} onCheckedChange={(c) => sbv(key, !!c)} disabled={disabled} />
        <Label className="text-xs cursor-pointer">{label}</Label>
      </div>
    </DirtyFieldWrapper>
  );

  const renderCurrencyInline = (key: string, width = 'w-[90px]', placeholder = '0.00') => (
    <DirtyFieldWrapper fieldKey={key}>
      <div className={`relative inline-flex ${width}`}>
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
        <Input
          type="text" inputMode="decimal" value={v(key)}
          onChange={(e) => sv(key, unformatCurrencyDisplay(e.target.value))}
          onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (val) => sv(key, val))}
          onBlur={() => { const raw = v(key); if (raw) sv(key, formatCurrencyDisplay(raw)); }}
          onFocus={() => { const raw = v(key); if (raw) sv(key, unformatCurrencyDisplay(raw)); }}
          disabled={disabled} placeholder={placeholder} className="h-6 text-xs pl-5 text-right"
        />
      </div>
    </DirtyFieldWrapper>
  );

  return (
    <div className="p-3">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-4 gap-y-0">

        {/* ===== LEFT COLUMN ===== */}
        <div className="space-y-2 border-r border-border pr-4">
          {/* Coverage Details */}
          <h3 className="text-xs font-bold text-foreground border-b border-foreground pb-0.5 underline">Coverage Details</h3>
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center gap-1">
              <Label className="text-xs shrink-0">Minimum Carrier Rating:</Label>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <DirtyFieldWrapper fieldKey={FK.carrier_a_minus}>
                <Label className="text-xs cursor-pointer">A-</Label>
              </DirtyFieldWrapper>
              <DirtyFieldWrapper fieldKey={FK.carrier_a}>
                <Label className="text-xs cursor-pointer">A</Label>
              </DirtyFieldWrapper>
              <DirtyFieldWrapper fieldKey={FK.carrier_a_plus}>
                <Label className="text-xs cursor-pointer">A+</Label>
              </DirtyFieldWrapper>
              <DirtyFieldWrapper fieldKey={FK.carrier_other}>
                <div className="flex items-center gap-1">
                  <Label className="text-xs">Other:</Label>
                  <Input value={v(FK.carrier_other_text)} onChange={(e) => sv(FK.carrier_other_text, e.target.value)}
                    disabled={disabled} className="h-6 text-xs w-[70px]" />
                </div>
              </DirtyFieldWrapper>
            </div>
            <DirtyFieldWrapper fieldKey={FK.max_deductible}>
              <div className="flex items-center gap-2">
                <Label className="text-xs shrink-0">Maximum Deductible Allowed</Label>
                {renderCurrencyInline(FK.max_deductible, 'w-[100px]')}
              </div>
            </DirtyFieldWrapper>
          </div>

          {/* Policy Endorsements and Coverage */}
          <h3 className="text-xs font-bold text-foreground border-b border-foreground pb-0.5 underline pt-2">Policy Endorsements and Coverage</h3>
          <div className="space-y-1 pt-1">
            {renderCheckbox("Homeowner's Hazard Coverage", FK.policy_property_hazard)}
            {renderCheckbox('Dwelling Fire', FK.policy_dwelling_fire)}
            {renderCheckbox('General Liability', FK.policy_general_liability)}
            {renderCheckbox("Builder's Risk (Construction, Rehab)", FK.policy_builders_risk)}
            {renderCheckbox('Course of Construction', 'origination_ins.coverage_construction_checkbox')}
            <DirtyFieldWrapper fieldKey={FK.policy_other}>
              <div className="flex items-center gap-2">
                <Checkbox checked={bv(FK.policy_other)} onCheckedChange={(c) => sbv(FK.policy_other, !!c)} disabled={disabled} />
                <Label className="text-xs">Other</Label>
                <Input value={v(FK.policy_other_text)} onChange={(e) => sv(FK.policy_other_text, e.target.value)}
                  disabled={disabled} className="h-6 text-xs flex-1" />
                {renderCurrencyInline(FK.policy_other_amount, 'w-[100px]')}
              </div>
            </DirtyFieldWrapper>
            {renderCheckbox('Replacement Cost of Improvements, or', FK.coverage_replacement_cost)}
            <DirtyFieldWrapper fieldKey={FK.policy_dollar_amount}>
              <div className="flex items-center gap-2">
                <Checkbox checked={bv(FK.coverage_specific_dollar)} onCheckedChange={(c) => sbv(FK.coverage_specific_dollar, !!c)} disabled={disabled} />
                {renderCurrencyInline(FK.coverage_specific_dollar_amount, 'w-[100px]')}
              </div>
            </DirtyFieldWrapper>
          </div>
        </div>

        {/* ===== MIDDLE COLUMN ===== */}
        <div className="space-y-2 border-r border-border pr-4">
          {/* Other Coverage */}
          <h3 className="text-xs font-bold text-foreground border-b border-foreground pb-0.5 underline">Other Coverage</h3>
          <div className="space-y-1.5 pt-1">
            {/* General Liability */}
            <DirtyFieldWrapper fieldKey={FK.oc_general_liability}>
              <div className="flex items-center gap-2">
                <Checkbox checked={bv(FK.oc_general_liability)} onCheckedChange={(c) => sbv(FK.oc_general_liability, !!c)} disabled={disabled} />
                <Label className="text-xs shrink-0 min-w-[140px]">General Liability</Label>
                {renderCurrencyInline(FK.oc_general_liability_amount, 'w-[90px]', '0.00')}
              </div>
            </DirtyFieldWrapper>
            {/* Flood */}
            <DirtyFieldWrapper fieldKey={FK.oc_flood}>
              <div className="flex items-center gap-1 flex-wrap">
                <Checkbox checked={bv(FK.oc_flood)} onCheckedChange={(c) => sbv(FK.oc_flood, !!c)} disabled={disabled} />
                <Label className="text-xs shrink-0">Flood</Label>
                <Label className="text-xs shrink-0 ml-auto">Building</Label>
                {renderCurrencyInline(FK.coverage_flood_building, 'w-[70px]')}
                <Label className="text-xs shrink-0">Contents</Label>
                {renderCurrencyInline(FK.coverage_flood_contents, 'w-[70px]')}
              </div>
            </DirtyFieldWrapper>
            {/* Earthquake */}
            <DirtyFieldWrapper fieldKey={FK.oc_earthquake}>
              <div className="flex items-center gap-2">
                <Checkbox checked={bv(FK.oc_earthquake)} onCheckedChange={(c) => sbv(FK.oc_earthquake, !!c)} disabled={disabled} />
                <Label className="text-xs shrink-0 min-w-[140px]">Earthquake</Label>
                {renderCurrencyInline(FK.coverage_earthquake_amount)}
              </div>
            </DirtyFieldWrapper>
            {/* Wind / Hail / Named Storm */}
            <DirtyFieldWrapper fieldKey={FK.oc_wind_hail}>
              <div className="flex items-center gap-2">
                <Checkbox checked={bv(FK.oc_wind_hail)} onCheckedChange={(c) => sbv(FK.oc_wind_hail, !!c)} disabled={disabled} />
                <Label className="text-xs shrink-0 min-w-[140px]">Wind / Hail / Named Storm</Label>
                {renderCurrencyInline(FK.oc_wind_hail_amount)}
              </div>
            </DirtyFieldWrapper>
            {/* Umbrella / Excess Coverage */}
            <DirtyFieldWrapper fieldKey={FK.oc_umbrella}>
              <div className="flex items-center gap-1 flex-wrap">
                <Checkbox checked={bv(FK.oc_umbrella)} onCheckedChange={(c) => sbv(FK.oc_umbrella, !!c)} disabled={disabled} />
                <Label className="text-xs shrink-0">Umbrella / Excess Coverage</Label>
                <DirtyFieldWrapper fieldKey={FK.oc_umbrella_months}>
                  <Input value={v(FK.oc_umbrella_months)} onChange={(e) => sv(FK.oc_umbrella_months, e.target.value)}
                    onKeyDown={numericKeyDown} disabled={disabled || !bv(FK.oc_umbrella)} placeholder="0" inputMode="numeric"
                    className="h-6 text-xs w-[40px] text-right" />
                </DirtyFieldWrapper>
                <Label className="text-xs shrink-0">months of</Label>
                {renderCurrencyInline(FK.oc_umbrella_per, 'w-[70px]')}
                <Label className="text-xs shrink-0">per</Label>
              </div>
            </DirtyFieldWrapper>
            {/* Loss of Rents */}
            <DirtyFieldWrapper fieldKey={FK.oc_loss_of_rents}>
              <div className="flex items-center gap-2">
                <Checkbox checked={bv(FK.oc_loss_of_rents)} onCheckedChange={(c) => sbv(FK.oc_loss_of_rents, !!c)} disabled={disabled} />
                <Label className="text-xs shrink-0">Loss of Rents</Label>
              </div>
            </DirtyFieldWrapper>
            {/* Vacancy Endorsement Required */}
            <DirtyFieldWrapper fieldKey={FK.oc_vacancy}>
              <div className="flex items-center gap-2">
                <Checkbox checked={bv(FK.oc_vacancy)} onCheckedChange={(c) => sbv(FK.oc_vacancy, !!c)} disabled={disabled} />
                <Label className="text-xs shrink-0">Vacancy Endorsement Required</Label>
              </div>
            </DirtyFieldWrapper>
            {/* Other */}
            <DirtyFieldWrapper fieldKey={FK.oc_other}>
              <div className="flex items-center gap-2">
                <Checkbox checked={bv(FK.oc_other)} onCheckedChange={(c) => sbv(FK.oc_other, !!c)} disabled={disabled} />
                <Label className="text-xs shrink-0">Other</Label>
                {renderCurrencyInline(FK.oc_other_amount)}
              </div>
            </DirtyFieldWrapper>
          </div>

          {/* Required Endorsement */}
          <h3 className="text-xs font-bold text-foreground border-b border-foreground pb-0.5 underline pt-2">Required Endorsement (Check All Applicable)</h3>
          <div className="space-y-1 pt-1">
            {renderCheckbox("Lender(s) as Mortgagee", FK.re_mortgagee)}
            {renderCheckbox("Lender(s) as Loss Payee", FK.re_loss_payee)}
            {renderCheckbox("Lender(s) as Additional Insured", FK.re_additional_insured)}
            {renderCheckbox("Additional Insured on Builder's Risk", FK.re_builders_risk)}
          </div>
        </div>

        {/* ===== RIGHT COLUMN ===== */}
        <div className="space-y-2">
          {/* Send Notices To */}
          <h3 className="text-xs font-bold text-foreground border-b border-foreground pb-0.5 underline">Send Notices to:</h3>
          <div className="space-y-1 pt-1">
            {renderCheckbox('Send Notices to Lender(s)', FK.sn_lenders)}
            {renderCheckbox('Servicing Agent', FK.sn_servicing_agent)}
            {renderCheckbox('Broker', FK.sn_broker)}
          </div>

          {/* If Multiple Lenders Servicing Agent */}
          <h3 className="text-xs font-bold text-foreground border-b border-foreground pb-0.5 underline pt-2">If Multiple Lenders Servicing Agent:</h3>
          <div className="space-y-1 pt-1">
            {renderCheckbox('Will Endorse on behalf of Lender(s)', FK.ml_endorse_behalf)}
            {renderCheckbox('Is Authorized to Endorse Proceeds', FK.ml_authorized_endorse)}
          </div>

          {/* Special Endorsement Verbiage */}
          <h3 className="text-xs font-bold text-foreground border-b border-foreground pb-0.5 underline pt-2">Special Endorsement Verbiage</h3>
          <DirtyFieldWrapper fieldKey={FK.special_endorsement}>
            <Textarea value={v(FK.special_endorsement)} onChange={(e) => sv(FK.special_endorsement, e.target.value)}
              disabled={disabled} className="mt-1 text-xs min-h-[80px]" />
          </DirtyFieldWrapper>
        </div>
      </div>
    </div>
  );
};

export default OriginationInsuranceConditionsForm;
