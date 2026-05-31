import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useContactsCrud, type ContactRecord } from '@/hooks/useContactsCrud';
import { ContactsListView } from '@/components/contacts/ContactsListView';
import { CreateContactModal } from '@/components/contacts/CreateContactModal';
import ContactBrokerDetailLayout from '@/components/contacts/broker-detail/ContactBrokerDetailLayout';
import type { ColumnConfig } from '@/components/deal/ColumnConfigPopover';
import type { FilterOption } from '@/components/deal/GridToolbar';
import { useFormPermissions } from '@/hooks/useFormPermissions';
import { useContactWorkspaceOptional } from '@/contexts/ContactWorkspaceContext';
import { format, parse, isValid } from 'date-fns';

export interface ContactBroker {
  id: string;
  brokerId: string;
  hold: boolean;
  type: string;
  ach: boolean;
  email: string;
  agreement: boolean;
  agreementDate: string;
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
  street: string;
  zip: string;
  mailingStreet: string;
  mailingCity: string;
  mailingState: string;
  mailingZip: string;
  sameAsPrimary: boolean;
  company: string;
  license: string;
  brokersRepresentative: string;
  repPhone: string;
  repEmail: string;
  repLicense: string;
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'contact_id', label: 'Broker ID', visible: true },
  { id: 'frozen', label: 'Frozen', visible: true },
  { id: 'licensee_name_if_entity', label: 'Licensee Name If Entity', visible: true },
  { id: 'License', label: 'License Number', visible: true },
  { id: 'first_name', label: 'First', visible: true },
  { id: 'middle_name', label: 'Middle', visible: true },
  { id: 'last_name', label: 'Last', visible: true },
  { id: 'capacity', label: 'Capacity', visible: true },
  { id: 'email', label: 'Email', visible: true },
  { id: 'agreement_on_file', label: 'Agreement on File', visible: true },
  { id: 'agreement_on_file_date', label: 'Agreement Date', visible: true },
  { id: 'address.street', label: 'Street', visible: true },
  { id: 'city', label: 'City', visible: true },
  { id: 'state', label: 'State', visible: true },
  { id: 'address.zip', label: 'ZIP', visible: true },
  { id: 'mailing.street', label: 'Mailing Street', visible: true },
  { id: 'mailing.city', label: 'Mailing City', visible: true },
  { id: 'mailing.state', label: 'Mailing State', visible: true },
  { id: 'mailing.zip', label: 'Mailing ZIP', visible: true },
  { id: 'phone.home', label: 'Home Phone', visible: true },
  { id: 'phone.work', label: 'Work Phone', visible: true },
  { id: 'phone.cell', label: 'Cell Phone', visible: true },
  { id: 'phone.fax', label: 'Fax', visible: true },
  { id: 'preferred_phone', label: 'Preferred Phone', visible: true },
  { id: 'delivery.online', label: 'Delivery: Online', visible: true },
  { id: 'delivery.mailing_address', label: 'Delivery: Mailing', visible: true },
  { id: 'delivery.sms', label: 'Delivery: SMS', visible: true },
  { id: 'send_pref.payment_notification', label: 'Send: Payment Notif', visible: true },
  { id: 'send_pref.late_notice', label: 'Send: Late Notice', visible: true },
  { id: 'send_pref.borrower_statement', label: 'Send: Borrower Stmt', visible: true },
  { id: 'send_pref.maturity_notice', label: 'Send: Maturity Notice', visible: true },
  { id: 'company', label: 'Company', visible: false },
  { id: 'brokers_representative', label: "Broker's Representative", visible: false },
  { id: 'issue_1099', label: 'Send 1099', visible: false },
  { id: 'tin_verified', label: 'Verified', visible: false },
];

const BOOLEAN_COLUMNS = new Set([
  'frozen', 'ach', 'agreement_on_file', 'issue_1099', 'tin_verified',
  'delivery.online', 'delivery.mailing_address', 'delivery.sms',
  'send_pref.payment_notification', 'send_pref.late_notice',
  'send_pref.borrower_statement', 'send_pref.maturity_notice',
]);

const BROKER_FILTER_OPTIONS: FilterOption[] = [
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
  {
    id: 'company',
    label: 'Company',
    options: [],
  },
];

