import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useContactsCrud, type ContactRecord } from '@/hooks/useContactsCrud';
import { ContactsListView } from '@/components/contacts/ContactsListView';
import { CreateContactModal } from '@/components/contacts/CreateContactModal';
import ContactBorrowerDetailLayout from '@/components/contacts/borrower-detail/ContactBorrowerDetailLayout';
import type { ColumnConfig } from '@/components/deal/ColumnConfigPopover';
import type { FilterOption } from '@/components/deal/GridToolbar';
import { useFormPermissions } from '@/hooks/useFormPermissions';
import { mirrorPrefixedToCanonical } from '@/lib/contactPrefixMirror';

const COBORROWER_SEND_ALIASES: Array<[string, string]> = [
  ['send_pref.payment_confirmation', 'coborrower.send_payment_confirmation'],
  ['send_pref.coupon_book', 'coborrower.send_coupon_book'],
  ['send_pref.payment_statement', 'coborrower.send_payment_statement'],
  ['send_pref.late_notice', 'coborrower.send_late_notice'],
  ['send_pref.maturity_notice', 'coborrower.send_maturity_notice'],
];

/** Hydrate `coborrower.send_*` from canonical `send_pref.*` so the detail form populates after reload. */
function hydrateCoBorrowerSendFields(cd: Record<string, string>): Record<string, string> {
  const out = { ...cd };
  for (const [canonical, prefixed] of COBORROWER_SEND_ALIASES) {
    if (out[canonical] !== undefined && (out[prefixed] === undefined || out[prefixed] === '')) {
      out[prefixed] = out[canonical];
    }
  }
  return out;
}

/** Mirror `coborrower.send_*` to canonical `send_pref.*` so the grid populates after save. */
function mirrorCoBorrowerSendFields(cd: Record<string, string>): Record<string, string> {
  const out = { ...cd };
  for (const [canonical, prefixed] of COBORROWER_SEND_ALIASES) {
    if (out[prefixed] !== undefined) out[canonical] = out[prefixed];
  }
  return out;
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'contact_id', label: 'Borrower ID', visible: true },
  { id: 'borrower_type', label: 'Type', visible: true },
  { id: 'full_name', label: 'Entity Name', visible: true },
  { id: 'first_name', label: 'First', visible: true },
  { id: 'middle_initial', label: 'Middle', visible: false },
  { id: 'last_name', label: 'Last', visible: true },
  { id: 'capacity', label: 'Capacity', visible: false },
  { id: 'email', label: 'Email', visible: true },
  { id: 'phone.home', label: 'Home Phone', visible: true },
  { id: 'phone.home2', label: 'Home Phone 2', visible: false },
  { id: 'phone.work', label: 'Work Phone', visible: false },
  { id: 'phone.cell', label: 'Cell Phone', visible: true },
  { id: 'phone.fax', label: 'Fax', visible: false },
  { id: 'preferred_phone', label: 'Preferred Phone', visible: false },
  { id: 'address.street', label: 'Address Street', visible: false },
  { id: 'address.city', label: 'Address City', visible: false },
  { id: 'address.state', label: 'Address State', visible: false },
  { id: 'address.zip', label: 'Address Zip', visible: false },
  { id: 'mailing.street', label: 'Mailing Street', visible: false },
  { id: 'mailing.city', label: 'Mailing City', visible: false },
  { id: 'mailing.state', label: 'Mailing State', visible: false },
  { id: 'mailing.zip', label: 'Mailing Zip', visible: false },
  { id: 'city', label: 'City', visible: true },
  { id: 'state', label: 'State', visible: true },
  { id: 'delivery_print', label: 'Delivery Print', visible: false },
  { id: 'delivery_email', label: 'Delivery Email', visible: false },
  { id: 'delivery_sms', label: 'Delivery SMS', visible: false },
  { id: 'agreement_on_file', label: 'Agreement on File', visible: false },
  { id: 'send_pref.payment_confirmation', label: 'Payment Confirmation', visible: false },
  { id: 'send_pref.coupon_book', label: 'Coupon Book', visible: false },
  { id: 'send_pref.payment_statement', label: 'Payment Statement', visible: false },
  { id: 'send_pref.late_notice', label: 'Late Notice', visible: false },
  { id: 'send_pref.maturity_notice', label: 'Maturity Notice', visible: false },
];

