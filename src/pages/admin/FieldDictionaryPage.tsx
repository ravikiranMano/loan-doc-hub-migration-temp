import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/supabasePagination';
import { 
  Plus, 
  Search, 
  Key, 
  Loader2, 
  Download,
  Asterisk,
  X
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface FieldDictionary {
  id: string;
  field_key: string;
  label: string;
  section: string;
  data_type: string;
  form_type: string;
  is_calculated: boolean;
  is_repeatable: boolean;
  is_mandatory: boolean;
  description: string | null;
  default_value: string | null;
  validation_rule: string | null;
  allowed_roles: string[];
  read_only_roles: string[];
}

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'csr', label: 'CSR' },
  { value: 'borrower', label: 'Borrower' },
  { value: 'broker', label: 'Broker' },
  { value: 'lender', label: 'Lender' },
];

// The deal-page top-nav sections (no Events Journal — it has no DB fields)
// Note: "Liens" was previously a sibling section; it now lives under "Property"
// as a sub-form group (see SECTION_FORMS.property below). DB section "liens"
// is unchanged — only the admin Field Dictionary hierarchy reflects this.
const SECTIONS = [
  { value: 'borrower', label: 'Borrower' },
  { value: 'loan_terms', label: 'Loan' },
  { value: 'property', label: 'Property' },
  { value: 'funding', label: 'Funding' },
  { value: 'broker', label: 'Broker' },
  { value: 'charges', label: 'Charges' },
  { value: 'escrow', label: 'Escrow Impound' },
  { value: 'notes', label: 'Conversation Log' },
  { value: 'lender', label: 'Lenders' },
  { value: 'origination_fees', label: 'Other Origination' },
];

// Map UI section → DB section(s) used for filtering
const SECTION_TO_DB: Record<string, string[]> = {
  borrower: ['borrower', 'co_borrower'],
  loan_terms: ['loan_terms'],
  // Property now also surfaces liens fields (Liens grouped under Property)
  property: ['property', 'insurance', 'liens'],
  funding: ['loan_terms'], // filtered further by form_type = 'funding'
  broker: ['broker'],
  charges: ['charges'],
  escrow: ['escrow'],
  notes: ['notes'],
  lender: ['lender'],
  origination_fees: ['origination_fees'],
};

// All valid DB sections we show (everything else is scaffolding/excluded)
const VALID_DB_SECTIONS = new Set([
  'borrower', 'co_borrower', 'loan_terms', 'property', 'insurance',
  'broker', 'charges', 'escrow', 'notes', 'lender', 'origination_fees', 'liens',
]);

// Forms per UI section — must match the actual sub-navigation in the deal UI
const SECTION_FORMS: Record<string, { value: string; label: string; dbSection?: string }[]> = {
  borrower: [
    { value: 'primary', label: 'Primary Borrower' },
    { value: 'co_borrower', label: 'Co-Borrower', dbSection: 'co_borrower' },
    { value: 'additional_guarantor', label: 'Additional Guarantor' },
    { value: 'authorized_party', label: 'Authorized Party' },
    { value: 'trust_ledger', label: 'Trust Ledger' },
    { value: 'banking', label: 'Banking' },
    { value: 'tax', label: '1098' },
  ],
  loan_terms: [
    { value: 'balances_loan_details', label: 'Terms & Balances' },
    { value: 'details', label: 'Details' },
    { value: 'penalties', label: 'Penalties' },
    { value: 'servicing', label: 'Servicing' },
  ],
  property: [
    { value: 'property_details', label: 'Property Details' },
    { value: 'legal_description', label: 'Legal Description' },
    { value: 'insurance', label: 'Insurance', dbSection: 'insurance' },
    { value: 'property_tax', label: 'Property Tax' },
    // Liens — grouped under Property as a single unified entry. The previous
    // four sub-forms (general_details, loan_type, balance_payment,
    // recording_tracking) are merged here. Filter logic surfaces every row
    // where section = 'liens' regardless of its persisted form_type, so no
    // existing data is hidden and field keys remain unchanged.
    // NOTE: value intentionally does NOT start with "liens_" so the filter
    // logic does not strip a prefix and instead matches every row where
    // section = 'liens', regardless of its persisted form_type.
    { value: 'liensdetails', label: 'Liens Details', dbSection: 'liens' },
  ],
  funding: [
    { value: 'funding', label: 'Funding' },
  ],
  broker: [
    { value: 'broker', label: 'Broker Info' },
    { value: 'banking', label: 'Banking' },
  ],
  charges: [
    { value: 'detail', label: 'Charge Details' },
  ],
  escrow: [
    { value: 'primary', label: 'Primary' },
  ],
  notes: [
    { value: 'primary', label: 'Primary' },
  ],
  lender: [
    { value: 'lender', label: 'Lender Info' },
    { value: 'authorized_party', label: 'Authorized Party' },
    { value: 'banking', label: 'Banking' },
    { value: 'tax_info', label: '1099' },
  ],
  origination_fees: [
    { value: 'application', label: 'Application' },
    { value: 'escrow_title', label: 'Escrow & Title' },
    { value: 'document_provisions', label: 'Document Provisions' },
    { value: 'insurance_conditions', label: 'Insurance Conditions' },
    { value: 'servicing', label: 'Servicing' },
    { value: 'origination_fees', label: 'Origination Fees' },
  ],
};

