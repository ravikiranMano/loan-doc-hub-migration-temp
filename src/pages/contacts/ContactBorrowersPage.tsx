import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useContactsCrud, type ContactRecord } from '@/hooks/useContactsCrud';
import { ContactsListView } from '@/components/contacts/ContactsListView';
import { CreateContactModal } from '@/components/contacts/CreateContactModal';
import ContactBorrowerDetailLayout from '@/components/contacts/borrower-detail/ContactBorrowerDetailLayout';
import type { ColumnConfig } from '@/components/deal/ColumnConfigPopover';
import type { FilterOption } from '@/components/deal/GridToolbar';
import { useFormPermissions } from '@/hooks/useFormPermissions';
import { useContactWorkspaceOptional } from '@/contexts/ContactWorkspaceContext';
import { format, parse, isValid } from 'date-fns';

export interface ContactBorrower {
  id: string;
  borrowerId: string;
  hold: boolean;
  type: string;
  ach: boolean;
  email: string;
  agreement: boolean;
  fullName: string;
  firstName: string;
  lastName: string;
  city: string;
  state: string;
  cellPhone: string;
  homePhone: string;
  workPhone: string;
  fax: string;
  preferredPhone: string;
  verified: boolean;
  send1099: boolean;
  tin: string;
  street: string;
  zip: string;
  mailingStreet: string;
  mailingCity: string;
  mailingState: string;
  mailingZip: string;
  sameAsPrimary: boolean;
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
  { id: 'agreement_on_file_date', label: 'Agreement Date', visible: false },
  { id: 'send_pref.payment_confirmation', label: 'Send Payment Confirmation', visible: false },
  { id: 'send_pref.coupon_book', label: 'Send Coupon Book', visible: false },
  { id: 'send_pref.payment_statement', label: 'Send Payment Statement', visible: false },
  { id: 'send_pref.late_notice', label: 'Send Late Notice', visible: false },
  { id: 'send_pref.maturity_notice', label: 'Send Maturity Notice', visible: false },
];

const BOOLEAN_COLUMNS = new Set<string>(['delivery_print', 'delivery_email', 'delivery_sms', 'agreement_on_file', 'send_pref.payment_confirmation', 'send_pref.coupon_book', 'send_pref.payment_statement', 'send_pref.late_notice', 'send_pref.maturity_notice']);

