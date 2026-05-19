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

const AP_PREFIX = 'borrower.authorized_party.';
const hydrateAP = (c: ContactRecord): ContactRecord => ({
  ...c,
  contact_data: hydratePrefixedFromCanonical(
    (c.contact_data || {}) as Record<string, string>,
    AP_PREFIX,
    {
      first_name: c.first_name, last_name: c.last_name, full_name: c.full_name,
      email: c.email, phone: c.phone, city: c.city, state: c.state, company: c.company,
    },
  ),
});

const AP = 'borrower.authorized_party.';

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'contact_id', label: 'Contact ID', visible: true },
  // Name
  { id: 'first_name', label: 'First', visible: true },
  { id: `${AP}middle_name`, label: 'Middle', visible: false },
  { id: 'last_name', label: 'Last', visible: true },
  { id: `${AP}capacity`, label: 'Capacity', visible: true },
  { id: 'email', label: 'Email', visible: true },
  { id: `${AP}date_authorized`, label: 'Date Authorized', visible: false },
  // Address
  { id: `${AP}address.street`, label: 'Street', visible: false },
  { id: `${AP}address.city`, label: 'City', visible: true },
  { id: `${AP}address.state`, label: 'State', visible: true },
  { id: `${AP}address.zip`, label: 'ZIP', visible: false },
  // Phone
  { id: `${AP}phone.home`, label: 'Home', visible: true },
  { id: `${AP}phone.work`, label: 'Work', visible: false },
  { id: `${AP}phone.cell`, label: 'Cell', visible: true },
  { id: `${AP}phone.fax`, label: 'Fax', visible: false },
  { id: 'preferred_phone', label: 'Preferred', visible: false },
  // Delivery Options
  { id: `${AP}delivery.online`, label: 'Delivery Online', visible: false },
  { id: `${AP}delivery.mail`, label: 'Delivery Mail', visible: false },
  { id: `${AP}delivery.sms`, label: 'Delivery SMS', visible: false },
  // Send
  { id: `${AP}send_pref.payment_confirmation`, label: 'Send Payment Confirmation', visible: false },
  { id: `${AP}send_pref.coupon_book`, label: 'Send Coupon Book', visible: false },
  { id: `${AP}send_pref.payment_statement`, label: 'Send Payment Statement', visible: false },
  { id: `${AP}send_pref.late_notice`, label: 'Send Late Notice', visible: false },
  { id: `${AP}send_pref.maturity_notice`, label: 'Send Maturity Notice', visible: false },
  // Details
  { id: `${AP}details`, label: 'Details', visible: false },
  // FORD
  { id: `${AP}ford_1`, label: 'FORD 1', visible: false },
  { id: `${AP}ford_2`, label: 'FORD 2', visible: false },
  { id: `${AP}ford_3`, label: 'FORD 3', visible: false },
  { id: `${AP}ford_4`, label: 'FORD 4', visible: false },
  { id: `${AP}ford_5`, label: 'FORD 5', visible: false },
  { id: `${AP}ford_6`, label: 'FORD 6', visible: false },
];

const BOOLEAN_COLUMNS = new Set<string>([
  `${AP}delivery.online`, `${AP}delivery.mail`, `${AP}delivery.sms`,
  `${AP}send_pref.payment_confirmation`, `${AP}send_pref.coupon_book`,
  `${AP}send_pref.payment_statement`, `${AP}send_pref.late_notice`,
  `${AP}send_pref.maturity_notice`,
]);

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

interface AuthorizedPartyDetailProps {
  contact: ContactRecord;
  onBack: () => void;
  onSave: (id: string, contactData: Record<string, string>) => Promise<boolean>;
}

const AuthorizedPartyDetail: React.FC<AuthorizedPartyDetailProps> = ({ contact, onBack, onSave }) => {
  return (
    <ContactBorrowerDetailLayout
      contact={contact}
      onBack={onBack}
      onSave={onSave}
      initialSection="borrower"
      backLabel="Back to Authorized Parties"
      titlePrefix="Authorized Party"
      borrowerSectionVariant="authorized_party"
    />
  );
};

const ContactAuthorizedPartiesPage: React.FC = () => {
  const { contactId } = useParams<{ contactId?: string }>();
  const navigate = useNavigate();
  const crud = useContactsCrud({ contactType: 'authorized_party' });
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
      setSelectedContact(hydrateAP({
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
    // Bidirectional sync so AP detail values persist + display correctly:
    //  1) Hydrate prefixed AP keys from any canonical values present
    //     (covers the case where existing data was saved canonically only).
    //  2) Mirror prefixed AP values back into canonical top-level/contact_data
    //     keys so the Authorized Parties grid populates after save.
    const hydrated = hydratePrefixedFromCanonical(contactData, 'borrower.authorized_party.');
    const mirrored = mirrorPrefixedToCanonical(hydrated, 'borrower.authorized_party.');
    return await crud.updateContact(id, mirrored);
  }, [crud, isReadOnly]);

  const handleDeleteSelected = useCallback(async (ids: string[]) => {
    if (isReadOnly) return;
    await crud.deleteContacts(ids);
  }, [crud, isReadOnly]);

  const handleRowClick = useCallback((c: ContactRecord) => {
    setSelectedContact(hydrateAP(c));
    navigate(`/contacts/authorized-parties/${c.id}`);
  }, [navigate]);

  useEffect(() => {
    if (!contactId) setSelectedContact(null);
  }, [contactId]);

  const renderCellValue = useCallback((contact: ContactRecord, columnId: string): React.ReactNode => {
    const cd = (contact.contact_data || {}) as Record<string, string>;

    if (columnId === 'preferred_phone') {
      if (cd[`${AP}preferred.home`] === 'true' || cd['preferred.home'] === 'true') return 'Home';
      if (cd[`${AP}preferred.work`] === 'true' || cd['preferred.work'] === 'true') return 'Work';
      if (cd[`${AP}preferred.cell`] === 'true' || cd['preferred.cell'] === 'true') return 'Cell';
      if (cd[`${AP}preferred.fax`] === 'true' || cd['preferred.fax'] === 'true') return 'Fax';
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
      <AuthorizedPartyDetail
        key={selectedContact.id}
        contact={selectedContact}
        onBack={() => {
          setSelectedContact(null);
          navigate('/contacts/authorized-parties');
        }}
        onSave={handleSave}
      />
    );
  }

  return (
    <>
      <ContactsListView
        title="Authorized Parties"
        contacts={crud.contacts}
        totalCount={crud.totalCount}
        totalPages={crud.totalPages}
        currentPage={crud.currentPage}
        isLoading={crud.isLoading}
        searchQuery={localSearch}
        onSearchChange={setLocalSearch}
        searchPlaceholder="Search Authorized Parties..."
        onPageChange={crud.setCurrentPage}
        onRowClick={handleRowClick}
        onCreateNew={() => setModalOpen(true)}
        onDeleteSelected={isReadOnly ? undefined : handleDeleteSelected}
        defaultColumns={DEFAULT_COLUMNS}
        tableConfigKey="contact_authorized_parties_v1"
        addButtonLabel="Add Authorized Party"
        breadcrumbLabel="Authorized Parties"
        filterOptions={FILTER_OPTIONS}
        renderCellValue={renderCellValue}
        createDisabled={isReadOnly}
      />
      <CreateContactModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        contactType="borrower"
        onSubmit={handleCreate}
        title="Create New Authorized Party"
      />
    </>
  );
};

export default ContactAuthorizedPartiesPage;
