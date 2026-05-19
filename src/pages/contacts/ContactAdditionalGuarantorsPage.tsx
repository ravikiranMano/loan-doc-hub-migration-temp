import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useContactsCrud, type ContactRecord } from '@/hooks/useContactsCrud';
import { ContactsListView } from '@/components/contacts/ContactsListView';
import { CreateContactModal } from '@/components/contacts/CreateContactModal';
import ContactBorrowerDetailLayout from '@/components/contacts/borrower-detail/ContactBorrowerDetailLayout';
import type { ColumnConfig } from '@/components/deal/ColumnConfigPopover';
import type { FilterOption } from '@/components/deal/GridToolbar';
import { useFormPermissions } from '@/hooks/useFormPermissions';
import { mirrorPrefixedToCanonical, hydratePrefixedFromCanonical } from '@/lib/contactPrefixMirror';

const AG_PREFIX = 'borrower.guarantor.';
const hydrateAG = (c: ContactRecord): ContactRecord => ({
  ...c,
  contact_data: hydratePrefixedFromCanonical(
    (c.contact_data || {}) as Record<string, string>,
    AG_PREFIX,
    {
      first_name: c.first_name, last_name: c.last_name, full_name: c.full_name,
      email: c.email, phone: c.phone, city: c.city, state: c.state, company: c.company,
    },
  ),
});

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'contact_id', label: 'Contact ID', visible: true },
  { id: 'borrower_type', label: 'Type', visible: true },
  { id: 'full_name', label: 'Full Name', visible: true },
  { id: 'first_name', label: 'First', visible: true },
  { id: 'middle_initial', label: 'Middle', visible: false },
  { id: 'last_name', label: 'Last', visible: true },
  { id: 'capacity', label: 'Capacity', visible: false },
  { id: 'email', label: 'Email', visible: true },
  { id: 'address.street', label: 'Address Street', visible: false },
  { id: 'address.city', label: 'Address City', visible: false },
  { id: 'address.state', label: 'Address State', visible: false },
  { id: 'address.zip', label: 'Address Zip', visible: false },
  { id: 'mailing.street', label: 'Mailing Street', visible: false },
  { id: 'mailing.city', label: 'Mailing City', visible: false },
  { id: 'mailing.state', label: 'Mailing State', visible: false },
  { id: 'mailing.zip', label: 'Mailing Zip', visible: false },
  { id: 'phone.home', label: 'Home Phone', visible: true },
  { id: 'phone.home2', label: 'Home Phone 2', visible: false },
  { id: 'phone.work', label: 'Work Phone', visible: false },
  { id: 'phone.cell', label: 'Cell Phone', visible: true },
  { id: 'phone.fax', label: 'Fax', visible: false },
  { id: 'preferred_phone', label: 'Preferred Phone', visible: false },
  { id: 'city', label: 'City', visible: true },
  { id: 'state', label: 'State', visible: true },
  { id: 'send_pref.payment_notification', label: 'Send Payment Notification', visible: false },
  { id: 'send_pref.borrower_statement', label: 'Send Borrower Statement', visible: false },
  { id: 'send_pref.late_notice', label: 'Send Late Notice', visible: false },
  { id: 'send_pref.maturity_notice', label: 'Send Maturity Notice', visible: false },
  { id: 'delivery_online', label: 'Delivery Online', visible: false },
  { id: 'delivery_mail', label: 'Delivery Mail', visible: false },
  { id: 'ford.1', label: 'FORD 1', visible: false },
  { id: 'ford.2', label: 'FORD 2', visible: false },
];

const BOOLEAN_COLUMNS = new Set<string>(['delivery_online', 'delivery_mail', 'send_pref.payment_notification', 'send_pref.borrower_statement', 'send_pref.late_notice', 'send_pref.maturity_notice']);

const FILTER_OPTIONS: FilterOption[] = [
  {
    id: 'state',
    label: 'State',
    options: [
      { value: 'CA', label: 'CA' },
      { value: 'TX', label: 'TX' },
      { value: 'FL', label: 'FL' },
      { value: 'NY', label: 'NY' },
      { value: 'WA', label: 'WA' },
    ],
  },
];

const NON_BORROWER_PREFIXES = ['ach.', 'coborrower.', 'borrower.guarantor.', 'borrower.authorized_party.', 'borrower.1098.'];

interface AdditionalGuarantorDetailProps {
  contact: ContactRecord;
  onBack: () => void;
  onSave: (id: string, contactData: Record<string, string>) => Promise<boolean>;
}

const AdditionalGuarantorDetail: React.FC<AdditionalGuarantorDetailProps> = ({ contact, onBack, onSave }) => {
  return (
    <ContactBorrowerDetailLayout
      contact={contact}
      onBack={onBack}
      onSave={onSave}
      initialSection="borrower"
      backLabel="Back to Additional Guarantors"
      titlePrefix="Additional Guarantor"
      borrowerSectionVariant="additional_guarantor"
    />
  );
};

