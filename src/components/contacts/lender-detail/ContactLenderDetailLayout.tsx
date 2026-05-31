import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { SaveConfirmationDialog } from '@/components/workspace/SaveConfirmationDialog';
import { ArrowLeft, Save } from 'lucide-react';
import { useContactWorkspaceOptional } from '@/contexts/ContactWorkspaceContext';
import { Button } from '@/components/ui/button';
import { logContactEvent, type ContactFieldChange } from '@/hooks/useContactEventJournal';
import LenderDetailSidebar, { type LenderSection } from './LenderDetailSidebar';
import { LenderInfoForm } from '@/components/deal/LenderInfoForm';
import { LenderAuthorizedPartyForm } from '@/components/deal/LenderAuthorizedPartyForm';
import { LenderBankingForm } from '@/components/deal/LenderBankingForm';
import Lender1099 from './Lender1099';
import TaxReportingCard from '@/components/contacts/shared/TaxReportingCard';
import LenderDashboard from './LenderDashboard';
import LenderPortfolio from './LenderPortfolio';
import LenderHistory from './LenderHistory';
import LenderCharges from './LenderCharges';
import LenderTrustLedger from './LenderTrustLedger';
import LenderConversationLog from './LenderConversationLog';
import LenderAttachments from './LenderAttachments';
import LenderEventsJournal from './LenderEventsJournal';
import { DirtyFieldsProvider } from '@/contexts/DirtyFieldsContext';
import type { ContactRecord } from '@/hooks/useContactsCrud';
import { useFormPermissions } from '@/hooks/useFormPermissions';

interface ContactLenderDetailLayoutProps {
  contact: ContactRecord;
  onBack: () => void;
  onSave: (
    id: string,
    contactData: Record<string, string>,
    opts?: { newContactId?: string },
  ) => Promise<boolean>;
}

