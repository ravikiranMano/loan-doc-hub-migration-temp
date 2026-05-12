import React from 'react';
import { cn } from '@/lib/utils';

export type LoanTermsSubSection = 'balances_loan_details' | 'details' | 'penalties' | 'servicing' | 'history' | 'trust_ledger' | 'escrow_impound';

interface LoanTermsSubNavigationProps {
  activeSubSection: LoanTermsSubSection;
  onSubSectionChange: (subSection: LoanTermsSubSection) => void;
}

const LOAN_TERMS_SECTIONS: { key: LoanTermsSubSection; label: string }[] = [
  { key: 'balances_loan_details', label: 'Terms & Balances' },
  { key: 'details', label: 'Loan Details' },
  { key: 'penalties', label: 'Penalties' },
  { key: 'servicing', label: 'Servicing Details' },
  { key: 'history', label: 'History' },
  { key: 'trust_ledger', label: 'Trust Ledger' },
  { key: 'escrow_impound', label: 'Escrow Impound' },
];

export const LoanTermsSubNavigation: React.FC<LoanTermsSubNavigationProps> = ({
  activeSubSection,
  onSubSectionChange,
}) => {
  return (
    <div className="flex flex-col border-r border-border bg-background min-w-[180px]">
      {LOAN_TERMS_SECTIONS.map((section) => (
        <button
          key={section.key}
          onClick={() => onSubSectionChange(section.key)}
          className={cn(
            'px-4 py-3 text-sm font-medium transition-colors text-left border-l-2',
            activeSubSection === section.key
              ? 'border-primary text-foreground bg-muted/30'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/20'
          )}
        >
          {section.label}
        </button>
      ))}
    </div>
  );
};

export default LoanTermsSubNavigation;
