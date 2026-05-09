import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useDealNavigationOptional } from '@/contexts/DealNavigationContext';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PropertySubNavigation, type PropertySubSection } from './PropertySubNavigation';
import { PropertyDetailsForm } from './PropertyDetailsForm';
import { PropertyLegalDescriptionForm } from './PropertyLegalDescriptionForm';
import { PropertyTaxForm } from './PropertyTaxForm';
import { PropertyTaxTableView, type PropertyTaxData } from './PropertyTaxTableView';
import { PropertyTaxModal } from './PropertyTaxModal';

import { PropertiesTableView, type PropertyData } from './PropertiesTableView';
import { PropertyModal } from './PropertyModal';
import { InsuranceSectionContent } from './InsuranceSectionContent';
import { LienSectionContent } from './LienSectionContent';
import { useDirtyFields } from '@/contexts/DirtyFieldsContext';
import { DirtyFieldsProvider } from '@/contexts/DirtyFieldsContext';
import type { FieldDefinition } from '@/hooks/useDealFields';
import type { CalculationResult } from '@/lib/calculationEngine';

interface PropertySectionContentProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  onRemoveValuesByPrefix?: (prefix: string) => void;
  onPersist?: () => Promise<boolean>;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
  onRefresh?: () => void;
}

// Helper to extract properties from values based on property prefix pattern
const extractPropertiesFromValues = (values: Record<string, string>): PropertyData[] => {
  const properties: PropertyData[] = [];
  const propertyPrefixes = new Set<string>();
  
  // Find all property prefixes (property1, property2, etc.)
  Object.keys(values).forEach(key => {
    const match = key.match(/^(property\d+)\./);
    if (match) {
      propertyPrefixes.add(match[1]);
    }
  });
  
  // Build property objects from values
  propertyPrefixes.forEach(prefix => {
    const property: PropertyData = {
      id: prefix,
      isPrimary: values[`${prefix}.primary_property`] === 'true',
      description: values[`${prefix}.description`] || '',
      street: values[`${prefix}.street`] || '',
      city: values[`${prefix}.city`] || '',
      state: values[`${prefix}.state`] || '',
      zipCode: values[`${prefix}.zip`] || '',
      county: values[`${prefix}.county`] || '',
      propertyType: values[`${prefix}.appraisal_property_type`] || '',
      occupancy: values[`${prefix}.appraisal_occupancy`] || '',
      appraisedValue: values[`${prefix}.appraised_value`] || '',
      appraisedDate: values[`${prefix}.appraised_date`] || '',
      ltv: values[`${prefix}.ltv`] || '',
      originationLtv: values[`${prefix}.origination_ltv`] || '',
      apn: values[`${prefix}.apn`] || '',
      loanPriority: values[`${prefix}.priority`] || '',
      floodZone: values[`${prefix}.flood_zone`] || '',
      fireZone: values[`${prefix}.fire_zone`] || '',
      landClassification: values[`${prefix}.land_classification`] || '',
      pledgedEquity: values[`${prefix}.pledged_equity`] || '',
      zoning: values[`${prefix}.zoning`] || '',
      performedBy: values[`${prefix}.appraisal_performed_by`] || '',
      copyBorrowerAddress: values[`${prefix}.copy_borrower_address`] === 'true',
      purchasePrice: values[`${prefix}.purchase_price`] || '',
      downPayment: values[`${prefix}.down_payment`] || '',
      delinquentTaxes: values[`${prefix}.delinquent_taxes`] || '',
      appraiserStreet: values[`${prefix}.appraiser_street`] || '',
      appraiserCity: values[`${prefix}.appraiser_city`] || '',
      appraiserState: values[`${prefix}.appraiser_state`] || '',
      appraiserZip: values[`${prefix}.appraiser_zip`] || '',
      appraiserPhone: values[`${prefix}.appraiser_phone`] || '',
      appraiserEmail: values[`${prefix}.appraiser_email`] || '',
      yearBuilt: values[`${prefix}.year_built`] || '',
      squareFeet: values[`${prefix}.square_feet`] || '',
      constructionType: values[`${prefix}.construction_type`] || '',
      monthlyIncome: values[`${prefix}.monthly_income`] || '',
      lienProtectiveEquity: values[`${prefix}.lien_protective_equity`] || '',
      sourceLienInfo: values[`${prefix}.source_lien_info`] || '',
      delinquencies60day: values[`${prefix}.delinquencies_60day`] === 'true',
      delinquenciesHowMany: values[`${prefix}.delinquencies_how_many`] || '',
      currentlyDelinquent: values[`${prefix}.currently_delinquent`] === 'true',
      paidByLoan: values[`${prefix}.paid_by_loan`] === 'true',
      sourceOfPayment: values[`${prefix}.source_of_payment`] || '',
      recordingNumber: values[`${prefix}.recording_number`] || '',
      primaryCollateral: values[`${prefix}.primary_collateral`] === 'true',
      purchaseDate: values[`${prefix}.purchase_date`] || '',
      propertyGeneratesIncome: values[`${prefix}.property_generates_income`] === 'true',
      netMonthlyIncome: values[`${prefix}.net_monthly_income`] || '',
      fromRent: values[`${prefix}.from_rent`] || '',
      fromOtherDescribe: values[`${prefix}.from_other_describe`] || '',
      valuationDate: values[`${prefix}.valuation_date`] || '',
      valuationType: values[`${prefix}.valuation_type`] || '',
      thirdPartyFullName: values[`${prefix}.third_party_full_name`] || '',
      thirdPartyStreet: values[`${prefix}.third_party_street`] || '',
      thirdPartyCity: values[`${prefix}.third_party_city`] || '',
      thirdPartyState: values[`${prefix}.third_party_state`] || '',
      thirdPartyZip: values[`${prefix}.third_party_zip`] || '',
      protectiveEquity: values[`${prefix}.protective_equity`] || '',
      cltv: values[`${prefix}.cltv`] || '',
      informationProvidedBy: values[`${prefix}.info_provided_by`] || '',
      propertyOwner: values[`${prefix}.property_owner`] || '',
    };
    properties.push(property);
  });
  
  // Sort to ensure property1 comes first
  properties.sort((a, b) => {
    const numA = parseInt(a.id.replace('property', ''));
    const numB = parseInt(b.id.replace('property', ''));
    return numA - numB;
  });
  
  return properties;
};

