import React from 'react';
import { LoanTermsSubNavigation, type LoanTermsSubSection } from './LoanTermsSubNavigation';
import { useDealNavigationOptional } from '@/contexts/DealNavigationContext';
import { LoanTermsBalancesForm } from './LoanTermsBalancesForm';
import { LoanTermsDetailsForm } from './LoanTermsDetailsForm';
import { LoanTermsPenaltiesForm } from './LoanTermsPenaltiesForm';
import { LoanTermsServicingForm } from './LoanTermsServicingForm';
import { LoanHistoryViewer } from './LoanHistoryViewer';
import { LoanTrustLedger } from './LoanTrustLedger';
import { DealSectionTab } from './DealSectionTab';
import { EscrowImpoundForm } from './EscrowImpoundForm';
import type { FieldDefinition } from '@/hooks/useDealFields';
import type { CalculationResult } from '@/lib/calculationEngine';

interface LoanTermsSectionContentProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
  dealId?: string;
  escrowFields?: FieldDefinition[];
}

const ComingSoonInline: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex items-center justify-center min-h-[300px]">
    <div className="text-center space-y-2">
      <h1 className="text-4xl font-bold text-foreground tracking-tight" style={{ fontFamily: "'Brush Script MT', cursive" }}>
        Coming
      </h1>
      <p className="text-3xl font-extrabold uppercase tracking-widest text-foreground/80">
        SOON
      </p>
      <p className="text-sm text-muted-foreground pt-2">
        {label} is under development. Data will be available soon.
      </p>
    </div>
  </div>
);

export const LoanTermsSectionContent: React.FC<LoanTermsSectionContentProps> = ({
  fields,
  values,
  onValueChange,
  showValidation = false,
  disabled = false,
  calculationResults = {},
  dealId = '',
  escrowFields = [],
}) => {
  const nav = useDealNavigationOptional();
  const activeSubSection = (nav?.getSubSection('loan_terms') ?? 'balances_loan_details') as LoanTermsSubSection;
  const setActiveSubSection = (sub: LoanTermsSubSection) => nav?.setSubSection('loan_terms', sub);

  const renderSubSectionContent = () => {
    switch (activeSubSection) {
      case 'balances_loan_details':
        return (
          <LoanTermsBalancesForm
            fields={fields}
            values={values}
            onValueChange={onValueChange}
            showValidation={showValidation}
            disabled={disabled}
            calculationResults={calculationResults}
          />
        );
      case 'details':
        return (
          <LoanTermsDetailsForm
            fields={fields}
            values={values}
            onValueChange={onValueChange}
            showValidation={showValidation}
            disabled={disabled}
            calculationResults={calculationResults}
          />
        );
      case 'penalties':
        return (
          <LoanTermsPenaltiesForm
            fields={fields}
            values={values}
            onValueChange={onValueChange}
            showValidation={showValidation}
            disabled={disabled}
            calculationResults={calculationResults}
          />
        );
      case 'servicing':
        return (
          <LoanTermsServicingForm
            fields={fields}
            values={values}
            onValueChange={onValueChange}
            showValidation={showValidation}
            disabled={disabled}
            calculationResults={calculationResults}
            dealId={dealId}
          />
        );
      case 'history':
        return (
          <div className="p-4">
            <LoanHistoryViewer dealId={dealId} disabled={disabled} />
          </div>
        );
      case 'trust_ledger':
        return (
          <div className="p-4">
            <LoanTrustLedger
              values={values}
              onValueChange={onValueChange}
              disabled={disabled}
            />
          </div>
        );
      case 'escrow_impound':
        return (
          <div className="p-4">
            <EscrowImpoundForm
              fields={escrowFields}
              values={values}
              onValueChange={onValueChange}
              showValidation={showValidation}
              disabled={disabled}
              calculationResults={calculationResults}
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex border border-border rounded-lg bg-background">
      <LoanTermsSubNavigation
        activeSubSection={activeSubSection}
        onSubSectionChange={setActiveSubSection}
      />
      <div className="flex-1 min-w-0 overflow-auto">
        {renderSubSectionContent()}
      </div>
    </div>
  );
};

export default LoanTermsSectionContent;
