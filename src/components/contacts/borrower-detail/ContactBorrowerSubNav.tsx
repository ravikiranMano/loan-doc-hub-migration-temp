import React from 'react';
import { cn } from '@/lib/utils';

export type ContactBorrowerSubSection = 'primary' | 'co_borrower' | 'additional_guarantor' | 'authorized_party' | 'trust_ledger' | 'banking' | 'tax_detail';

interface ContactBorrowerSubNavProps {
  activeSubSection: ContactBorrowerSubSection;
  onSubSectionChange: (sub: ContactBorrowerSubSection) => void;
}

const SECTIONS: { key: ContactBorrowerSubSection; label: string }[] = [
  { key: 'primary', label: 'Borrower' },
  { key: 'co_borrower', label: 'Co-borrower' },
  { key: 'additional_guarantor', label: 'Additional Guarantor' },
  { key: 'authorized_party', label: 'Authorized Party' },
  { key: 'trust_ledger', label: 'Trust Ledger' },
  { key: 'banking', label: 'Banking' },
  { key: 'tax_detail', label: '1099' },
];

export const ContactBorrowerSubNav: React.FC<ContactBorrowerSubNavProps> = ({
  activeSubSection,
  onSubSectionChange,
}) => (
  <div className="flex flex-col border-r border-border bg-background min-w-[180px]">
    {SECTIONS.map((section) => (
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