// Helper to extract property tax records from values
const extractPropertyTaxesFromValues = (values: Record<string, string>): PropertyTaxData[] => {
  const allTaxes: PropertyTaxData[] = [];
  const taxPrefixes = new Set<string>();
  
  Object.keys(values).forEach(key => {
    const match = key.match(/^(propertytax\d+)\./);
    if (match) taxPrefixes.add(match[1]);
  });
  
  taxPrefixes.forEach(prefix => {
    const tax: PropertyTaxData = {
      id: prefix,
      property: values[`${prefix}.property`] || '',
      authority: values[`${prefix}.authority`] || '',
      address: values[`${prefix}.address`] || '',
      type: values[`${prefix}.type`] || '',
      apn: values[`${prefix}.apn`] || '',
      memo: values[`${prefix}.memo`] || '',
      annualPayment: values[`${prefix}.annual_payment`] || '',
      amount: values[`${prefix}.amount`] || '',
      nextDue: values[`${prefix}.next_due`] || '',
      frequency: values[`${prefix}.frequency`] || '',
      escrowImpounds: values[`${prefix}.escrow_impounds`] || '',
      passThrough: values[`${prefix}.pass_through`] || '',
      taxConfidence: values[`${prefix}.tax_confidence`] || '',
      sourceOfInformation: values[`${prefix}.source_of_information`] || '',
      active: values[`${prefix}.active`] === 'true',
      lastVerified: values[`${prefix}.last_verified`] || '',
      lenderNotified: values[`${prefix}.lender_notified`] || '',
      current: values[`${prefix}.current`] === 'true',
      delinquent: values[`${prefix}.delinquent`] === 'true',
      delinquentAmount: values[`${prefix}.delinquent_amount`] || '',
      borrowerNotified: values[`${prefix}.borrower_notified`] === 'true',
      borrowerNotifiedDate: values[`${prefix}.borrower_notified_date`] || '',
      lenderNotifiedDate: values[`${prefix}.lender_notified_date`] || '',
      pmaStreet: values[`${prefix}.pma_street`] || '',
      pmaCity: values[`${prefix}.pma_city`] || '',
      pmaState: values[`${prefix}.pma_state`] || '',
      pmaZip: values[`${prefix}.pma_zip`] || '',
    };
    const hasData = Object.keys(tax).some(key => {
      if (key === 'id' || key === 'active' || key === 'current' || key === 'delinquent' || key === 'borrowerNotified') return false;
      const val = (tax as any)[key];
      return val !== undefined && val !== '';
    });
    if (hasData) allTaxes.push(tax);
  });
  
  allTaxes.sort((a, b) => {
    const numA = parseInt(a.id.replace('propertytax', ''));
    const numB = parseInt(b.id.replace('propertytax', ''));
    return numA - numB;
  });
  
  return allTaxes;
};

const getNextPropertyTaxPrefix = (values: Record<string, string>): string => {
  const prefixes = new Set<string>();
  Object.keys(values).forEach(key => {
    const match = key.match(/^(propertytax\d+)\./);
    if (match) prefixes.add(match[1]);
  });
  let nextNum = 1;
  while (prefixes.has(`propertytax${nextNum}`)) nextNum++;
  return `propertytax${nextNum}`;
};

// Get the next available property prefix
const getNextPropertyPrefix = (values: Record<string, string>): string => {
  const propertyPrefixes = new Set<string>();
  Object.keys(values).forEach(key => {
    const match = key.match(/^(property\d+)\./);
    if (match) {
      propertyPrefixes.add(match[1]);
    }
  });
  
  let nextNum = 1;
  while (propertyPrefixes.has(`property${nextNum}`)) {
    nextNum++;
  }
  return `property${nextNum}`;
};