const DATA_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'date', label: 'Date' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'phone', label: 'Phone' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'integer', label: 'Integer' },
  { value: 'decimal', label: 'Decimal' },
  { value: 'action', label: 'Action' },
  { value: 'navigation', label: 'Navigation' },
  { value: 'section', label: 'Section' },
  { value: 'label', label: 'Label' },
  { value: 'template', label: 'Template' },
  { value: 'datetime', label: 'Date & Time' },
  { value: 'date_range', label: 'Date Range' },
  { value: 'file', label: 'File' },
  { value: 'document', label: 'Document' },
  { value: 'list', label: 'List' },
  { value: 'reference', label: 'Reference' },
  { value: 'object_reference', label: 'Object Reference' },
  { value: 'entity_reference', label: 'Entity Reference' },
  { value: 'search_input', label: 'Search Input' },
  { value: 'sort_control', label: 'Sort Control' },
];

// Section abbreviation map for field key generation
const SECTION_ABBR: Record<string, string> = {
  borrower: 'br',
  co_borrower: 'cb',
  loan_terms: 'ln',
  property: 'pr',
  lender: 'ld',
  broker: 'bk',
  charges: 'ch',
  escrow: 'es',
  origination_fees: 'of',
  insurance: 'in',
  notes: 'nt',
  liens: 'li',
};

const FORM_ABBR: Record<string, string> = {
  primary: 'p',
  additional: 'a',
  additional_guarantor: 'ag',
  authorized_party: 'ap',
  guarantor: 'g',
  banking: 'b',
  tax: 't',
  tax_info: 'ti',
  notes: 'n',
  attachment: 'at',
  legal: 'lg',
  legal_description: 'lg',
  insurance: 'in',
  insurance_conditions: 'ic',
  liens: 'li',
  detail: 'd',
  servicing: 'sv',
  funding: 'fd',
  fees: 'f',
  balances: 'bl',
  balances_loan_details: 'bl',
  details: 'dt',
  penalties: 'pn',
  general: 'g',
  trust_ledger: 'tl',
  co_borrower: 'cb',
  property_details: 'pd',
  property_tax: 'pt',
  broker: 'bk',
  lender: 'ld',
  application: 'ap',
  escrow_title: 'et',
  document_provisions: 'dp',
  origination_fees: 'of',
  general_details: 'gd',
  loan_type: 'lt',
  balance_payment: 'bp',
  recording_tracking: 'rt',
  // Liens regrouped under Property as a single unified "Liens Details" entry.
  liensdetails: 'ld',
};

// All form types for the create/edit dialog (union)
const ALL_FORM_TYPES = Array.from(
  new Map(
    Object.values(SECTION_FORMS)
      .flat()
      .map(f => [f.value, f])
  ).values()
);

