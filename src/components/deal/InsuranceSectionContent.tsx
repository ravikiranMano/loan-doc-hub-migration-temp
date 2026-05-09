import React, { useState, useCallback, useMemo } from 'react';
import { useDealNavigationOptional } from '@/contexts/DealNavigationContext';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InsuranceSubNavigation, type InsuranceSubSection } from './InsuranceSubNavigation';
import { InsuranceTableView, type InsuranceData } from './InsuranceTableView';
import { InsuranceModal } from './InsuranceModal';
import { InsuranceDetailForm } from './InsuranceDetailForm';
import { useDirtyFields } from '@/contexts/DirtyFieldsContext';
import { DirtyFieldsProvider } from '@/contexts/DirtyFieldsContext';

interface InsuranceSectionContentProps {
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  onRemoveValuesByPrefix?: (prefix: string) => void;
  onPersist?: () => Promise<boolean>;
  disabled?: boolean;
  propertyOptions?: { id: string; label: string }[];
  /** Currently-selected property prefix (e.g., 'property1'). When provided, insurance records are
   *  scoped to this property: only matching records are shown, and new records default to it. */
  currentPropertyId?: string;
  onBack?: () => void;
  onRefresh?: () => void;
}

// Helper to extract allInsurances from values based on insurance prefix pattern
const extractInsurancesFromValues = (values: Record<string, string>): InsuranceData[] => {
  const allInsurances: InsuranceData[] = [];
  const insurancePrefixes = new Set<string>();
  
  // Find all insurance prefixes (insurance1, insurance2, etc.)
  Object.keys(values).forEach(key => {
    const match = key.match(/^(insurance\d+)\./);
    if (match) {
      insurancePrefixes.add(match[1]);
    }
  });
  
  // Build insurance objects from values
  insurancePrefixes.forEach(prefix => {
    const insurance: InsuranceData = {
      id: prefix,
      property: values[`${prefix}.property`] || '',
      description: values[`${prefix}.description`] || '',
      companyName: values[`${prefix}.company_name`] || '',
      policyNumber: values[`${prefix}.policy_number`] || '',
      expiration: values[`${prefix}.expiration`] || '',
      annualPremium: values[`${prefix}.annual_premium`] || '',
      frequency: values[`${prefix}.frequency`] || '',
      active: values[`${prefix}.active`] === 'true',
      agentName: values[`${prefix}.agent_name`] || '',
      businessAddress: values[`${prefix}.business_address`] || '',
      businessAddressCity: values[`${prefix}.business_address_city`] || '',
      businessAddressState: values[`${prefix}.business_address_state`] || '',
      businessAddressZip: values[`${prefix}.business_address_zip`] || '',
      phoneNumber: values[`${prefix}.phone_number`] || '',
      faxNumber: values[`${prefix}.fax_number`] || '',
      email: values[`${prefix}.email`] || '',
      note: values[`${prefix}.note`] || '',
      paymentMailingStreet: values[`${prefix}.payment_mailing_street`] || '',
      paymentMailingCity: values[`${prefix}.payment_mailing_city`] || '',
      paymentMailingState: values[`${prefix}.payment_mailing_state`] || '',
      paymentMailingZip: values[`${prefix}.payment_mailing_zip`] || '',
      insuranceTracking: values[`${prefix}.insurance_tracking`] === 'true',
      lastVerified: values[`${prefix}.last_verified`] || '',
      trackingStatus: values[`${prefix}.tracking_status`] || '',
      impoundsActive: values[`${prefix}.impounds_active`] === 'true',
      impoundedStatus: values[`${prefix}.impounded_status`] || '',
      redFlagTrigger: values[`${prefix}.red_flag_trigger`] || '',
      attemptAgent: values[`${prefix}.attempt_agent`] === 'true',
      attemptBorrower: values[`${prefix}.attempt_borrower`] === 'true',
      lenderNotified: values[`${prefix}.lender_notified`] === 'true',
      lenderNotifiedDate: values[`${prefix}.lender_notified_date`] || '',
    };
    // Only add if the insurance has meaningful data (not an empty shell after deletion)
    const hasData = Object.keys(insurance).some(key => {
      if (key === 'id' || key === 'active') return false;
      const val = (insurance as any)[key];
      return val !== undefined && val !== '';
    });
    if (hasData) {
      allInsurances.push(insurance);
    }
  });
  
  // Sort to ensure insurance1 comes first
  allInsurances.sort((a, b) => {
    const numA = parseInt(a.id.replace('insurance', ''));
    const numB = parseInt(b.id.replace('insurance', ''));
    return numA - numB;
  });
  
  return allInsurances;
};