const ContactBrokersPage: React.FC = () => {
  const { contactId } = useParams<{ contactId?: string }>();
  const navigate = useNavigate();
  const crud = useContactsCrud({ contactType: 'broker' });
  const { loading: permissionsLoading, isFormViewOnly } = useFormPermissions();
  const contactWs = useContactWorkspaceOptional();
  const [selectedContact, setSelectedContact] = useState<ContactRecord | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const deepLinkLoaded = useRef(false);
  const isReadOnly = permissionsLoading || isFormViewOnly('broker');

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
          kind: 'broker',
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

  const handleSave = useCallback(async (
    id: string,
    contactData: Record<string, string>,
    opts?: { newContactId?: string },
  ) => {
    if (isReadOnly) return false;
    const result = await crud.updateContact(id, contactData, opts);
    if (result && opts?.newContactId) {
      setSelectedContact(prev => prev && prev.id === id ? { ...prev, contact_id: opts.newContactId! } : prev);
    }
    return result;
  }, [crud, isReadOnly]);

  // Refresh list when any contact rename event fires (keeps grid in sync)
  useEffect(() => {
    const handler = () => { crud.refresh(); };
    window.addEventListener('contact-id-renamed', handler);
    return () => window.removeEventListener('contact-id-renamed', handler);
  }, [crud]);

  const handleDeleteSelected = useCallback(async (ids: string[]) => {
    if (isReadOnly) return;
    await crud.deleteContacts(ids);
  }, [crud, isReadOnly]);

  const handleRowClick = useCallback((c: ContactRecord) => {
    if (contactWs) {
      const ok = contactWs.openContact({
        id: c.id,
        kind: 'broker',
        contactId: c.contact_id,
        fullName: c.full_name || [c.first_name, c.last_name].filter(Boolean).join(' '),
        openedAt: Date.now(),
      });
      if (!ok) return;
    }
    setSelectedContact(c);
    navigate(`/contacts/brokers/${c.id}`);
  }, [contactWs, navigate]);

  useEffect(() => {
    if (contactWs && contactId) contactWs.switchToContact(contactId);
    if (!contactId) setSelectedContact(null);
  }, [contactId]);

  const renderCellValue = useCallback((contact: ContactRecord, columnId: string): React.ReactNode => {
    const cd = (contact.contact_data || {}) as Record<string, string>;

    if (columnId === 'preferred_phone') {
      if (cd['preferred.home'] === 'true') return 'Home';
      if (cd['preferred.work'] === 'true') return 'Work';
      if (cd['preferred.cell'] === 'true') return 'Cell';
      if (cd['preferred.fax'] === 'true') return 'Fax';
      return '-';
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
      if (columnId === 'full_name') return <span className="font-medium">{[contact.first_name, contact.last_name].filter(Boolean).join(' ') || '-'}</span>;
      return val || '-';
    }

    const val = cd[columnId] || '';
    if ((columnId === 'agreement_on_file_date') && val) {
      try { const d = parse(val, 'yyyy-MM-dd', new Date()); if (isValid(d)) return format(d, 'MM/dd/yyyy'); } catch { /* noop */ }
    }
    return val || '-';
  }, []);

  if (selectedContact) {
    return (
      <div className="h-full flex flex-col">
        <ContactBrokerDetailLayout
          key={selectedContact.id}
          contact={selectedContact}
          onBack={() => {
            if (contactWs) contactWs.closeContact(selectedContact.id);
            setSelectedContact(null);
            navigate('/contacts/brokers');
          }}
          onSave={handleSave}
        />
      </div>
    );
  }

  return (
    <>
      <ContactsListView
        title="Brokers"
        contacts={crud.contacts}
        totalCount={crud.totalCount}
        totalPages={crud.totalPages}
        currentPage={crud.currentPage}
        isLoading={crud.isLoading}
        searchQuery={localSearch}
        onSearchChange={setLocalSearch}
        searchPlaceholder="Search by Broker ID, Type, or Name..."
        onPageChange={crud.setCurrentPage}
        onRowClick={handleRowClick}
        onCreateNew={() => setModalOpen(true)}
        onDeleteSelected={isReadOnly ? undefined : handleDeleteSelected}
        defaultColumns={DEFAULT_COLUMNS}
        tableConfigKey="contact_brokers_v5"
        addButtonLabel="Add Broker"
        breadcrumbLabel="Brokers"
        filterOptions={BROKER_FILTER_OPTIONS}
        renderCellValue={renderCellValue}
        createDisabled={isReadOnly}
      />
      <CreateContactModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        contactType="broker"
        onSubmit={handleCreate}
      />
    </>
  );
};

export default ContactBrokersPage;
