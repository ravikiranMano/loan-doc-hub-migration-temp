import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { SaveConfirmationDialog } from '@/components/workspace/SaveConfirmationDialog';
import { ArrowLeft, Save } from 'lucide-react';
import { useContactWorkspaceOptional } from '@/contexts/ContactWorkspaceContext';
import { Button } from '@/components/ui/button';
import BorrowerDetailSidebar, { type BorrowerSection } from './BorrowerDetailSidebar';
import { BorrowerPrimaryForm } from '@/components/deal/BorrowerPrimaryForm';
import { BorrowerCoBorrowerForm } from '@/components/deal/BorrowerCoBorrowerForm';
import { BorrowerAdditionalGuarantorForm } from '@/components/deal/BorrowerAdditionalGuarantorForm';
import { BorrowerAuthorizedPartyForm } from '@/components/deal/BorrowerAuthorizedPartyForm';
import { BorrowerBankingForm } from '@/components/deal/BorrowerBankingForm';
import { BorrowerTaxDetailForm } from '@/components/deal/BorrowerTaxDetailForm';
import TaxReportingCard, { type TaxPartyType } from '@/components/contacts/shared/TaxReportingCard';
import BorrowerTrustLedger from './BorrowerTrustLedger';
import BorrowerDashboard from './BorrowerDashboard';
import BorrowerPortfolio from './BorrowerPortfolio';
import BorrowerHistory from './BorrowerHistory';
import BorrowerCharges from './BorrowerCharges';
import BorrowerConversationLog from './BorrowerConversationLog';
import BorrowerAttachments from './BorrowerAttachments';
import BorrowerEventsJournal from './BorrowerEventsJournal';
import { DirtyFieldsProvider } from '@/contexts/DirtyFieldsContext';
import type { ContactRecord } from '@/hooks/useContactsCrud';
import { logContactEvent, type ContactFieldChange } from '@/hooks/useContactEventJournal';
import { useFormPermissions } from '@/hooks/useFormPermissions';

interface ContactBorrowerDetailLayoutProps {
  contact: ContactRecord;
  onBack: () => void;
  onSave: (id: string, contactData: Record<string, string>) => Promise<boolean>;
  initialSection?: BorrowerSection;
  backLabel?: string;
  titlePrefix?: string;
  borrowerSectionVariant?: 'primary' | 'authorized_party' | 'additional_guarantor';
  /** Drives Tax Info card party context (defaults to 'borrower'). */
  taxPartyType?: TaxPartyType;
  /** Prefix used to read/write the Tax Info card values (defaults to 'borrower.'). */
  taxPrefix?: string;
}

const NON_BORROWER_PREFIXES = ['ach.', 'coborrower.', 'borrower.guarantor.', 'borrower.authorized_party.', 'borrower.1098.'];
const SEND_FIELD_ALIASES: [string, string][] = [
  ['send_pref.payment_confirmation', 'send_payment_confirmation'],
  ['send_pref.coupon_book', 'send_coupon_book'],
  ['send_pref.payment_statement', 'send_payment_statement'],
  ['send_pref.late_notice', 'send_late_notice'],
  ['send_pref.maturity_notice', 'send_maturity_notice'],
];

