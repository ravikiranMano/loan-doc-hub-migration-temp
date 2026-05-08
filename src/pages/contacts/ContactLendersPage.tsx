import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { FilterOption } from '@/components/deal/GridToolbar';

// Re-export for backward compatibility with existing components
export interface ContactLender {
  id: string;
  lenderId: string;
  frozen: boolean;
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
  investorQuestionnaire: string;
  street: string;
  zip: string;
  mailingStreet: string;
  mailingCity: string;
  mailingState: string;
  mailingZip: string;
  sameAsPrimary: boolean;
}
import { useContactsCrud, type ContactRecord } from '@/hooks/useContactsCrud';
import { ContactsListView } from '@/components/contacts/ContactsListView';
import { CreateContactModal } from '@/components/contacts/CreateContactModal';
import ContactLenderDetailLayout from '@/components/contacts/lender-detail/ContactLenderDetailLayout';
import { useFormPermissions } from '@/hooks/useFormPermissions';
import { useContactWorkspaceOptional } from '@/contexts/ContactWorkspaceContext';
import type { ColumnConfig } from '@/components/deal/ColumnConfigPopover';

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'contact_id', label: 'Lender ID', visible: true },
  { id: 'type', label: 'Lender Type', visible: true },
  { id: 'full_name', label: 'Full Name', visible: true },
  { id: 'first_name', label: 'First', visible: true },
  { id: 'middle_name', label: 'Middle', visible: false },
  { id: 'last_name', label: 'Last', visible: true },
  
  { id: 'email', label: 'Email', visible: true },
  { id: 'dob', label: 'DOB', visible: false },
  { id: 'phone.home', label: 'Home Phone', visible: false },
  { id: 'phone.work', label: 'Work Phone', visible: false },
  { id: 'phone.cell', label: 'Cell Phone', visible: true },
  { id: 'phone.fax', label: 'Fax', visible: false },
  { id: 'primary_address.street', label: 'Street', visible: false },
  { id: 'primary_address.city', label: 'City', visible: true },
  { id: 'primary_address.state', label: 'State', visible: true },
  { id: 'primary_address.zip', label: 'ZIP', visible: false },
  { id: 'mailing.street', label: 'Mailing Street', visible: false },
  { id: 'mailing.city', label: 'Mailing City', visible: false },
  { id: 'mailing.state', label: 'Mailing State', visible: false },
  { id: 'mailing.zip', label: 'Mailing ZIP', visible: false },
  { id: 'tax_id_type', label: 'Tax ID Type', visible: false },
  { id: 'tax_id', label: 'TIN', visible: false },
  { id: 'tin_verified', label: 'TIN Verified', visible: false },
  { id: 'ach', label: 'ACH', visible: false },
  { id: 'servicing_agreement_on_file', label: 'Agreement', visible: false },
  { id: 'freeze_outgoing_disbursements', label: 'Frozen', visible: false },
  { id: 'vesting', label: 'Vesting', visible: false },
  { id: 'delivery.print', label: 'Delivery Print', visible: false },
  { id: 'delivery.email', label: 'Delivery Email', visible: false },
  { id: 'delivery.sms', label: 'Delivery SMS', visible: false },
  { id: 'send_pref.payment_notification', label: 'Send Payment Notif', visible: false },
  { id: 'send_pref.late_notice', label: 'Send Late Notice', visible: false },
  { id: 'send_pref.borrower_statement', label: 'Send Borrower Stmt', visible: false },
  { id: 'send_pref.maturity_notice', label: 'Send Maturity Notice', visible: false },
  
];

const LENDER_FILTER_OPTIONS: FilterOption[] = [
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

const ContactLendersPage: React.FC = () => {
  const { contactId } = useParams<{ contactId?: string }>();
  const navigate = useNavigate();
  const crud = useContactsCrud({ contactType: 'lender' });
  const { loading: permissionsLoading, isFormViewOnly } = useFormPermissions();
  const contactWs = useContactWorkspaceOptional();
  const [selectedContact, setSelectedContact] = useState<ContactRecord | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const deepLinkLoaded = useRef(false);
  const isReadOnly = permissionsLoading || isFormViewOnly('lender');

  // Deep-link: auto-load contact by URL param
  useEffect(() => {
    if (!contactId || deepLinkLoaded.current) return;
    deepLinkLoaded.current = true;
    (async () => {
      const { supabase } = await import('@/integrations/supabase/client');
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', contactId)
        .maybeSingle();
      if (data) {
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
            kind: 'lender',
            contactId: rec.contact_id,
            fullName: rec.full_name || [rec.first_name, rec.last_name].filter(Boolean).join(' '),
            openedAt: Date.now(),
          });
        }
      }
    })();
  }, [contactId, contactWs]);

  // Debounced search: local input state + delayed sync to crud
  const [localSearch, setLocalSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

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
    if (isReadOnly) {
      return false;
    }
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
        kind: 'lender',
        contactId: c.contact_id,
        fullName: c.full_name || [c.first_name, c.last_name].filter(Boolean).join(' '),
        openedAt: Date.now(),
      });
      if (!ok) return;
    }
    setSelectedContact(c);
    navigate(`/contacts/lenders/${c.id}`);
  }, [contactWs, navigate]);

  useEffect(() => {
    if (contactWs && contactId) contactWs.switchToContact(contactId);
    if (!contactId) setSelectedContact(null);
  }, [contactId]);

  if (selectedContact) {
    return (
      <div className="h-full flex flex-col">
        <ContactLenderDetailLayout
          contact={selectedContact}
          onBack={() => {
            if (contactWs) contactWs.closeContact(selectedContact.id);
            setSelectedContact(null);
            navigate('/contacts/lenders');
          }}
          onSave={handleSave}
        />
      </div>
    );
  }

  return (
    <>
       <ContactsListView
        title="Lenders"
        contacts={crud.contacts}
        totalCount={crud.totalCount}
        totalPages={crud.totalPages}
        currentPage={crud.currentPage}
        isLoading={crud.isLoading}
        searchQuery={localSearch}
        onSearchChange={setLocalSearch}
        onPageChange={crud.setCurrentPage}
        onRowClick={handleRowClick}
        onCreateNew={() => setModalOpen(true)}
         onDeleteSelected={isReadOnly ? undefined : handleDeleteSelected}
        defaultColumns={DEFAULT_COLUMNS}
        tableConfigKey="contact_lenders_v5"
        addButtonLabel="Add Lender"
        breadcrumbLabel="Lenders"
        filterOptions={LENDER_FILTER_OPTIONS}
        searchPlaceholder="Search by Lender ID, Type, or Name..."
         createDisabled={isReadOnly}
      />
      <CreateContactModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        contactType="lender"
        onSubmit={handleCreate}
      />
    </>
  );
};

export default ContactLendersPage;