const BORROWER_FILTER_OPTIONS: FilterOption[] = [
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

const ContactBorrowersPage: React.FC = () => {
  const { contactId } = useParams<{ contactId?: string }>();
  const navigate = useNavigate();
  const crud = useContactsCrud({ contactType: 'borrower' });
  const { loading: permissionsLoading, isFormViewOnly } = useFormPermissions();
  const contactWs = useContactWorkspaceOptional();
  const [selectedContact, setSelectedContact] = useState<ContactRecord | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const deepLinkLoaded = useRef(false);
  const isReadOnly = permissionsLoading || isFormViewOnly('borrower');

  // Deep-link / tab-switch: load contact whenever URL param changes to a
  // different contact than the one displayed. Ensures per-tab data isolation.
  useEffect(() => {
    if (!contactId) return;
    if (selectedContact?.id === contactId) return;
    let cancelled = false;
    (async () => {
      const { supabase } = await import('@/integrations/supabase/client');
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', contactId)
        .maybeSingle();
      if (cancelled || !data) return;
      const rec = {
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
      };
      setSelectedContact(rec);
      if (contactWs) {
        contactWs.openContact({
          id: rec.id,
          kind: 'borrower',
          contactId: rec.contact_id,
          fullName: rec.full_name || [rec.first_name, rec.last_name].filter(Boolean).join(' '),
          openedAt: Date.now(),
        });
      }
    })();
    return () => { cancelled = true; };
  }, [contactId, contactWs, selectedContact?.id]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      crud.setSearchQuery(localSearch);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [localSearch]);

  const handleCreate = useCallback(async (data: Record<string, string>) => {
    if (isReadOnly) return;
    await crud.createContact(data);
    setModalOpen(false);
  }, [crud, isReadOnly]);

  const handleSave = useCallback(async (id: string, contactData: Record<string, string>) => {
    if (isReadOnly) return false;
    const result = await crud.updateContact(id, contactData);
    return result;
  }, [crud, isReadOnly]);

  const handleDeleteSelected = useCallback(async (ids: string[]) => {
    if (isReadOnly) return;
    await crud.deleteContacts(ids);
  }, [crud, isReadOnly]);

  const handleRowClick = useCallback((c: ContactRecord) => {
    if (contactWs) {
      const ok = contactWs.openContact({
        id: c.id,
        kind: 'borrower',
        contactId: c.contact_id,
        fullName: c.full_name || [c.first_name, c.last_name].filter(Boolean).join(' '),
        openedAt: Date.now(),
      });
      if (!ok) return;
    }
    setSelectedContact(c);
    navigate(`/contacts/borrowers/${c.id}`);
  }, [contactWs, navigate]);

  // Sync active workspace tab with URL
  useEffect(() => {
    if (contactWs && contactId) contactWs.switchToContact(contactId);
    if (!contactId) setSelectedContact(null);
  }, [contactId]);

  const renderCellValue = useCallback((contact: ContactRecord, columnId: string): React.ReactNode => {
    const cd = (contact.contact_data || {}) as Record<string, string>;

    // Computed preferred phone
    if (columnId === 'preferred_phone') {
      if (cd['preferred.home'] === 'true') return 'Home';
      if (cd['preferred.home2'] === 'true') return 'Home 2';
      if (cd['preferred.work'] === 'true') return 'Work';
      if (cd['preferred.cell'] === 'true') return 'Cell';
      if (cd['preferred.fax'] === 'true') return 'Fax';
      return '-';
    }

    // Cell phone: stored as phone.mobile or phone.cell
    if (columnId === 'phone.cell') {
      const val = cd['phone.cell'] || cd['phone.mobile'] || '';
      return val || '-';
    }

    // TIN: stored as tin or tax_id
    if (columnId === 'tax_id') {
      const val = cd['tax_id'] || cd['tin'] || '';
      return val || '-';
    }

    // Boolean columns
    if (BOOLEAN_COLUMNS.has(columnId)) {
      const val = cd[columnId];
      return val === 'true' ? '✓' : '';
    }

    // Top-level fields
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

    // contact_data (supports dot-notation keys like address.street, phone.home)
    const val = cd[columnId] || '';
    if (columnId === 'agreement_on_file_date' && val) {
      try { const d = parse(val, 'yyyy-MM-dd', new Date()); if (isValid(d)) return format(d, 'MM/dd/yyyy'); } catch { /* noop */ }
    }
    return val || '-';
  }, []);

  if (selectedContact) {
    return (
      <div className="h-full flex flex-col">
        <ContactBorrowerDetailLayout
          key={selectedContact.id}
          contact={selectedContact}
          onBack={() => {
            if (contactWs) contactWs.closeContact(selectedContact.id);
            setSelectedContact(null);
            navigate('/contacts/borrowers');
          }}
          onSave={handleSave}
        />
      </div>
    );
  }

  return (
    <>
      <ContactsListView
        title="Borrowers"
        contacts={crud.contacts}
        totalCount={crud.totalCount}
        totalPages={crud.totalPages}
        currentPage={crud.currentPage}
        isLoading={crud.isLoading}
        searchQuery={localSearch}
        onSearchChange={setLocalSearch}
        searchPlaceholder="Search by Borrower ID, Type, or Name..."
        onPageChange={crud.setCurrentPage}
        onRowClick={handleRowClick}
        onCreateNew={() => setModalOpen(true)}
        onDeleteSelected={isReadOnly ? undefined : handleDeleteSelected}
        defaultColumns={DEFAULT_COLUMNS}
        tableConfigKey="contact_borrowers_v7"
        addButtonLabel="Add Borrower"
        breadcrumbLabel="Borrowers"
        filterOptions={BORROWER_FILTER_OPTIONS}
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

export default ContactBorrowersPage;