function generateFieldKeyFromConvention(label: string, section: string, formType: string): string {
  const sectionAbbr = SECTION_ABBR[section] || section.substring(0, 2);
  const formAbbr = FORM_ABBR[formType] || formType.substring(0, 1);
  const identifier = label
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .map((word, idx) => {
      if (idx === 0) return word.charAt(0).toLowerCase() + word.slice(1).toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join('')
    .substring(0, 12);
  return `${sectionAbbr}_${formAbbr}_${identifier}`;
}

// Build label maps
const SECTION_LABEL_MAP: Record<string, string> = {};
SECTIONS.forEach(s => { SECTION_LABEL_MAP[s.value] = s.label; });
// Also map DB sections that don't appear as UI sections
SECTION_LABEL_MAP['co_borrower'] = 'Borrower';
SECTION_LABEL_MAP['insurance'] = 'Property';

const FORM_TYPE_LABEL_MAP: Record<string, string> = {};
ALL_FORM_TYPES.forEach(f => { FORM_TYPE_LABEL_MAP[f.value] = f.label; });

export const FieldDictionaryPage: React.FC = () => {
  const [fields, setFields] = useState<FieldDictionary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSection, setFilterSection] = useState<string>('');
  const [filterFormType, setFilterFormType] = useState<string>('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<FieldDictionary | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    field_key: '',
    label: '',
    section: 'borrower',
    form_type: 'primary',
    data_type: 'text',
    is_calculated: false,
    is_repeatable: false,
    is_mandatory: false,
    description: '',
    default_value: '',
    validation_rule: '',
    allowed_roles: ['admin', 'csr'] as string[],
    read_only_roles: [] as string[],
  });

  useEffect(() => {
    fetchFields();

    const handleFocusRefresh = () => {
      void fetchFields();
    };

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === 'visible') {
        void fetchFields();
      }
    };

    window.addEventListener('focus', handleFocusRefresh);
    document.addEventListener('visibilitychange', handleVisibilityRefresh);

    return () => {
      window.removeEventListener('focus', handleFocusRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
    };
  }, []);

  const fetchFields = async () => {
    try {
      const data = await fetchAllRows((client) =>
        client
          .from('field_dictionary')
          .select('*')
          .order('section, label')
      );
      setFields((data || []).map((d: any) => ({
        ...d,
        form_type: d.form_type || 'primary',
        is_mandatory: d.is_mandatory || false,
        allowed_roles: d.allowed_roles || ['admin', 'csr'],
        read_only_roles: d.read_only_roles || [],
      })));
    } catch (error) {
      console.error('Error fetching fields:', error);
      toast({
        title: 'Error',
        description: 'Failed to load field dictionary',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Resolve the actual DB section for a form selection under a UI section
  const resolveDbSection = (uiSection: string, formType: string): string => {
    const forms = SECTION_FORMS[uiSection] || [];
    const formDef = forms.find(f => f.value === formType);
    if (formDef?.dbSection) return formDef.dbSection;
    // For "funding" UI section, the DB section is loan_terms
    if (uiSection === 'funding') return 'loan_terms';
    return uiSection;
  };

  // For form values that are prefixed with their dbSection (e.g.
  // "liens_general_details" → form_type "general_details"), strip the prefix
  // when persisting to keep the DB form_type values consistent with the
  // historical schema. Non-prefixed forms are returned unchanged.
  const resolveDbFormType = (uiSection: string, formType: string): string => {
    const forms = SECTION_FORMS[uiSection] || [];
    const formDef = forms.find(f => f.value === formType);
    if (formDef?.dbSection && formDef.value.startsWith(`${formDef.dbSection}_`)) {
      return formDef.value.slice(formDef.dbSection.length + 1);
    }
    return formType;
  };

  const handleLabelChange = (label: string) => {
    setFormData((prev) => {
      const dbSection = resolveDbSection(prev.section, prev.form_type);
      const dbFormType = resolveDbFormType(prev.section, prev.form_type);
      return {
        ...prev,
        label,
        field_key: editingField ? prev.field_key : generateFieldKeyFromConvention(label, dbSection, dbFormType),
      };
    });
  };

  const handleSectionChange = (section: string) => {
    const firstForm = SECTION_FORMS[section]?.[0]?.value || 'primary';
    setFormData((prev) => {
      const dbSection = resolveDbSection(section, firstForm);
      const dbFormType = resolveDbFormType(section, firstForm);
      return {
        ...prev,
        section,
        form_type: firstForm,
        field_key: editingField ? prev.field_key : generateFieldKeyFromConvention(prev.label, dbSection, dbFormType),
      };
    });
  };

  const handleFormTypeChange = (formType: string) => {
    setFormData((prev) => {
      const dbSection = resolveDbSection(prev.section, formType);
      const dbFormType = resolveDbFormType(prev.section, formType);
      return {
        ...prev,
        form_type: formType,
        field_key: editingField ? prev.field_key : generateFieldKeyFromConvention(prev.label, dbSection, dbFormType),
      };
    });
  };

  const handleSubmit = async () => {
    if (!formData.field_key || !formData.label || !formData.section) {
      toast({
        title: 'Validation error',
        description: 'Please fill in all required fields',
        variant: 'destructive',
      });
      return;
    }

    const duplicateExists = fields.some(
      (f) => f.field_key === formData.field_key && f.id !== editingField?.id
    );
    if (duplicateExists) {
      toast({
        title: 'Duplicate Field Key',
        description: `The field key "${formData.field_key}" already exists. Please use a unique key.`,
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      // Resolve to actual DB section + form_type
      const dbSection = resolveDbSection(formData.section, formData.form_type);
      const dbFormType = resolveDbFormType(formData.section, formData.form_type);

      const payload: Record<string, any> = {
        field_key: formData.field_key,
        label: formData.label,
        section: dbSection as any,
        form_type: dbFormType,
        data_type: formData.data_type as any,
        is_calculated: formData.is_calculated,
        is_repeatable: formData.is_repeatable,
        is_mandatory: formData.is_mandatory,
        description: formData.description || null,
        default_value: formData.default_value || null,
        validation_rule: formData.validation_rule || null,
        allowed_roles: formData.allowed_roles,
        read_only_roles: formData.read_only_roles,
      };

      if (editingField) {
        const { error } = await supabase
          .from('field_dictionary')
          .update(payload as any)
          .eq('id', editingField.id);

        if (error) throw error;
        toast({ title: 'Field updated successfully' });
      } else {
        const { error } = await supabase.from('field_dictionary').insert(payload as any);
        if (error) throw error;
        toast({ title: 'Field created successfully' });
      }

      const scrollY = window.scrollY;
      setIsDialogOpen(false);
      resetForm();
      await fetchFields();
      requestAnimationFrame(() => {
        window.scrollTo({ top: scrollY, behavior: 'instant' });
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save field',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  // Reverse-map a DB section to a UI section for editing
  const dbSectionToUiSection = (dbSection: string): string => {
    if (dbSection === 'co_borrower') return 'borrower';
    if (dbSection === 'insurance') return 'property';
    // Liens are now grouped under Property in the UI
    if (dbSection === 'liens') return 'property';
    // Check direct match
    if (SECTIONS.some(s => s.value === dbSection)) return dbSection;
    return 'borrower'; // fallback
  };

  // Reverse-map a DB form_type to the UI form value for the given UI section.
  // Required for forms that live under a parent UI section but persist with
  // an unprefixed form_type (e.g. liens grouped under Property).
  const dbFormTypeToUiFormType = (uiSection: string, dbSection: string, dbFormType: string): string => {
    // Liens are merged into a single unified "Liens Details" entry — every
    // legacy form_type (general_details, loan_type, balance_payment,
    // recording_tracking) maps to the same UI value.
    if (uiSection === 'property' && dbSection === 'liens') {
      return 'liensdetails';
    }
    const forms = SECTION_FORMS[uiSection] || [];
    const prefixed = forms.find(
      f => f.dbSection === dbSection && f.value === `${dbSection}_${dbFormType}`
    );
    if (prefixed) return prefixed.value;
    return dbFormType || 'primary';
  };

  const handleEdit = (field: FieldDictionary) => {
    setEditingField(field);
    const uiSection = dbSectionToUiSection(field.section);
    const uiFormType = dbFormTypeToUiFormType(uiSection, field.section, field.form_type || 'primary');
    setFormData({
      field_key: field.field_key,
      label: field.label,
      section: uiSection,
      form_type: uiFormType,
      data_type: field.data_type,
      is_calculated: field.is_calculated,
      is_repeatable: field.is_repeatable,
      is_mandatory: field.is_mandatory,
      description: field.description || '',
      default_value: field.default_value || '',
      validation_rule: field.validation_rule || '',
      allowed_roles: field.allowed_roles || ['admin', 'csr'],
      read_only_roles: field.read_only_roles || [],
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (field: FieldDictionary) => {
    if (!confirm(`Are you sure you want to delete "${field.label}"?`)) return;

    try {
      const { error } = await supabase
        .from('field_dictionary')
        .delete()
        .eq('id', field.id);

      if (error) throw error;
      toast({ title: 'Field deleted successfully' });
      fetchFields();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete field',
        variant: 'destructive',
      });
    }
  };

  const handleToggleMandatory = async (field: FieldDictionary) => {
    try {
      const { error } = await supabase
        .from('field_dictionary')
        .update({ is_mandatory: !field.is_mandatory } as any)
        .eq('id', field.id);

      if (error) throw error;

      setFields(prev => prev.map(f => 
        f.id === field.id ? { ...f, is_mandatory: !f.is_mandatory } : f
      ));
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update mandatory status',
        variant: 'destructive',
      });
    }
  };

  const resetForm = () => {
    setEditingField(null);
    setFormData({
      field_key: '',
      label: '',
      section: 'borrower',
      form_type: 'primary',
      data_type: 'text',
      is_calculated: false,
      is_repeatable: false,
      is_mandatory: false,
      description: '',
      default_value: '',
      validation_rule: '',
      allowed_roles: ['admin', 'csr'],
      read_only_roles: [],
    });
  };

  const toggleRole = (role: string, field: 'allowed_roles' | 'read_only_roles') => {
    setFormData(prev => {
      const currentRoles = prev[field];
      const otherField = field === 'allowed_roles' ? 'read_only_roles' : 'allowed_roles';
      
      if (currentRoles.includes(role)) {
        return {
          ...prev,
          [field]: currentRoles.filter(r => r !== role),
        };
      } else {
        return {
          ...prev,
          [field]: [...currentRoles, role],
          [otherField]: prev[otherField].filter(r => r !== role),
        };
      }
    });
  };

  // CSV export
  const handleExportCSV = () => {
    const rows = filteredFields.map(f => ({
      Section: SECTION_LABEL_MAP[f.section] || f.section,
      'Form Type': FORM_TYPE_LABEL_MAP[f.form_type] || f.form_type,
      'Field Label': f.label,
      'Field Key': f.field_key,
      'Field Type': f.data_type,
      Mandatory: f.is_mandatory ? 'Yes' : 'No',
      Calculated: f.is_calculated ? 'Yes' : 'No',
      Repeatable: f.is_repeatable ? 'Yes' : 'No',
    }));

    const headers = Object.keys(rows[0] || {});
    const csvContent = [
      headers.join(','),
      ...rows.map(row => headers.map(h => `"${(row as any)[h] || ''}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `field_dictionary${filterSection ? `_${filterSection}` : ''}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const hasActiveFilters = filterSection || filterFormType;

  const clearAllFilters = () => {
    setFilterSection('');
    setFilterFormType('');
    setSearchQuery('');
  };

  // When section filter changes, reset form filter
  const handleFilterSectionChange = (v: string) => {
    setFilterSection(v === 'all' ? '' : v);
    setFilterFormType('');
  };

  // Available forms for the current filter section
  const availableFilterForms = useMemo(() => {
    if (!filterSection) return [];
    return SECTION_FORMS[filterSection] || [];
  }, [filterSection]);

  const filteredFields = useMemo(() => {
    return fields
      // Only show fields from valid DB sections
      .filter(f => VALID_DB_SECTIONS.has(f.section))
      .filter((f) => {
        // Search across label, field_key
        const q = searchQuery.toLowerCase();
        const matchesSearch = !q ||
          f.label.toLowerCase().includes(q) ||
          f.field_key.toLowerCase().includes(q) ||
          f.data_type.toLowerCase().includes(q);

        // Section filter
        let matchesSection = true;
        if (filterSection) {
          const dbSections = SECTION_TO_DB[filterSection] || [filterSection];
          matchesSection = dbSections.includes(f.section);
          // Special case: "funding" also needs form_type = 'funding'
          if (filterSection === 'funding') {
            matchesSection = f.section === 'loan_terms' && f.form_type === 'funding';
          }
        }

        // Form filter
        let matchesForm = true;
        if (filterFormType && filterSection) {
          const formDef = (SECTION_FORMS[filterSection] || []).find(fd => fd.value === filterFormType);
          if (formDef?.dbSection) {
            // Form maps to a different DB section (e.g., co_borrower, insurance, liens).
            // Also partition by the underlying form_type when the form value carries
            // a "<section>_" prefix (e.g., "liens_general_details" → form_type "general_details").
            const stripped = formDef.value.startsWith(`${formDef.dbSection}_`)
              ? formDef.value.slice(formDef.dbSection.length + 1)
              : null;
            matchesForm = f.section === formDef.dbSection &&
              (stripped ? f.form_type === stripped : true);
          } else {
            matchesForm = f.form_type === filterFormType;
          }
        }

        return matchesSearch && matchesSection && matchesForm;
      });
  }, [fields, searchQuery, filterSection, filterFormType]);

  // Group by UI section label for display
  const groupedFields = useMemo(() => {
    return filteredFields.reduce((acc, field) => {
      const groupKey = SECTION_LABEL_MAP[field.section] || field.section;
      if (!acc[groupKey]) acc[groupKey] = [];
      acc[groupKey].push(field);
      return acc;
    }, {} as Record<string, FieldDictionary[]>);
  }, [filteredFields]);

  // Available forms in the create/edit dialog based on selected section
  const dialogForms = useMemo(() => {
    return SECTION_FORMS[formData.section] || [];
  }, [formData.section]);

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Field Dictionary</h1>
          <p className="text-muted-foreground mt-1">
            Manage data fields — {filteredFields.length} of {fields.filter(f => VALID_DB_SECTIONS.has(f.section)).length} fields shown
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={handleExportCSV} disabled={filteredFields.length === 0}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) resetForm();
          }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingField ? 'Edit Field' : 'Create Field'}</DialogTitle>
                <DialogDescription>Define a new data field for the dictionary</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
                <div className="space-y-2">
                  <Label htmlFor="label">Label *</Label>
                  <Input
                    id="label"
                    value={formData.label}
                    onChange={(e) => handleLabelChange(e.target.value)}
                    placeholder="e.g., Borrower First Name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Section *</Label>
                    <Select value={formData.section} onValueChange={handleSectionChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SECTIONS.map((s) => (
                          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Form *</Label>
                    <Select value={formData.form_type} onValueChange={handleFormTypeChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {dialogForms.map((t) => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Data Type *</Label>
                  <Select
                    value={formData.data_type}
                    onValueChange={(value) => setFormData((prev) => ({ ...prev, data_type: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATA_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fieldKey">Field Key</Label>
                  <Input
                    id="fieldKey"
                    value={formData.field_key}
                    onChange={(e) => setFormData((prev) => ({ ...prev, field_key: e.target.value }))}
                    placeholder="Auto-generated from convention"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Format: <code className="bg-muted px-1 rounded">{'{section}_{form}_{field}'}</code> — e.g. <code className="bg-muted px-1 rounded">br_p_fn</code>
                  </p>
                </div>
                <div className="flex gap-6">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={formData.is_mandatory}
                      onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, is_mandatory: checked }))}
                    />
                    <Label className="flex items-center gap-1">
                      Mandatory
                      <Asterisk className="h-3 w-3 text-destructive" />
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={formData.is_calculated}
                      onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, is_calculated: checked }))}
                    />
                    <Label>Calculated</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={formData.is_repeatable}
                      onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, is_repeatable: checked }))}
                    />
                    <Label>Repeatable</Label>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="Optional description"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="defaultValue">Default Value</Label>
                  <Input
                    id="defaultValue"
                    value={formData.default_value}
                    onChange={(e) => setFormData((prev) => ({ ...prev, default_value: e.target.value }))}
                    placeholder="Optional default"
                  />
                </div>

                {/* Role-based Visibility Section */}
                <div className="border-t pt-4 mt-4">
                  <h4 className="font-medium text-foreground mb-3">Field Visibility & Permissions</h4>
                  <p className="text-xs text-muted-foreground mb-4">
                    Configure which roles can view and edit this field. CSR and Admin always have full access by default.
                  </p>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-sm">Can View & Edit (Allowed Roles)</Label>
                      <div className="flex flex-wrap gap-2">
                        {ROLES.map(role => (
                          <Button
                            key={role.value}
                            type="button"
                            size="sm"
                            variant={formData.allowed_roles.includes(role.value) ? 'default' : 'outline'}
                            className={cn(
                              'text-xs',
                              formData.allowed_roles.includes(role.value) && 'bg-primary'
                            )}
                            onClick={() => toggleRole(role.value, 'allowed_roles')}
                          >
                            {role.label}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm">View Only (Read-Only Roles)</Label>
                      <div className="flex flex-wrap gap-2">
                        {ROLES.filter(r => !['admin', 'csr'].includes(r.value)).map(role => (
                          <Button
                            key={role.value}
                            type="button"
                            size="sm"
                            variant={formData.read_only_roles.includes(role.value) ? 'secondary' : 'outline'}
                            className={cn(
                              'text-xs',
                              formData.read_only_roles.includes(role.value) && 'bg-secondary'
                            )}
                            onClick={() => toggleRole(role.value, 'read_only_roles')}
                            disabled={formData.allowed_roles.includes(role.value)}
                          >
                            {role.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={saving}>
                  {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : (editingField ? 'Update' : 'Create')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="section-card mb-6">
        <div className="flex flex-col gap-3">
          {/* Search bar */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by label, field key, or type..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          {/* Filter row */}
          <div className="flex flex-wrap gap-3 items-center">
            <Select value={filterSection || "all"} onValueChange={handleFilterSectionChange}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sections</SelectItem>
                {SECTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {filterSection && availableFilterForms.length > 0 && (
              <Select value={filterFormType || "all"} onValueChange={(v) => setFilterFormType(v === "all" ? "" : v)}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Forms</SelectItem>
                  {availableFilterForms.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={clearAllFilters}>
                <X className="h-3.5 w-3.5" />
                Clear filters
              </Button>
            )}
          </div>
        </div>
      </div>

      {Object.keys(groupedFields).length === 0 ? (
        <div className="section-card text-center py-12">
          <Key className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No fields found</h3>
          <p className="text-muted-foreground">
            {hasActiveFilters || searchQuery 
              ? 'Try adjusting your search or filters' 
              : 'Add your first field to the dictionary'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedFields).map(([sectionLabel, sectionFields]) => (
            <div key={sectionLabel} className="section-card">
              <h3 className="text-lg font-semibold text-foreground mb-4">
                {sectionLabel}
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  ({sectionFields.length} fields)
                </span>
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 text-sm font-medium text-muted-foreground">Field Label</th>
                      <th className="text-left py-2 px-3 text-sm font-medium text-muted-foreground">Field Key</th>
                      <th className="text-left py-2 px-3 text-sm font-medium text-muted-foreground">Form</th>
                      <th className="text-left py-2 px-3 text-sm font-medium text-muted-foreground">Type</th>
                      <th className="text-center py-2 px-3 text-sm font-medium text-muted-foreground">Mandatory</th>
                      <th className="text-left py-2 px-3 text-sm font-medium text-muted-foreground">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sectionFields.map((field) => (
                      <tr key={field.id} className="border-b border-border last:border-0 hover:bg-muted/50 cursor-pointer" onClick={() => handleEdit(field)}>
                        <td className="py-2.5 px-3 font-medium text-foreground text-sm text-primary hover:underline">{field.label}</td>
                        <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">{field.field_key}</td>
                        <td className="py-2.5 px-3">
                          <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-accent/50 text-accent-foreground capitalize">
                            {FORM_TYPE_LABEL_MAP[field.form_type] || field.form_type || 'primary'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground capitalize">
                            {field.data_type}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={field.is_mandatory}
                            onCheckedChange={() => handleToggleMandatory(field)}
                            className="mx-auto"
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex gap-1">
                            {field.is_calculated && (
                              <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                                Calc
                              </span>
                            )}
                            {field.is_repeatable && (
                              <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-success/10 text-success">
                                Repeat
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FieldDictionaryPage;