const BOOLEAN_COLUMNS = new Set<string>(['delivery_print', 'delivery_email', 'delivery_sms', 'agreement_on_file', 'send_pref.payment_confirmation', 'send_pref.coupon_book', 'send_pref.payment_statement', 'send_pref.late_notice', 'send_pref.maturity_notice']);

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

interface CoBorrowerDetailProps {
  contact: ContactRecord;
  onBack: () => void;
  onSave: (id: string, contactData: Record<string, string>) => Promise<boolean>;
}

const CoBorrowerDetail: React.FC<CoBorrowerDetailProps> = ({ contact, onBack, onSave }) => {
  return (
    <ContactBorrowerDetailLayout
      contact={contact}
      onBack={onBack}
      onSave={onSave}
      initialSection="co-borrower"
      backLabel="Back to Co-borrowers"
      titlePrefix="Co-borrower"
      taxPartyType="coborrower"
      taxPrefix="coborrower."
    />
  );
};

const ContactCoBorrowersPage: React.FC = () => {
  const { contactId } = useParams<{ contactId?: string }>();
  const navigate = useNavigate();
  const crud = useContactsCrud({ contactType: 'borrower' });
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
      setSelectedContact({
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
        contact_data: hydrateCoBorrowerSendFields((data.contact_data || {}) as Record<string, string>),
        created_at: data.created_at || '',
        updated_at: data.updated_at || '',
      });
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
    // Mirror coborrower.* values to canonical top-level/contact_data keys so
    // the Co-borrowers grid populates after save (existing save API only).
    const withSend = mirrorCoBorrowerSendFields(contactData);
    const mirrored = mirrorPrefixedToCanonical(withSend, 'coborrower.');
    return await crud.updateContact(id, mirrored);
  }, [crud, isReadOnly]);

  const handleDeleteSelected = useCallback(async (ids: string[]) => {
    if (isReadOnly) return;
    await crud.deleteContacts(ids);
  }, [crud, isReadOnly]);

  const handleRowClick = useCallback((c: ContactRecord) => {
    setSelectedContact({
      ...c,
      contact_data: hydrateCoBorrowerSendFields((c.contact_data || {}) as Record<string, string>),
    });
    navigate(`/contacts/co-borrowers/${c.id}`);
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
      <CoBorrowerDetail
        key={selectedContact.id}
        contact={selectedContact}
        onBack={() => {
          setSelectedContact(null);
          navigate('/contacts/co-borrowers');
        }}
        onSave={handleSave}
      />
    );
  }

  return (
    <>
      <ContactsListView
        title="Co-borrowers"
        contacts={crud.contacts}
        totalCount={crud.totalCount}
        totalPages={crud.totalPages}
        currentPage={crud.currentPage}
        isLoading={crud.isLoading}
        searchQuery={localSearch}
        onSearchChange={setLocalSearch}
        searchPlaceholder="Search Co-borrowers..."
        onPageChange={crud.setCurrentPage}
        onRowClick={handleRowClick}
        onCreateNew={() => setModalOpen(true)}
        onDeleteSelected={isReadOnly ? undefined : handleDeleteSelected}
        defaultColumns={DEFAULT_COLUMNS}
        tableConfigKey="contact_co_borrowers_v1"
        addButtonLabel="Add Co-borrower"
        breadcrumbLabel="Co-borrowers"
        filterOptions={FILTER_OPTIONS}
        renderCellValue={renderCellValue}
        createDisabled={isReadOnly}
      />
      <CreateContactModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        contactType="borrower"
        onSubmit={handleCreate}
      />
    </>
  );
};

export default ContactCoBorrowersPage;