const ContactBorrowerDetailLayout: React.FC<ContactBorrowerDetailLayoutProps> = ({
  contact,
  onBack,
  onSave,
  initialSection = 'borrower',
  backLabel = 'Back to Borrowers',
  titlePrefix = 'Borrower',
  borrowerSectionVariant = 'primary',
  taxPartyType = 'borrower',
  taxPrefix = 'borrower.',
}) => {
  const { loading: permissionsLoading, isFormViewOnly } = useFormPermissions();
  const [activeSection, setActiveSection] = useState<BorrowerSection>(initialSection);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const isReadOnly = permissionsLoading || isFormViewOnly('borrower');

  const [values, setValues] = useState<Record<string, string>>(() => {
    const result: Record<string, string> = {};
    Object.entries(contact.contact_data || {}).forEach(([key, value]) => {
      if (typeof value !== 'string') return;
      const needsPrefix = !NON_BORROWER_PREFIXES.some(p => key.startsWith(p)) && !key.startsWith('borrower.');
      result[needsPrefix ? `borrower.${key}` : key] = value;
    });
    SEND_FIELD_ALIASES.forEach(([sendPrefKey, borrowerKey]) => {
      const prefValue = result[`borrower.${sendPrefKey}`];
      if (prefValue !== undefined && result[`borrower.${borrowerKey}`] === undefined) {
        result[`borrower.${borrowerKey}`] = prefValue;
      }
    });
    if (!result['borrower.borrower_id']) {
      result['borrower.borrower_id'] = contact.contact_id;
    }
    return result;
  });

  const initialValuesRef = useRef<Record<string, string>>({ ...values });
  const isDirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(initialValuesRef.current), [values]);

  const handleValueChange = useCallback((fieldKey: string, value: string) => {
    if (isReadOnly) return;
    setValues(prev => ({ ...prev, [fieldKey]: value }));
  }, [isReadOnly]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (isReadOnly) return false;
    const contactData: Record<string, string> = {};
    Object.entries(values).forEach(([key, value]) => {
      const stripped = NON_BORROWER_PREFIXES.some(p => key.startsWith(p)) ? key : key.replace(/^borrower\./, '');
      contactData[stripped] = value;
    });
    SEND_FIELD_ALIASES.forEach(([sendPrefKey, borrowerKey]) => {
      const borrowerValue = contactData[borrowerKey];
      if (borrowerValue !== undefined) {
        contactData[sendPrefKey] = borrowerValue;
      }
    });
    const oldData = (contact.contact_data || {}) as Record<string, string>;
    const changes: ContactFieldChange[] = [];
    const allKeys = new Set([...Object.keys(oldData), ...Object.keys(contactData)]);
    allKeys.forEach(key => {
      if (key.startsWith('_')) return;
      const oldVal = oldData[key] || '';
      const newVal = contactData[key] || '';
      if (oldVal !== newVal) changes.push({ fieldLabel: key, oldValue: oldVal, newValue: newVal });
    });
    const saved = await onSave(contact.id, contactData);
    if (saved && changes.length > 0) {
      let section = 'borrower_profile';
      const ck = changes.map(c => c.fieldLabel);
      if (ck.some(k => k.startsWith('ach.') || k.includes('bank') || k.includes('routing'))) section = 'banking';
      else if (ck.some(k => k.includes('tax') || k.includes('tin') || k.startsWith('borrower.1098'))) section = 'tax_info';
      else if (ck.some(k => k.includes('authorized'))) section = 'authorized_party';
      else if (ck.some(k => k.includes('email') || k.includes('phone') || k.includes('address') || k.includes('mailing'))) section = 'contact_info';
      logContactEvent(contact.id, section, changes).catch(err => console.error('Failed to log borrower event:', err));
    }
    if (saved) initialValuesRef.current = { ...values };
    return !!saved;
  }, [values, contact.id, contact.contact_data, onSave, isReadOnly]);

  const contactWs = useContactWorkspaceOptional();
  useEffect(() => { if (contactWs) contactWs.setContactDirty(contact.id, isDirty); }, [isDirty, contact.id, contactWs]);
  useEffect(() => {
    if (!contactWs) return;
    contactWs.registerSaveFn(contact.id, handleSave);
    return () => contactWs.unregisterSaveFn(contact.id);
  }, [contactWs, contact.id, handleSave]);

  const emptyFields = [];
  const emptyDirty = new Set<string>();

  const renderContent = () => {
    switch (activeSection) {
      case 'borrower':
        if (borrowerSectionVariant === 'authorized_party') {
          return (
            <BorrowerAuthorizedPartyForm
              fields={emptyFields}
              values={values}
              onValueChange={handleValueChange}
              disabled={isReadOnly}
            />
          );
        }
        if (borrowerSectionVariant === 'additional_guarantor') {
          return (
            <BorrowerAdditionalGuarantorForm
              fields={emptyFields}
              values={values}
              onValueChange={handleValueChange}
              disabled={isReadOnly}
            />
          );
        }
        return (
          <BorrowerPrimaryForm
            fields={emptyFields}
            values={values}
            onValueChange={handleValueChange}
              disabled={isReadOnly}
          />
        );
      case 'co-borrower':
        return (
          <BorrowerCoBorrowerForm
            fields={emptyFields}
            values={values}
            onValueChange={handleValueChange}
            disabled={isReadOnly}
          />
        );
      case 'dashboard':
        return <BorrowerDashboard contact={contact} />;
      case 'portfolio':
        return <BorrowerPortfolio borrowerId={contact.contact_id} contactDbId={contact.id} />;
      case 'history':
        return <BorrowerHistory borrowerId={contact.contact_id} contactDbId={contact.id} />;
      case 'charges':
        return <BorrowerCharges borrowerId={contact.contact_id} contactDbId={contact.id} />;
      case 'banking':
        return (
          <BorrowerBankingForm
            fields={emptyFields}
            values={values}
            onValueChange={handleValueChange}
              disabled={isReadOnly}
          />
        );
      case '1098':
        return (
          <BorrowerTaxDetailForm
            fields={emptyFields}
            values={values}
            onValueChange={handleValueChange}
              disabled={isReadOnly}
          />
        );
      case 'additional-guarantor':
        return (
          <BorrowerAdditionalGuarantorForm
            fields={emptyFields}
            values={values}
            onValueChange={handleValueChange}
              disabled={isReadOnly}
          />
        );
      case 'authorized-party':
        return (
          <BorrowerAuthorizedPartyForm
            fields={emptyFields}
            values={values}
            onValueChange={handleValueChange}
              disabled={isReadOnly}
          />
        );
      case 'trust-ledger':
        return (
          <BorrowerTrustLedger
            borrowerId={contact.contact_id}
            contactDbId={contact.id}
            disabled={isReadOnly}
          />
        );
      case 'tax-info':
        return (
          <BorrowerTaxInfoForm
            fields={emptyFields}
            values={values}
            onValueChange={handleValueChange}
            disabled={isReadOnly}
          />
        );
      case 'conversation-log':
        return <BorrowerConversationLog borrowerId={contact.contact_id} contactDbId={contact.id} disabled={isReadOnly} />;
      case 'attachments':
        return <BorrowerAttachments borrowerId={contact.contact_id} contactDbId={contact.id} disabled={isReadOnly} />;
      case 'events-journal':
        return <BorrowerEventsJournal borrowerId={contact.contact_id} contactDbId={contact.id} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> {backLabel}
          </Button>
          <h3 className="font-semibold text-lg text-foreground">
          {titlePrefix} — {contact.contact_id}
          </h3>
        </div>
        {!isReadOnly && isDirty && (
          <Button size="sm" onClick={() => setShowSaveConfirm(true)} className="gap-1">
            <Save className="h-4 w-4" /> Save Changes
          </Button>
        )}
      </div>
      <div className="flex flex-1 overflow-hidden">
        <BorrowerDetailSidebar activeSection={activeSection} onSectionChange={setActiveSection} />
        <div className="flex-1 overflow-auto p-4">
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

export default ContactBorrowerDetailLayout;