// Get the next available insurance prefix
const getNextInsurancePrefix = (values: Record<string, string>): string => {
  const insurancePrefixes = new Set<string>();
  Object.keys(values).forEach(key => {
    const match = key.match(/^(insurance\d+)\./);
    if (match) {
      insurancePrefixes.add(match[1]);
    }
  });
  
  let nextNum = 1;
  while (insurancePrefixes.has(`insurance${nextNum}`)) {
    nextNum++;
  }
  return `insurance${nextNum}`;
};

export const InsuranceSectionContent: React.FC<InsuranceSectionContentProps> = ({
  values,
  onValueChange,
  onRemoveValuesByPrefix,
  onPersist,
  disabled = false,
  propertyOptions = [],
  onBack,
  onRefresh,
}) => {
  const nav = useDealNavigationOptional();
  const activeSubSection = (nav?.getSubSection('insurance') ?? 'insurances') as InsuranceSubSection;
  const setActiveSubSection = (sub: InsuranceSubSection) => nav?.setSubSection('insurance', sub);
  const selectedInsurancePrefix = nav?.getSelectedPrefix('insurance') ?? 'insurance1';
  const setSelectedInsurancePrefix = (prefix: string) => nav?.setSelectedPrefix('insurance', prefix);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingInsurance, setEditingInsurance] = useState<InsuranceData | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;
  const { dirtyFieldKeys } = useDirtyFields();

  // Remap dirty field keys: insuranceN.xxx → insurance1.xxx for selected prefix
  const remappedDirtyKeys = useMemo(() => {
    const remapped = new Set<string>();
    dirtyFieldKeys.forEach(key => {
      if (key.startsWith(`${selectedInsurancePrefix}.`)) {
        remapped.add(key.replace(`${selectedInsurancePrefix}.`, 'insurance1.'));
      }
    });
    return remapped;
  }, [dirtyFieldKeys, selectedInsurancePrefix]);
  
  // Check if we're in detail view
  const isDetailView = activeSubSection === 'insurance_details';
  
  // Extract allInsurances from values
  const allInsurances = extractInsurancesFromValues(values);
  const totalInsurances = allInsurances.length;
  const totalPages = Math.max(1, Math.ceil(totalInsurances / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedInsurances = allInsurances.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Get the selected insurance for detail view
  const selectedInsurance = useMemo(() => {
    return allInsurances.find(i => i.id === selectedInsurancePrefix) || {
      id: selectedInsurancePrefix,
      property: '',
      description: '',
      companyName: '',
      policyNumber: '',
      expiration: '',
      annualPremium: '',
      frequency: '',
      active: true,
      agentName: '',
      businessAddress: '',
      businessAddressCity: '',
      businessAddressState: '',
      businessAddressZip: '',
      phoneNumber: '',
      faxNumber: '',
      email: '',
      note: '',
      paymentMailingStreet: '',
      paymentMailingCity: '',
      paymentMailingState: '',
      paymentMailingZip: '',
      insuranceTracking: false,
      lastVerified: '',
      trackingStatus: '',
      impoundsActive: false,
      impoundedStatus: '',
      redFlagTrigger: '',
      attemptAgent: false,
      attemptBorrower: false,
      lenderNotified: false,
      lenderNotifiedDate: '',
    };
  }, [allInsurances, selectedInsurancePrefix]);

  // Get the selected insurance name for detail view header
  const selectedInsuranceName = useMemo(() => {
    if (selectedInsurance.description) {
      return selectedInsurance.description;
    }
    if (selectedInsurance.companyName) {
      return selectedInsurance.companyName;
    }
    return `Insurance ${selectedInsurancePrefix.replace('insurance', '')}`;
  }, [selectedInsurance, selectedInsurancePrefix]);

  // Handle adding a new insurance
  const handleAddInsurance = useCallback(() => {
    setEditingInsurance(null);
    setModalOpen(true);
  }, []);

  // Handle editing an insurance
  const handleEditInsurance = useCallback((insurance: InsuranceData) => {
    setEditingInsurance(insurance);
    setModalOpen(true);
  }, []);

  // Handle row click - navigate to insurance details
  const handleRowClick = useCallback((insurance: InsuranceData) => {
    setSelectedInsurancePrefix(insurance.id);
    setActiveSubSection('insurance_details');
  }, []);

  // Handle back navigation
  const handleBackToTable = useCallback(() => {
    setActiveSubSection('insurances');
  }, []);

  // Handle saving insurance from modal
  const handleSaveInsurance = useCallback((insuranceData: InsuranceData) => {
    const prefix = editingInsurance ? editingInsurance.id : getNextInsurancePrefix(values);
    const isEdit = !!editingInsurance;
    
    // Field map: InsuranceData key → db suffix, with defaults for new entries
    const fieldEntries: { key: keyof InsuranceData; dbField: string; defaultVal: string }[] = [
      { key: 'property', dbField: 'property', defaultVal: '' },
      { key: 'description', dbField: 'description', defaultVal: '' },
      { key: 'companyName', dbField: 'company_name', defaultVal: '' },
      { key: 'policyNumber', dbField: 'policy_number', defaultVal: '' },
      { key: 'expiration', dbField: 'expiration', defaultVal: '' },
      { key: 'annualPremium', dbField: 'annual_premium', defaultVal: '' },
      { key: 'frequency', dbField: 'frequency', defaultVal: '' },
      { key: 'active', dbField: 'active', defaultVal: 'true' },
      { key: 'agentName', dbField: 'agent_name', defaultVal: '' },
      { key: 'businessAddress', dbField: 'business_address', defaultVal: '' },
      { key: 'businessAddressCity', dbField: 'business_address_city', defaultVal: '' },
      { key: 'businessAddressState', dbField: 'business_address_state', defaultVal: '' },
      { key: 'businessAddressZip', dbField: 'business_address_zip', defaultVal: '' },
      { key: 'phoneNumber', dbField: 'phone_number', defaultVal: '' },
      { key: 'faxNumber', dbField: 'fax_number', defaultVal: '' },
      { key: 'email', dbField: 'email', defaultVal: '' },
      { key: 'note', dbField: 'note', defaultVal: '' },
      { key: 'paymentMailingStreet', dbField: 'payment_mailing_street', defaultVal: '' },
      { key: 'paymentMailingCity', dbField: 'payment_mailing_city', defaultVal: '' },
      { key: 'paymentMailingState', dbField: 'payment_mailing_state', defaultVal: '' },
      { key: 'paymentMailingZip', dbField: 'payment_mailing_zip', defaultVal: '' },
      { key: 'insuranceTracking', dbField: 'insurance_tracking', defaultVal: 'false' },
      { key: 'lastVerified', dbField: 'last_verified', defaultVal: '' },
      { key: 'trackingStatus', dbField: 'tracking_status', defaultVal: '' },
      { key: 'impoundsActive', dbField: 'impounds_active', defaultVal: 'false' },
      { key: 'impoundedStatus', dbField: 'impounded_status', defaultVal: '' },
      { key: 'redFlagTrigger', dbField: 'red_flag_trigger', defaultVal: '' },
      { key: 'attemptAgent', dbField: 'attempt_agent', defaultVal: 'false' },
      { key: 'attemptBorrower', dbField: 'attempt_borrower', defaultVal: 'false' },
      { key: 'lenderNotified', dbField: 'lender_notified', defaultVal: 'false' },
      { key: 'lenderNotifiedDate', dbField: 'lender_notified_date', defaultVal: '' },
    ];

    fieldEntries.forEach(({ key, dbField }) => {
      const val = String(insuranceData[key] ?? '');
      // Always write all fields for both new and edit to ensure the record appears in the grid
      onValueChange(`${prefix}.${dbField}`, val);
    });
    
    setModalOpen(false);
    // Trigger immediate backend persistence
    if (onPersist) {
      setTimeout(() => { onPersist(); }, 50);
    }
  }, [editingInsurance, values, onValueChange, onPersist]);

  const handleDeleteInsurance = useCallback((insurance: InsuranceData) => {
    if (onRemoveValuesByPrefix) {
      onRemoveValuesByPrefix(insurance.id);
    } else {
      Object.keys(values).forEach(key => {
        if (key.startsWith(`${insurance.id}.`)) onValueChange(key, '');
      });
    }
    if (onPersist) {
      setTimeout(() => { onPersist(); }, 50);
    }
  }, [values, onValueChange, onRemoveValuesByPrefix, onPersist]);

  // Handle insurance field change in detail view
  const handleInsuranceFieldChange = useCallback((field: keyof InsuranceData, value: string | boolean) => {
    const fieldKeyMap: Record<keyof InsuranceData, string> = {
      id: 'id',
      property: 'property',
      description: 'description',
      companyName: 'company_name',
      policyNumber: 'policy_number',
      expiration: 'expiration',
      annualPremium: 'annual_premium',
      frequency: 'frequency',
      active: 'active',
      agentName: 'agent_name',
      businessAddress: 'business_address',
      businessAddressCity: 'business_address_city',
      businessAddressState: 'business_address_state',
      businessAddressZip: 'business_address_zip',
      phoneNumber: 'phone_number',
      faxNumber: 'fax_number',
      email: 'email',
      note: 'note',
      paymentMailingStreet: 'payment_mailing_street',
      paymentMailingCity: 'payment_mailing_city',
      paymentMailingState: 'payment_mailing_state',
      paymentMailingZip: 'payment_mailing_zip',
      insuranceTracking: 'insurance_tracking',
      lastVerified: 'last_verified',
      trackingStatus: 'tracking_status',
      impoundsActive: 'impounds_active',
      impoundedStatus: 'impounded_status',
      redFlagTrigger: 'red_flag_trigger',
      attemptAgent: 'attempt_agent',
      attemptBorrower: 'attempt_borrower',
      lenderNotified: 'lender_notified',
      lenderNotifiedDate: 'lender_notified_date',
    };
    const dbField = fieldKeyMap[field];
    if (dbField && dbField !== 'id') {
      onValueChange(`${selectedInsurancePrefix}.${dbField}`, String(value));
    }
  }, [selectedInsurancePrefix, onValueChange]);

  const renderSubSectionContent = () => {
    switch (activeSubSection) {
      case 'insurances':
        return (
          <InsuranceTableView
            insurances={paginatedInsurances}
            onAddInsurance={handleAddInsurance}
            onEditInsurance={handleEditInsurance}
            onRowClick={handleRowClick}
            onDeleteInsurance={handleDeleteInsurance}
            onBack={onBack}
            onRefresh={onRefresh}
            disabled={disabled}
            currentPage={safePage}
            totalPages={totalPages}
            totalCount={totalInsurances}
            onPageChange={setCurrentPage}
          />
        );
      case 'insurance_details':
        return (
          <InsuranceDetailForm
            insurance={selectedInsurance}
            onChange={handleInsuranceFieldChange}
            disabled={disabled}
            propertyOptions={propertyOptions}
          />
        );
      default:
        return null;
    }
  };

  return (
    <>
      <div className="flex flex-col border border-border rounded-lg bg-background overflow-hidden">
        {/* Full-width breadcrumb header when in detail view */}
        {isDetailView && (
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/20">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBackToTable}
              className="gap-1 h-8"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <span className="text-sm font-medium text-foreground">
              {selectedInsuranceName}
            </span>
          </div>
        )}

        <div className="flex flex-1">
          {/* Sub-navigation tabs on the left - only shown in detail view */}
          <InsuranceSubNavigation
            activeSubSection={activeSubSection}
            onSubSectionChange={setActiveSubSection}
            isDetailView={isDetailView}
          />

          {/* Sub-section content on the right */}
          <div className="flex-1 min-w-0 overflow-auto">
            <DirtyFieldsProvider dirtyFieldKeys={remappedDirtyKeys}>
              {renderSubSectionContent()}
            </DirtyFieldsProvider>
          </div>
        </div>
      </div>

      {/* Add/Edit Insurance Modal */}
      <InsuranceModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        insurance={editingInsurance}
        onSave={handleSaveInsurance}
        isEdit={!!editingInsurance}
        propertyOptions={propertyOptions}
      />
    </>
  );
};

export default InsuranceSectionContent;