const ContactAdditionalGuarantorsPage: React.FC = () => {
  const { contactId } = useParams<{ contactId?: string }>();
  const navigate = useNavigate();
  const crud = useContactsCrud({ contactType: 'additional_guarantor' });
  const { loading: permissionsLoading, isFormViewOnly } = useFormPermissions();
  const [selectedContact, setSelectedContact] = useState<ContactRecord | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const deepLinkLoaded = useRef(false);
  const isReadOnly = permissionsLoading || isFormViewOnly('borrower');

  useEffect(() => {
    if (!contactId) return;
    if (selectedContact?.id === contactId) return;
    let cancelled = false;
    (async () => {
      const { supabase } = await import('@/integrations/supabase/client');
      const { data } = await supabase.from('contacts').select('*').eq('id', contactId).maybeSingle();
      if (cancelled || !data) return;
      setSelectedContact(hydrateAG({
        id: data.id,
        contact_id: data.contact_id,
        contact_type: data.contact_type,
        full_name: data.full_name || '',
        first_name: data.first_name || '',
        last_name: data.last_name || '',
        email: data.email || '',
        phone: data.phone || '',
        city: data.city || '',
        state: data.state || '',
        company: data.company || '',
        contact_data: (data.contact_data || {}) as Record<string, string>,
        created_at: data.created_at || '',
        updated_at: data.updated_at || '',
      }));
    })();
    return () => { cancelled = true; };
  }, [contactId, selectedContact?.id]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => crud.setSearchQuery(localSearch), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [localSearch]);

  const handleCreate = useCallback(async (data: Record<string, string>) => {
    if (isReadOnly) return;
    await crud.createContact(data);
    setModalOpen(false);
  }, [crud, isReadOnly]);

  const handleSave = useCallback(async (id: string, contactData: Record<string, string>) => {
    if (isReadOnly) return false;
    // Bidirectional sync so AG detail values persist + display correctly:
    //  1) Hydrate prefixed AG keys from any canonical values present
    //     (covers the case where existing data was saved canonically only).
    //  2) Mirror prefixed AG values back into canonical top-level/contact_data
    //     keys so the Additional Guarantors grid populates after save.
    const hydrated = hydratePrefixedFromCanonical(contactData, 'borrower.guarantor.');
    const mirrored = mirrorPrefixedToCanonical(hydrated, 'borrower.guarantor.');
    return await crud.updateContact(id, mirrored);
  }, [crud, isReadOnly]);

  const handleDeleteSelected = useCallback(async (ids: string[]) => {
    if (isReadOnly) return;
    await crud.deleteContacts(ids);
  }, [crud, isReadOnly]);

  const handleRowClick = useCallback((c: ContactRecord) => {
    setSelectedContact(hydrateAG(c));
    navigate(`/contacts/additional-guarantors/${c.id}`);
  }, [navigate]);

  useEffect(() => {
    if (!contactId) setSelectedContact(null);
  }, [contactId]);

  const renderCellValue = useCallback((contact: ContactRecord, columnId: string): React.ReactNode => {
    const cd = (contact.contact_data || {}) as Record<string, string>;

    if (columnId === 'preferred_phone') {
      if (cd['preferred.home'] === 'true') return 'Home';
      if (cd['preferred.home2'] === 'true') return 'Home 2';
      if (cd['preferred.work'] === 'true') return 'Work';
      if (cd['preferred.cell'] === 'true') return 'Cell';
      if (cd['preferred.fax'] === 'true') return 'Fax';
      return '-';
    }

    if (columnId === 'phone.cell') {
      const val = cd['phone.cell'] || cd['phone.mobile'] || '';
      return val || '-';
    }

    if (columnId === 'tax_id') {
      const val = cd['tax_id'] || cd['tin'] || '';
      return val || '-';
    }

    if (BOOLEAN_COLUMNS.has(columnId)) {
      const val = cd[columnId];
      return val === 'true' ? '✓' : '';
    }

    const topLevel: Record<string, string | null | undefined> = {
      contact_id: contact.contact_id,
      full_name: contact.full_name,
      first_name: contact.first_name,
      last_name: contact.last_name,
      email: contact.email,
      phone: contact.phone,
      city: contact.city,
      state: contact.state,
      company: contact.company,
    };
    if (columnId in topLevel) {
      const val = topLevel[columnId] || '';
      if (columnId === 'full_name') return <span className="font-medium">{val || '-'}</span>;
      return val || '-';
    }
    return cd[columnId] || '-';
  }, []);

  if (selectedContact) {
    return (
      <AdditionalGuarantorDetail
        contact={selectedContact}
        onBack={() => {
          setSelectedContact(null);
          navigate('/contacts/additional-guarantors');
        }}
        onSave={handleSave}
      />
    );
  }

  return (
    <>
      <ContactsListView
        title="Additional Guarantors"
        contacts={crud.contacts}
        totalCount={crud.totalCount}
        totalPages={crud.totalPages}
        currentPage={crud.currentPage}
        isLoading={crud.isLoading}
        searchQuery={localSearch}
        onSearchChange={setLocalSearch}
        searchPlaceholder="Search Additional Guarantors..."
        onPageChange={crud.setCurrentPage}
        onRowClick={handleRowClick}
        onCreateNew={() => setModalOpen(true)}
        onDeleteSelected={isReadOnly ? undefined : handleDeleteSelected}
        defaultColumns={DEFAULT_COLUMNS}
        tableConfigKey="contact_additional_guarantors_v1"
        addButtonLabel="Add Additional Guarantor"
        breadcrumbLabel="Additional Guarantors"
        filterOptions={FILTER_OPTIONS}
        renderCellValue={renderCellValue}
        createDisabled={isReadOnly}
      />
      <CreateContactModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        contactType="borrower"
        borrowerSubtype="additional_guarantor"
        title="Create New Additional Guarantor"
        onSubmit={handleCreate}
      />
    </>
  );
};

export default ContactAdditionalGuarantorsPage;