export const PropertySectionContent: React.FC<PropertySectionContentProps> = ({
  fields,
  values,
  onValueChange,
  onRemoveValuesByPrefix,
  onPersist,
  showValidation = false,
  disabled = false,
  calculationResults = {},
  onRefresh,
}) => {
  const nav = useDealNavigationOptional();
  const activeSubSection = (nav?.getSubSection('property') ?? 'properties') as PropertySubSection;
  const setActiveSubSection = (sub: PropertySubSection) => nav?.setSubSection('property', sub);
  const selectedPropertyPrefix = nav?.getSelectedPrefix('property') ?? 'property1';
  const setSelectedPropertyPrefix = (prefix: string) => nav?.setSelectedPrefix('property', prefix);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState<PropertyData | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [taxModalOpen, setTaxModalOpen] = useState(false);
  const [editingTax, setEditingTax] = useState<PropertyTaxData | null>(null);
  const [taxCurrentPage, setTaxCurrentPage] = useState(1);
  const [selectedTaxPrefix, setSelectedTaxPrefix] = useState<string | null>(null);
  const PAGE_SIZE = 5;
  const { dirtyFieldKeys } = useDirtyFields();
  const { id: routeDealId } = useParams<{ id: string }>();

  // Borrower participants for Property Owner picker + Copy Borrower's Address.
  // Sourced directly from deal_participants (role='borrower') joined with contacts.
  const [borrowerParticipants, setBorrowerParticipants] = useState<Array<{
    name: string;
    street: string;
    city: string;
    state: string;
    zipCode: string;
  }>>([]);

  useEffect(() => {
    if (!routeDealId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: parts } = await supabase
          .from('deal_participants')
          .select('id, name, contact_id, role')
          .eq('deal_id', routeDealId)
          .eq('role', 'borrower');
        const rows = parts || [];
        const contactIds = rows.map(r => r.contact_id).filter((x): x is string => !!x);
        let contactMap: Record<string, any> = {};
        if (contactIds.length) {
          const { data: contacts } = await supabase
            .from('contacts')
            .select('id, full_name, contact_data')
            .in('id', contactIds);
          for (const c of contacts || []) contactMap[c.id] = c;
        }
        const list = rows.map(r => {
          const c = r.contact_id ? contactMap[r.contact_id] : null;
          const cd = (c?.contact_data || {}) as Record<string, string>;
          return {
            name: (c?.full_name || r.name || '').trim(),
            street: cd['address.street'] || '',
            city: cd['address.city'] || '',
            state: cd['address.state'] || '',
            zipCode: cd['address.zip'] || '',
          };
        }).filter(x => x.name);
        if (!cancelled) setBorrowerParticipants(list);
      } catch (e) {
        console.error('Failed to load borrower participants', e);
      }
    })();
    return () => { cancelled = true; };
  }, [routeDealId]);

  // Check if we're in detail view
  const isDetailView = ['property_details', 'legal_description'].includes(activeSubSection);
  
  // Check if insurance section is active (rendered separately)
  const isInsuranceSection = activeSubSection === 'insurance';

  // Check if property tax section is active (rendered separately like insurance)
  const isPropertyTaxSection = activeSubSection === 'property_tax_detail';

  // Check if liens section is active (rendered separately like insurance)
  const isLiensSection = activeSubSection === 'liens';

  // Remap dirty field keys: propertyN.xxx → property1.xxx for selected prefix
  // Also pass through lien/insurance keys for sub-sections
  const remappedDirtyKeys = useMemo(() => {
    const remapped = new Set<string>();
    dirtyFieldKeys.forEach(key => {
      if (key.startsWith(`${selectedPropertyPrefix}.`)) {
        remapped.add(key.replace(`${selectedPropertyPrefix}.`, 'property1.'));
      }
      // Pass through lien and insurance keys unchanged (they handle their own remapping)
      if (key.match(/^(lien\d+|insurance\d+|propertytax\d+)\./)) {
        remapped.add(key);
      }
    });
    return remapped;
  }, [dirtyFieldKeys, selectedPropertyPrefix]);
  
  const allProperties = extractPropertiesFromValues(values);
  const totalProperties = allProperties.length;
  const totalPages = Math.max(1, Math.ceil(totalProperties / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedProperties = allProperties.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  
  // Build property options for liens dropdown
  const propertyOptions = useMemo(() => {
    return allProperties.map(p => {
      const addressParts = [p.street, p.city, p.state, p.zipCode].filter(Boolean);
      const addressStr = addressParts.length > 0 ? addressParts.join(', ') : '';
      const label = p.description
        ? (addressStr ? `${p.description} - ${addressStr}` : p.description)
        : (addressStr || `Property ${p.id.replace('property', '')}`);
      return { id: p.id, label };
    });
  }, [allProperties]);

  // Borrower options + primary borrower address — sourced from deal_participants
  // (Participant Type = 'Borrower'). Falls back to in-form values if no participants.
  const borrowerOptions = useMemo(() => {
    if (borrowerParticipants.length > 0) {
      return Array.from(new Set(borrowerParticipants.map(b => b.name).filter(Boolean)));
    }
    const prefixes = new Set<string>();
    Object.keys(values).forEach(key => {
      const m = key.match(/^(borrower\d*)\./);
      if (m) prefixes.add(m[1]);
    });
    const names: string[] = [];
    Array.from(prefixes).sort().forEach(p => {
      const full = (values[`${p}.full_name`] || '').trim();
      const first = (values[`${p}.first_name`] || '').trim();
      const last = (values[`${p}.last_name`] || '').trim();
      const composed = full || [first, last].filter(Boolean).join(' ').trim();
      if (composed && !names.includes(composed)) names.push(composed);
    });
    return names;
  }, [values, borrowerParticipants]);

  // Address for "Copy Borrower's Address": prefer the selected Property Owner
  // (looked up among Borrower participants); fall back to the first borrower
  // participant; final fallback is the in-form primary borrower address.
  const selectedPropertyOwner = values[`${selectedPropertyPrefix}.property_owner`] || '';
  const primaryBorrowerAddress = useMemo(() => {
    if (borrowerParticipants.length > 0) {
      const match = borrowerParticipants.find(b => b.name === selectedPropertyOwner)
        || borrowerParticipants[0];
      return { street: match.street, city: match.city, state: match.state, zipCode: match.zipCode };
    }
    const prefixes = new Set<string>();
    Object.keys(values).forEach(key => {
      const m = key.match(/^(borrower\d+)\./);
      if (m) prefixes.add(m[1]);
    });
    let primary: string | null = null;
    for (const p of prefixes) {
      if (values[`${p}.is_primary`] === 'true') { primary = p; break; }
    }
    if (!primary) {
      const hasBase = Object.keys(values).some(k => k.startsWith('borrower.') && !k.match(/^borrower\d+\./));
      if (hasBase) primary = 'borrower';
    }
    if (!primary) return { street: '', city: '', state: '', zipCode: '' };
    return {
      street: values[`${primary}.address.street`] || '',
      city: values[`${primary}.address.city`] || '',
      state: values[`${primary}.address.state`] || values[`${primary}.state`] || '',
      zipCode: values[`${primary}.address.zip`] || '',
    };
  }, [values, borrowerParticipants, selectedPropertyOwner]);

  // Get the selected property name for detail view header
  const selectedPropertyName = useMemo(() => {
    const property = allProperties.find(p => p.id === selectedPropertyPrefix);
    if (property) {
      return property.description || property.street || `Property ${selectedPropertyPrefix.replace('property', '')}`;
    }
    return 'Property';
  }, [allProperties, selectedPropertyPrefix]);

  // Handle adding a new property
  const handleAddProperty = useCallback(() => {
    setEditingProperty(null);
    setModalOpen(true);
  }, []);

  // Handle editing a property
  const handleEditProperty = useCallback((property: PropertyData) => {
    setEditingProperty(property);
    setModalOpen(true);
  }, []);

  // Handle row click - navigate to property details
  const handleRowClick = useCallback((property: PropertyData) => {
    setSelectedPropertyPrefix(property.id);
    setActiveSubSection('property_details');
  }, []);

  // Handle back navigation
  const handleBackToTable = useCallback(() => {
    setActiveSubSection('properties');
  }, []);

  // Handle primary property change - only one can be primary
  const handlePrimaryChange = useCallback((propertyId: string, isPrimary: boolean) => {
    if (isPrimary) {
      // Unset all other properties as non-primary
      allProperties.forEach(p => {
        if (p.id !== propertyId) {
          onValueChange(`${p.id}.primary_property`, 'false');
        }
      });
    }
    onValueChange(`${propertyId}.primary_property`, String(isPrimary));
  }, [allProperties, onValueChange]);

  // Handle saving property from modal
  const handleSaveProperty = useCallback(async (propertyData: PropertyData) => {
    const prefix = editingProperty ? editingProperty.id : getNextPropertyPrefix(values);
    
    // Save all property fields
    onValueChange(`${prefix}.primary_property`, String(propertyData.isPrimary));
    onValueChange(`${prefix}.description`, propertyData.description);
    onValueChange(`${prefix}.street`, propertyData.street);
    onValueChange(`${prefix}.city`, propertyData.city);
    onValueChange(`${prefix}.state`, propertyData.state);
    onValueChange(`${prefix}.zip`, propertyData.zipCode);
    onValueChange(`${prefix}.county`, propertyData.county);
    onValueChange(`${prefix}.appraisal_property_type`, propertyData.propertyType);
    onValueChange(`${prefix}.appraisal_occupancy`, propertyData.occupancy);
    onValueChange(`${prefix}.appraised_value`, propertyData.appraisedValue);
    onValueChange(`${prefix}.appraised_date`, propertyData.appraisedDate);
    onValueChange(`${prefix}.ltv`, propertyData.ltv);
    // Persist Origination LTV only if explicitly provided AND there is no existing
    // origination value already saved for this property (immutable after creation
    // unless edited directly in the detail form).
    {
      const existingOrig = values[`${prefix}.origination_ltv`];
      const incomingOrig = (propertyData as any).originationLtv;
      if ((!existingOrig || existingOrig.trim() === '') && incomingOrig) {
        onValueChange(`${prefix}.origination_ltv`, incomingOrig);
      }
    }
    onValueChange(`${prefix}.apn`, propertyData.apn);
    onValueChange(`${prefix}.priority`, propertyData.loanPriority);
    onValueChange(`${prefix}.flood_zone`, propertyData.floodZone || '');
    onValueChange(`${prefix}.fire_zone`, propertyData.fireZone || '');
    onValueChange(`${prefix}.land_classification`, propertyData.landClassification || '');
    onValueChange(`${prefix}.pledged_equity`, propertyData.pledgedEquity || '');
    
    onValueChange(`${prefix}.zoning`, propertyData.zoning || '');
    onValueChange(`${prefix}.appraisal_performed_by`, propertyData.performedBy || '');
    onValueChange(`${prefix}.copy_borrower_address`, String(!!propertyData.copyBorrowerAddress));
    onValueChange(`${prefix}.purchase_price`, propertyData.purchasePrice || '');
    onValueChange(`${prefix}.down_payment`, propertyData.downPayment || '');
    onValueChange(`${prefix}.delinquent_taxes`, propertyData.delinquentTaxes || '');
    onValueChange(`${prefix}.appraiser_street`, propertyData.appraiserStreet || '');
    onValueChange(`${prefix}.appraiser_city`, propertyData.appraiserCity || '');
    onValueChange(`${prefix}.appraiser_state`, propertyData.appraiserState || '');
    onValueChange(`${prefix}.appraiser_zip`, propertyData.appraiserZip || '');
    onValueChange(`${prefix}.appraiser_phone`, propertyData.appraiserPhone || '');
    onValueChange(`${prefix}.appraiser_email`, propertyData.appraiserEmail || '');
    onValueChange(`${prefix}.year_built`, propertyData.yearBuilt || '');
    onValueChange(`${prefix}.square_feet`, propertyData.squareFeet || '');
    onValueChange(`${prefix}.construction_type`, propertyData.constructionType || '');
    onValueChange(`${prefix}.monthly_income`, propertyData.monthlyIncome || '');
    onValueChange(`${prefix}.lien_protective_equity`, propertyData.lienProtectiveEquity || '');
    onValueChange(`${prefix}.source_lien_info`, propertyData.sourceLienInfo || '');
    onValueChange(`${prefix}.delinquencies_60day`, String(!!propertyData.delinquencies60day));
    onValueChange(`${prefix}.delinquencies_how_many`, propertyData.delinquenciesHowMany || '');
    onValueChange(`${prefix}.currently_delinquent`, String(!!propertyData.currentlyDelinquent));
    onValueChange(`${prefix}.paid_by_loan`, String(!!propertyData.paidByLoan));
    onValueChange(`${prefix}.source_of_payment`, propertyData.sourceOfPayment || '');
    onValueChange(`${prefix}.recording_number`, propertyData.recordingNumber || '');
    onValueChange(`${prefix}.primary_collateral`, String(!!propertyData.primaryCollateral));
    onValueChange(`${prefix}.purchase_date`, propertyData.purchaseDate || '');
    onValueChange(`${prefix}.property_generates_income`, String(!!propertyData.propertyGeneratesIncome));
    onValueChange(`${prefix}.net_monthly_income`, propertyData.netMonthlyIncome || '');
    onValueChange(`${prefix}.from_rent`, propertyData.fromRent || '');
    onValueChange(`${prefix}.from_other_describe`, propertyData.fromOtherDescribe || '');
    onValueChange(`${prefix}.valuation_date`, propertyData.valuationDate || '');
    onValueChange(`${prefix}.valuation_type`, propertyData.valuationType || '');
    onValueChange(`${prefix}.third_party_full_name`, propertyData.thirdPartyFullName || '');
    onValueChange(`${prefix}.third_party_street`, propertyData.thirdPartyStreet || '');
    onValueChange(`${prefix}.info_provided_by`, propertyData.informationProvidedBy || '');
    onValueChange(`${prefix}.third_party_city`, propertyData.thirdPartyCity || '');
    onValueChange(`${prefix}.third_party_state`, propertyData.thirdPartyState || '');
    onValueChange(`${prefix}.third_party_zip`, propertyData.thirdPartyZip || '');
    onValueChange(`${prefix}.protective_equity`, propertyData.protectiveEquity || '');
    onValueChange(`${prefix}.cltv`, propertyData.cltv || '');
    onValueChange(`${prefix}.property_owner`, propertyData.propertyOwner || '');
    
    // If this is marked as primary, unset others
    if (propertyData.isPrimary) {
      allProperties.forEach(p => {
        if (p.id !== prefix) {
          onValueChange(`${p.id}.primary_property`, 'false');
        }
      });
    }
    
    setModalOpen(false);

    // Immediately persist to backend
    if (onPersist) {
      setTimeout(() => { onPersist(); }, 50);
    }
  }, [editingProperty, values, onValueChange, allProperties, onPersist]);

  // Handle deleting a property
  const handleDeleteProperty = useCallback((property: PropertyData) => {
    if (onRemoveValuesByPrefix) {
      onRemoveValuesByPrefix(property.id);
    } else {
      Object.keys(values).forEach(key => {
        if (key.startsWith(`${property.id}.`)) {
          onValueChange(key, '');
        }
      });
    }
    // Immediately persist deletion to backend
    if (onPersist) {
      setTimeout(() => { onPersist(); }, 50);
    }
  }, [values, onValueChange, onRemoveValuesByPrefix, onPersist]);

  // ── Property Tax multi-entity ──
  // Scope tax records to the currently-selected property so taxes added under Property A
  // never appear under Property B/C, etc. The PropertyTax modal stores the property dropdown
  // value as the property *label* (e.g., "123 Main St, City, ST"), so we filter and force-bind
  // by label to keep the UI display intact.
  const selectedPropertyLabel = useMemo(() => {
    return propertyOptions.find(p => p.id === selectedPropertyPrefix)?.label || '';
  }, [propertyOptions, selectedPropertyPrefix]);
  const allPropertyTaxesRaw = extractPropertyTaxesFromValues(values);
  const allPropertyTaxes = useMemo(() => {
    if (!selectedPropertyLabel) return allPropertyTaxesRaw;
    return allPropertyTaxesRaw.filter(t => t.property === selectedPropertyLabel);
  }, [allPropertyTaxesRaw, selectedPropertyLabel]);
  const totalTaxes = allPropertyTaxes.length;
  const taxTotalPages = Math.max(1, Math.ceil(totalTaxes / PAGE_SIZE));
  const taxSafePage = Math.min(taxCurrentPage, taxTotalPages);
  const paginatedTaxes = allPropertyTaxes.slice((taxSafePage - 1) * PAGE_SIZE, taxSafePage * PAGE_SIZE);

  const handleAddTax = useCallback(() => { setEditingTax(null); setTaxModalOpen(true); }, []);
  const handleEditTax = useCallback((tax: PropertyTaxData) => { setEditingTax(tax); setTaxModalOpen(true); }, []);
  const handleRowClickTax = useCallback((tax: PropertyTaxData) => {
    setSelectedTaxPrefix(tax.id);
    setActiveSubSection('property_tax_detail');
  }, []);
  const handleRowClickTaxDetail = useCallback((tax: PropertyTaxData) => {
    setSelectedTaxPrefix(tax.id);
  }, []);

  const handleBackToTaxTable = useCallback(() => {
    setSelectedTaxPrefix(null);
  }, []);

  const handleSaveTax = useCallback((taxData: PropertyTaxData) => {
    const prefix = editingTax ? editingTax.id : getNextPropertyTaxPrefix(values);
    // Force-bind to the currently-selected property so records cannot leak across properties
    // even if the property field was left blank in the modal.
    if (selectedPropertyLabel) {
      taxData = { ...taxData, property: selectedPropertyLabel };
    }
    const fieldEntries: { key: keyof PropertyTaxData; dbField: string }[] = [
      { key: 'property', dbField: 'property' },
      { key: 'authority', dbField: 'authority' },
      { key: 'address', dbField: 'address' },
      { key: 'type', dbField: 'type' },
      { key: 'apn', dbField: 'apn' },
      { key: 'memo', dbField: 'memo' },
      { key: 'annualPayment', dbField: 'annual_payment' },
      { key: 'amount', dbField: 'amount' },
      { key: 'nextDue', dbField: 'next_due' },
      { key: 'frequency', dbField: 'frequency' },
      { key: 'escrowImpounds', dbField: 'escrow_impounds' },
      { key: 'passThrough', dbField: 'pass_through' },
      { key: 'taxConfidence' as keyof PropertyTaxData, dbField: 'tax_confidence' },
      { key: 'sourceOfInformation', dbField: 'source_of_information' },
      { key: 'active', dbField: 'active' },
      { key: 'lastVerified', dbField: 'last_verified' },
      { key: 'lenderNotified', dbField: 'lender_notified' },
      { key: 'current', dbField: 'current' },
      { key: 'delinquent', dbField: 'delinquent' },
      { key: 'delinquentAmount', dbField: 'delinquent_amount' },
      { key: 'borrowerNotified', dbField: 'borrower_notified' },
      { key: 'borrowerNotifiedDate', dbField: 'borrower_notified_date' },
      { key: 'lenderNotifiedDate', dbField: 'lender_notified_date' },
      { key: 'pmaStreet', dbField: 'pma_street' },
      { key: 'pmaCity', dbField: 'pma_city' },
      { key: 'pmaState', dbField: 'pma_state' },
      { key: 'pmaZip', dbField: 'pma_zip' },
    ];
    fieldEntries.forEach(({ key, dbField }) => {
      onValueChange(`${prefix}.${dbField}`, String(taxData[key] ?? ''));
    });
    setTaxModalOpen(false);
    if (onPersist) setTimeout(() => { onPersist(); }, 50);
  }, [editingTax, values, onValueChange, onPersist, selectedPropertyLabel]);

  const handleDeleteTax = useCallback((tax: PropertyTaxData) => {
    if (onRemoveValuesByPrefix) {
      onRemoveValuesByPrefix(tax.id);
    } else {
      Object.keys(values).forEach(key => {
        if (key.startsWith(`${tax.id}.`)) onValueChange(key, '');
      });
    }
    if (onPersist) setTimeout(() => { onPersist(); }, 50);
  }, [values, onValueChange, onRemoveValuesByPrefix, onPersist]);

  // Create property-specific values for the detail forms
  const getPropertySpecificValues = (): Record<string, string> => {
    const result: Record<string, string> = {};
    Object.entries(values).forEach(([key, value]) => {
      // Replace the current property prefix with property1 for the form
      if (key.startsWith(`${selectedPropertyPrefix}.`)) {
        const fieldName = key.replace(`${selectedPropertyPrefix}.`, 'property1.');
        result[fieldName] = value;
      } else if (key.startsWith('property1.') && selectedPropertyPrefix !== 'property1') {
        // Don't include property1 fields if we're editing a different property
      } else {
        result[key] = value;
      }
    });
    return result;
  };

  // Handle value change for property-specific forms
  const handlePropertyValueChange = (fieldKey: string, value: string) => {
    // Replace property1 with the selected property prefix
    const actualKey = fieldKey.replace('property1.', `${selectedPropertyPrefix}.`);
    onValueChange(actualKey, value);
  };

  const renderSubSectionContent = () => {
    switch (activeSubSection) {
      case 'properties':
        return (
          <PropertiesTableView
            properties={paginatedProperties}
            onAddProperty={handleAddProperty}
            onEditProperty={handleEditProperty}
            onRowClick={handleRowClick}
            onPrimaryChange={handlePrimaryChange}
            onDeleteProperty={handleDeleteProperty}
            onRefresh={onRefresh}
            disabled={disabled}
            currentPage={safePage}
            totalPages={totalPages}
            totalCount={totalProperties}
            onPageChange={setCurrentPage}
          />
        );
      case 'property_details':
        return (
          <PropertyDetailsForm
            fields={fields}
            values={getPropertySpecificValues()}
            onValueChange={handlePropertyValueChange}
            showValidation={showValidation}
            disabled={disabled}
            calculationResults={calculationResults}
            borrowerOptions={borrowerOptions}
            borrowerAddress={primaryBorrowerAddress}
          />
        );
      case 'legal_description':
        return (
          <PropertyLegalDescriptionForm
            fields={fields}
            values={getPropertySpecificValues()}
            onValueChange={handlePropertyValueChange}
            showValidation={showValidation}
            disabled={disabled}
            calculationResults={calculationResults}
          />
        );
      case 'insurance':
        // Insurance section is handled separately below
        return null;
      case 'property_tax_detail':
        // Property Tax section is handled separately below (like insurance)
        return null;
      default:
        return null;
    }
  };

  // Render Insurance section separately (has its own table/detail view pattern)
  if (isInsuranceSection) {
    return (
      <>
        <div className="flex flex-col border border-border rounded-lg bg-background overflow-hidden">
          <div className="flex flex-1">
            {/* Sub-navigation tabs on the left */}
            <PropertySubNavigation
              activeSubSection={activeSubSection}
              onSubSectionChange={setActiveSubSection}
              isDetailView={false}
            />

            {/* Insurance content */}
            <div className="flex-1 min-w-0 overflow-auto">
              <DirtyFieldsProvider dirtyFieldKeys={remappedDirtyKeys}>
                <InsuranceSectionContent
                  values={values}
                  onValueChange={onValueChange}
                  onRemoveValuesByPrefix={onRemoveValuesByPrefix}
                  onPersist={onPersist}
                  disabled={disabled}
                  propertyOptions={propertyOptions}
                  currentPropertyId={selectedPropertyPrefix}
                  onBack={handleBackToTable}
                />
              </DirtyFieldsProvider>
            </div>
          </div>
        </div>
      </>
    );
  }

  // Render Liens section separately (has its own table/detail view pattern like insurance)
  if (isLiensSection) {
    return (
      <>
        <div className="flex flex-col border border-border rounded-lg bg-background overflow-hidden">
          <div className="flex flex-1">
            <PropertySubNavigation
              activeSubSection={activeSubSection}
              onSubSectionChange={setActiveSubSection}
              isDetailView={true}
            />
            <div className="flex-1 min-w-0 overflow-auto">
              <DirtyFieldsProvider dirtyFieldKeys={remappedDirtyKeys}>
                <LienSectionContent
                  values={values}
                  onValueChange={onValueChange}
                  onRemoveValuesByPrefix={onRemoveValuesByPrefix}
                  onPersist={onPersist}
                  disabled={disabled}
                  propertyOptions={propertyOptions}
                  currentPropertyId={selectedPropertyPrefix}
                  onBack={handleBackToTable}
                  onRefresh={onRefresh}
                />
              </DirtyFieldsProvider>
            </div>
          </div>
        </div>
      </>
    );
  }

  // Render Property Tax section separately (has its own table/detail view pattern like insurance)
  if (isPropertyTaxSection) {
    const renderPropertyTaxContent = () => {
      if (!selectedTaxPrefix) {
        return (
          <PropertyTaxTableView
            taxes={paginatedTaxes}
            onAddTax={handleAddTax}
            onEditTax={handleEditTax}
            onRowClick={handleRowClickTaxDetail}
            onDeleteTax={handleDeleteTax}
            onBack={handleBackToTable}
            onRefresh={onRefresh}
            disabled={disabled}
            currentPage={taxSafePage}
            totalPages={taxTotalPages}
            totalCount={totalTaxes}
            onPageChange={setTaxCurrentPage}
          />
        );
      }

      // A tax record is selected — show back button + detail form
      const taxSpecificValues: Record<string, string> = {};
      Object.entries(values).forEach(([key, value]) => {
        if (key.startsWith(`${selectedTaxPrefix}.`)) {
          taxSpecificValues[key.replace(`${selectedTaxPrefix}.`, 'propertytax1.')] = value;
        } else {
          taxSpecificValues[key] = value;
        }
      });
      const handleTaxValueChange = (fieldKey: string, value: string) => {
        const actualKey = fieldKey.replace('propertytax1.', `${selectedTaxPrefix}.`);
        onValueChange(actualKey, value);
      };
      return (
        <div className="flex flex-col">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/20">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBackToTaxTable}
              className="gap-1 h-8"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <span className="text-sm font-medium text-foreground">
              Property Tax {selectedTaxPrefix.replace('propertytax', '')}
            </span>
          </div>
          <PropertyTaxForm
            fields={fields}
            values={taxSpecificValues}
            onValueChange={handleTaxValueChange}
            showValidation={showValidation}
            disabled={disabled}
            calculationResults={calculationResults}
            propertyOptions={propertyOptions.map(p => p.label)}
          />
        </div>
      );
    };

    return (
      <>
        <div className="flex flex-col border border-border rounded-lg bg-background overflow-hidden">
          <div className="flex flex-1">
            {/* Sub-navigation tabs on the left */}
            <PropertySubNavigation
              activeSubSection={activeSubSection}
              onSubSectionChange={setActiveSubSection}
              isDetailView={false}
            />

            {/* Property Tax content */}
            <div className="flex-1 min-w-0 overflow-auto">
              <DirtyFieldsProvider dirtyFieldKeys={remappedDirtyKeys}>
                {renderPropertyTaxContent()}
              </DirtyFieldsProvider>
            </div>
          </div>
        </div>

        {/* Add/Edit Property Tax Modal */}
        <PropertyTaxModal
          open={taxModalOpen}
          onOpenChange={setTaxModalOpen}
          propertyTax={editingTax}
          onSave={handleSaveTax}
          isEdit={!!editingTax}
          propertyOptions={propertyOptions.map(p => p.label)}
        />
      </>
    );
  }


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
          </div>
        )}

        <div className="flex flex-1">
          {/* Sub-navigation tabs on the left - only shown in detail view */}
          <PropertySubNavigation
            activeSubSection={activeSubSection}
            onSubSectionChange={setActiveSubSection}
            isDetailView={isDetailView}
          />

          {/* Sub-section content on the right, with remapped dirty keys */}
          <div className="flex-1 min-w-0 overflow-auto">
            <DirtyFieldsProvider dirtyFieldKeys={remappedDirtyKeys}>
              {renderSubSectionContent()}
            </DirtyFieldsProvider>
          </div>
        </div>
      </div>

      {/* Add/Edit Property Modal */}
      <PropertyModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        property={editingProperty}
        onSave={handleSaveProperty}
        isEdit={!!editingProperty}
        borrowerOptions={borrowerOptions}
        borrowerAddress={primaryBorrowerAddress}
      />

      {/* Add/Edit Property Tax Modal */}
      <PropertyTaxModal
        open={taxModalOpen}
        onOpenChange={setTaxModalOpen}
        propertyTax={editingTax}
        onSave={handleSaveTax}
        isEdit={!!editingTax}
        propertyOptions={propertyOptions.map(p => p.label)}
      />
    </>
  );
};

export default PropertySectionContent;