const ContactLenderDetailLayout: React.FC<ContactLenderDetailLayoutProps> = ({
  contact: contactProp,
  onBack,
  onSave,
}) => {
  const { loading: permissionsLoading, isFormViewOnly } = useFormPermissions();
  const [activeSection, setActiveSection] = useState<LenderSection>('lender-info');
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  // Local copy so a successful Lender ID rename updates header / sub-components
  // without waiting for a parent refetch.
  const [contact, setContact] = useState<ContactRecord>(contactProp);
  useEffect(() => { setContact(contactProp); }, [contactProp]);

  const [lenderIdError, setLenderIdError] = useState<string>('');
  const [values, setValues] = useState<Record<string, string>>(() => {
    const result: Record<string, string> = {};
    Object.entries(contactProp.contact_data || {}).forEach(([key, value]) => {
      result[`lender.${key}`] = value;
    });
    // Auto-fill Lender ID from contact record
    if (!result['lender.lender_id']) {
      result['lender.lender_id'] = contactProp.contact_id;
    }
    return result;
  });

  const [initialValues, setInitialValues] = useState<Record<string, string>>(() => ({ ...values }));
  const isDirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(initialValues), [values, initialValues]);
  const isReadOnly = permissionsLoading || isFormViewOnly('lender');

  const handleValueChange = useCallback((fieldKey: string, value: string) => {
    if (isReadOnly) return;
    if (fieldKey === 'lender.lender_id' && lenderIdError) setLenderIdError('');
    setValues(prev => ({ ...prev, [fieldKey]: value }));
  }, [isReadOnly, lenderIdError]);

  const contactWs = useContactWorkspaceOptional();

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (isReadOnly) return false;
    const contactData: Record<string, string> = {};
    Object.entries(values).forEach(([key, value]) => {
      const stripped = key.replace(/^lender\./, '');
      contactData[stripped] = value;
    });

    // Validate Lender ID format before hitting the API
    const requestedId = (values['lender.lender_id'] || '').trim().toUpperCase();
    const willRename = requestedId && requestedId !== contact.contact_id;
    if (willRename && !/^L-\d{4,}$/.test(requestedId)) {
      setLenderIdError('Lender ID must follow the format L-##### (e.g. L-00055).');
      return false;
    }

    const changes: ContactFieldChange[] = [];
    const allKeys = new Set([...Object.keys(values), ...Object.keys(initialValues)]);
    allKeys.forEach(key => {
      const oldVal = initialValues[key] || '';
      const newVal = values[key] || '';
      if (oldVal !== newVal) {
        const label = key.replace(/^lender\./, '').replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        changes.push({ fieldLabel: label, oldValue: oldVal, newValue: newVal });
      }
    });
    const saved = await onSave(contact.id, contactData, willRename ? { newContactId: requestedId } : undefined);
    if (!saved) {
      // updateContact already toasted; surface inline error on rename attempts
      if (willRename) setLenderIdError('This Lender ID already exists. Please enter a unique ID.');
      return false;
    }
    if (changes.length > 0) {
      await logContactEvent(contact.id, 'Lender Info', changes);
    }
    // Cascade rename: update local header + workspace tab so all visible labels match
    if (willRename) {
      setContact(prev => ({ ...prev, contact_id: requestedId }));
      const fullName = contactData.full_name
        || `${contactData.first_name || ''} ${contactData.last_name || ''}`.trim()
        || contact.full_name;
      contactWs?.updateContactId(contact.id, requestedId, fullName);
      // Notify open deal grids (Participants, Lenders, etc.) to refetch
      try {
        window.dispatchEvent(new CustomEvent('contact-id-renamed', {
          detail: { contactDbId: contact.id, oldContactId: contact.contact_id, newContactId: requestedId },
        }));
      } catch { /* ignore */ }
    }
    setInitialValues({ ...values });
    setLenderIdError('');
    return true;
  }, [isReadOnly, values, initialValues, contact.id, contact.contact_id, contact.full_name, onSave, contactWs]);

  useEffect(() => { if (contactWs) contactWs.setContactDirty(contact.id, isDirty); }, [isDirty, contact.id, contactWs]);
  useEffect(() => {
    if (!contactWs) return;
    contactWs.registerSaveFn(contact.id, handleSave);
    return () => contactWs.unregisterSaveFn(contact.id);
  }, [contactWs, contact.id, handleSave]);

  const emptyFields: any[] = [];
  const emptyDirty = new Set<string>();

  const renderContent = () => {
    switch (activeSection) {
      case 'dashboard':
        return (
          <div className="p-6">
            <LenderDashboard contact={contact} />
          </div>
        );
      case 'portfolio':
        return (
          <div className="p-6">
            <LenderPortfolio lenderId={contact.contact_id} contactDbId={contact.id} />
          </div>
        );
      case 'history':
        return (
          <div className="p-6">
            <LenderHistory lenderId={contact.contact_id} contactDbId={contact.id} />
          </div>
        );
      case 'charges':
        return (
          <div className="p-6">
            <LenderCharges lenderId={contact.contact_id} contactDbId={contact.id} disabled={isReadOnly} />
          </div>
        );
      case 'trust-ledger':
        return (
          <div className="p-6">
            <LenderTrustLedger lenderId={contact.contact_id} contactDbId={contact.id} disabled={isReadOnly} />
          </div>
        );
      case 'conversation-log':
        return (
          <div className="p-6">
            <LenderConversationLog lenderId={contact.contact_id} contactDbId={contact.id} disabled={isReadOnly} />
          </div>
        );
      case 'lender-info':
        return (
          <LenderInfoForm
            fields={emptyFields}
            values={values}
            onValueChange={handleValueChange}
            disabled={isReadOnly}
            lenderIdError={lenderIdError}
          />
        );
      case 'authorized-party':
        return (
          <LenderAuthorizedPartyForm
            fields={emptyFields}
            values={values}
            onValueChange={handleValueChange}
            disabled={isReadOnly}
          />
        );
      case 'banking':
        return (
          <LenderBankingForm
            fields={emptyFields}
            values={values}
            onValueChange={handleValueChange}
            disabled={isReadOnly}
          />
        );
      case '1099':
        return (
          <div className="p-6">
            <Lender1099
              values={values}
              onValueChange={handleValueChange}
              onSave={async () => { await handleSave(); }}
              disabled={isReadOnly}
            />
          </div>
        );
      case 'tax-reporting':
        return (
          <div className="p-6">
            <TaxReportingCard
              partyType="lender"
              prefix="lender."
              values={values}
              onValueChange={handleValueChange}
              disabled={isReadOnly}
            />
          </div>
        );
      case 'attachments':
        return (
          <div className="p-6">
            <LenderAttachments lenderId={contact.contact_id} contactDbId={contact.id} disabled={isReadOnly} />
          </div>
        );
      case 'events-journal':
        return (
          <div className="p-6">
            <LenderEventsJournal lenderId={contact.contact_id} contactDbId={contact.id} />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 pt-8 pb-4 mt-2 border-b border-border bg-background relative z-[1]">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Lenders
          </Button>
          <h3 className="font-semibold text-lg text-foreground">
            Lender — {contact.contact_id}
          </h3>
        </div>
        {!isReadOnly && isDirty && (
          <Button size="sm" onClick={() => setShowSaveConfirm(true)} className="gap-1">
            <Save className="h-4 w-4" /> Save Changes
          </Button>
        )}
      </div>
      <div className="flex flex-1 overflow-hidden">
        <LenderDetailSidebar activeSection={activeSection} onSectionChange={setActiveSection} />
        <div className="flex-1 overflow-auto">
          <DirtyFieldsProvider dirtyFieldKeys={emptyDirty}>
            {renderContent()}
          </DirtyFieldsProvider>
        </div>
      </div>
      <SaveConfirmationDialog
        open={showSaveConfirm}
        onConfirm={() => { setShowSaveConfirm(false); handleSave(); }}
        onCancel={() => setShowSaveConfirm(false)}
      />
    </div>
  );
};

export default ContactLenderDetailLayout;
