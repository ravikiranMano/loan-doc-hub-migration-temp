import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmailInput } from '@/components/ui/email-input';
import { ZipInput } from '@/components/ui/zip-input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { PhoneInput } from '@/components/ui/phone-input';
import { hasAtLeastOneFieldFilled, validatePhoneFields, hasValidContactEmails } from '@/lib/contactFormValidation';
import { toast } from 'sonner';
import { US_STATES } from '@/lib/usStates';

interface CreateContactModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactType: 'lender' | 'broker' | 'borrower';
  onSubmit: (data: Record<string, string>) => void;
}

const LENDER_TYPE_OPTIONS = [
  'Individual', 'Joint', 'Family Trust', 'LLC', 'C Corp / S Corp',
  'IRA / ERISA', 'Investment Fund', '401k', 'Foreign Holder W-8', 'Non-profit',
];



const TAX_ID_TYPE_OPTIONS = [
  { value: '0', label: '0 - Unknown' },
  { value: '1', label: '1 - EIN' },
  { value: '2', label: '2 - SSN' },
];

const BORROWER_TYPE_OPTIONS = [
  'Individual', 'Joint', 'Family Trust', 'LLC', 'C Corp / S Corp',
  'IRA / ERISA', 'Investment Fund', '401K', 'Foreign Holder W-8', 'Non-profit',
];

const BORROWER_CAPACITY_OPTIONS = [
  'Trustee', 'Successor Trustee', 'Authorized Signer', 'President', 'CEO',
  'Power of Attorney', 'Member', 'Manager', 'Partner', 'Attorney',
];

const BORROWER_FORD_OPTIONS = [
  'Spouse, Kids, Grandkids', 'Big Dream', 'Sports Teams', 'Hobbies / Collections',
  'Goals / Achievements', 'Favorite Restaurant, Food, Drinks', 'Pet(s)', 'Vacation Spot',
  'Job / Occupation', 'Music / Bands', 'College', 'Hometown / Childhood',
  'TV / Movies / Books', 'Anniversary', 'Challenges / Frustrations', 'Charity / Personal Causes',
  'Upcoming Event - What / When', 'Celebration - What / When',
];


const getInitialForm = (contactType: string): Record<string, string> => {
  if (contactType === 'lender') {
    return {
      type: '', full_name: '', first_name: '', middle_name: '', last_name: '',
      email: '', dob: '',
      tax_id_type: '', tax_id: '', tin_verified: 'false',
      'primary_address.street': '', 'primary_address.city': '',
      'primary_address.state': '', 'primary_address.zip': '',
      'mailing.street': '', 'mailing.city': '', 'mailing.state': '', 'mailing.zip': '',
      mailing_same_as_primary: 'false',
      'phone.home': '', 'phone.work': '', 'phone.cell': '', 'phone.fax': '',
      'preferred.home': 'false', 'preferred.work': 'false', 'preferred.cell': 'false', 'preferred.fax': 'false',
      ach: 'false', servicing_agreement_on_file: 'false', freeze_outgoing_disbursements: 'false',
      investor_questionnaire_due: 'false', investor_questionnaire_due_date: '',
      'delivery.print': 'false', 'delivery.email': 'false', 'delivery.sms': 'false',
      'send_pref.payment_notification': 'false', 'send_pref.late_notice': 'false',
      'send_pref.borrower_statement': 'false', 'send_pref.maturity_notice': 'false',
      vesting: '',
    };
  }
  if (contactType === 'broker') {
    return {
      company: '', licensee_name_if_entity: '',
      first_name: '', middle_name: '', last_name: '',
      capacity: '',
      email: '', License: '',
      'address.street': '', 'address.city': '', 'address.state': '', 'address.zip': '',
      'mailing.street': '', 'mailing.city': '', 'mailing.state': '', 'mailing.zip': '',
      mailing_same_as_primary: 'false',
      'phone.home': '', 'phone.work': '', 'phone.cell': '', 'phone.fax': '',
      'preferred.home': 'false', 'preferred.work': 'false', 'preferred.cell': 'false', 'preferred.fax': 'false',
      brokers_representative: '',
      rep_phone: '', rep_email: '', rep_license: '',
      frozen: 'false', agreement_on_file: 'false', agreement_on_file_date: '',
      issue_1099: 'false',
      'delivery.online': 'false', 'delivery.mailing_address': 'false', 'delivery.sms': 'false',
      'send_pref.payment_notification': 'false', 'send_pref.late_notice': 'false',
      'send_pref.borrower_statement': 'false', 'send_pref.maturity_notice': 'false',
      'ford.1': '', 'ford.2': '', 'ford.3': '', 'ford.4': '',
      'ford.5': '', 'ford.6': '', 'ford.7': '', 'ford.8': '',
    };
  }
  // borrower
  return {
    borrower_id: '',
    borrower_type: '', full_name: '', first_name: '', middle_initial: '', last_name: '',
    capacity: '',
    email: '',
    'address.street': '', 'address.city': '', 'address.state': '', 'address.zip': '',
    'mailing.street': '', 'mailing.city': '', 'mailing.state': '', 'mailing.zip': '',
    mailing_same_as_primary: 'false',
    'phone.home': '', 'phone.home2': '', 'phone.work': '', 'phone.cell': '', 'phone.fax': '',
    'preferred.home': 'false', 'preferred.home2': 'false', 'preferred.work': 'false', 'preferred.cell': 'false', 'preferred.fax': 'false',
    delivery_print: 'false', delivery_email: 'false', delivery_sms: 'false',
    agreement_on_file: 'false', agreement_on_file_date: '',
    'send_pref.payment_confirmation': 'false', 'send_pref.coupon_book': 'false',
    'send_pref.payment_statement': 'false', 'send_pref.late_notice': 'false',
    'send_pref.maturity_notice': 'false',
    vesting: '',
    'ford.1': '', 'ford.2': '', 'ford.3': '', 'ford.4': '',
    'ford.5': '', 'ford.6': '', 'ford.7': '', 'ford.8': '',
  };
};

export const CreateContactModal: React.FC<CreateContactModalProps> = ({
  open, onOpenChange, contactType, onSubmit,
}) => {
  const [form, setForm] = useState<Record<string, string>>(() => getInitialForm(contactType));
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Warn the user before the browser/tab is closed if any field has been entered (unsaved).
  // Triggers the browser's native "Leave site?" confirmation dialog.
  useEffect(() => {
    if (!open) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const initial = getInitialForm(contactType);
      const hasEntry = Object.keys(form).some((k) => (form[k] || '') !== (initial[k] || ''))
        || Object.keys(form).some((k) => !(k in initial) && !!form[k]);
      if (hasEntry) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [open, form, contactType]);

  // Determine primary address key prefix based on contact type
  const primaryPrefix = contactType === 'lender' ? 'primary_address' : 'address';

  const set = useCallback((field: string, value: string) => {
    setForm((prev) => {
      const updated = { ...prev, [field]: value };

      // When "Same as Primary" is checked, copy primary to mailing
      if (field === 'mailing_same_as_primary') {
        const prefix = updated['primary_address.street'] !== undefined ? 'primary_address' : 'address';
        if (value === 'true') {
          updated['mailing.street'] = updated[`${prefix}.street`] || '';
          updated['mailing.city'] = updated[`${prefix}.city`] || '';
          updated['mailing.state'] = updated[`${prefix}.state`] || '';
          updated['mailing.zip'] = updated[`${prefix}.zip`] || '';
        } else {
          updated['mailing.street'] = '';
          updated['mailing.city'] = '';
          updated['mailing.state'] = '';
          updated['mailing.zip'] = '';
        }
      }

      return updated;
    });
  }, []);

  // Reactive sync: when primary address changes while "Same as Primary" is checked
  const primaryStreet = form[`${primaryPrefix}.street`] || '';
  const primaryCity = form[`${primaryPrefix}.city`] || '';
  const primaryState = form[`${primaryPrefix}.state`] || '';
  const primaryZip = form[`${primaryPrefix}.zip`] || '';
  const isSameAsPrimary = form.mailing_same_as_primary === 'true';

  useEffect(() => {
    if (isSameAsPrimary) {
      setForm((prev) => ({
        ...prev,
        'mailing.street': primaryStreet,
        'mailing.city': primaryCity,
        'mailing.state': primaryState,
        'mailing.zip': primaryZip,
      }));
    }
  }, [isSameAsPrimary, primaryStreet, primaryCity, primaryState, primaryZip]);

  const handleSubmit = () => {
    // Check at least one meaningful field is filled
    const skipKeys = ['mailing_same_as_primary', 'preferred.home', 'preferred.home2', 'preferred.work', 'preferred.cell', 'preferred.fax',
      'delivery.print', 'delivery.email', 'delivery.sms', 'delivery_print', 'delivery_email', 'delivery_sms',
      'agreement_on_file', 'send_pref.payment_notification',
      'send_pref.late_notice', 'send_pref.borrower_statement', 'send_pref.maturity_notice'];
    if (!hasAtLeastOneFieldFilled(form, skipKeys)) {
      toast.error('Please fill at least one field before saving');
      return;
    }
    // Validate phone fields
    const phoneErrors = validatePhoneFields([
      { label: 'Home Phone', value: form['phone.home'] || '' },
      { label: 'Work Phone', value: form['phone.work'] || '' },
      { label: 'Cell Phone', value: form['phone.cell'] || '' },
      { label: 'Fax', value: form['phone.fax'] || '' },
    ]);
    if (phoneErrors.length > 0) {
      toast.error(phoneErrors[0]);
      return;
    }

    // Lender-specific required field validation
    if (contactType === 'lender') {
      const errs: Record<string, string> = {};
      if (!form['type']) errs['type'] = 'Please select a lender type';
      if (!(form['full_name'] || '').trim()) errs['full_name'] = 'Full Name is required';
      else if ((form['full_name'] || '').length > 100) errs['full_name'] = 'Max 100 characters';
      if (!(form['first_name'] || '').trim()) errs['first_name'] = 'Enter valid first name';
      if (!(form['last_name'] || '').trim()) errs['last_name'] = 'Enter valid last name';
      if (!(form['email'] || '').trim()) errs['email'] = 'Enter a valid email address';
      if (form['dob']) {
        const dobParts = form['dob'].split('/');
        if (dobParts.length === 3) {
          const dobDate = new Date(parseInt(dobParts[2]), parseInt(dobParts[0]) - 1, parseInt(dobParts[1]));
          if (dobDate >= new Date()) errs['dob'] = 'Enter valid date of birth';
        }
      }
      if (!(form['primary_address.street'] || '').trim()) errs['primary_address.street'] = 'Street is required';
      if (!(form['primary_address.city'] || '').trim()) errs['primary_address.city'] = 'City is required';
      if (!form['primary_address.state']) errs['primary_address.state'] = 'State is required';
      if (!(form['primary_address.zip'] || '').trim()) errs['primary_address.zip'] = 'ZIP is required';
      if (form['delivery.print'] !== 'true' && form['delivery.email'] !== 'true' && form['delivery.sms'] !== 'true') {
        errs['delivery'] = 'Select at least one delivery option';
      }
      if (Object.keys(errs).length > 0) {
        setLenderErrors(errs);
        toast.error(Object.values(errs)[0]);
        return;
      }
      setLenderErrors({});
    }

    // Broker-specific required field validation
    if (contactType === 'broker') {
      const errs: Record<string, string> = {};
      if (!(form['License'] || '').trim()) errs['License'] = 'Enter valid license number';
      else if ((form['License'] || '').length > 50) errs['License'] = 'Max 50 characters';
      if (!(form['company'] || '').trim()) errs['company'] = 'Licensee Name is required';
      else if ((form['company'] || '').length > 100) errs['company'] = 'Max 100 characters';
      if (!(form['first_name'] || '').trim()) errs['first_name'] = 'Enter valid first name';
      if (!(form['last_name'] || '').trim()) errs['last_name'] = 'Enter valid last name';
      if (!(form['email'] || '').trim()) errs['email'] = 'Enter a valid email address';
      if (!(form['address.street'] || '').trim()) errs['address.street'] = 'Street is required';
      if (!(form['address.city'] || '').trim()) errs['address.city'] = 'City is required';
      if (!form['address.state']) errs['address.state'] = 'State is required';
      if (!(form['address.zip'] || '').trim()) errs['address.zip'] = 'ZIP is required';
      if (Object.keys(errs).length > 0) {
        setBrokerErrors(errs);
        toast.error(Object.values(errs)[0]);
        return;
      }
      setBrokerErrors({});
    }

    // Borrower-specific required field validation
    if (contactType === 'borrower') {
      const errs: Record<string, string> = {};
      if (!form['borrower_type']) errs['borrower_type'] = 'Please select borrower type';
      if (!(form['full_name'] || '').trim()) errs['full_name'] = 'Entity Name is required';
      else if ((form['full_name'] || '').length > 100) errs['full_name'] = 'Max 100 characters';
      if (!(form['first_name'] || '').trim()) errs['first_name'] = 'Enter valid first name';
      if (!(form['last_name'] || '').trim()) errs['last_name'] = 'Enter valid last name';
      if (!(form['email'] || '').trim()) errs['email'] = 'Enter a valid email address';
      if (!(form['address.street'] || '').trim()) errs['address.street'] = 'Street is required';
      if (!(form['address.city'] || '').trim()) errs['address.city'] = 'City is required';
      if (!form['address.state']) errs['address.state'] = 'State is required';
      if (!(form['address.zip'] || '').trim()) errs['address.zip'] = 'ZIP is required';
      if (Object.keys(errs).length > 0) {
        setBorrowerErrors(errs);
        toast.error(Object.values(errs)[0]);
        return;
      }
      setBorrowerErrors({});
    }

    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    setConfirmOpen(false);
    const data = { ...form };
    if (!data.full_name) {
      const mid = data.middle_name || data.middle_initial || '';
      data.full_name = [data.first_name, mid, data.last_name].filter(Boolean).join(' ');
    }
    onSubmit(data);
    setForm(getInitialForm(contactType));
    setLenderErrors({});
    setBorrowerErrors({});
    setBrokerErrors({});
  };

  const typeLabel = contactType.charAt(0).toUpperCase() + contactType.slice(1);

  const renderInline = (label: string, key: string, type = 'text', forceDisabled = false) => (
    <div className="flex items-center gap-2">
      <Label className="w-[100px] shrink-0 text-xs">{label}</Label>
      <Input
        type={type}
        value={form[key] || ''}
        onChange={(e) => set(key, e.target.value)}
        disabled={forceDisabled}
        className="h-7 text-xs flex-1"
      />
    </div>
  );

  const renderSelect = (label: string, key: string, options: string[]) => (
    <div className="flex items-center gap-2">
      <Label className="w-[100px] shrink-0 text-xs">{label}</Label>
      <Select value={form[key] || ''} onValueChange={(v) => set(key, v)}>
        <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Select" /></SelectTrigger>
        <SelectContent className="bg-background border border-border z-[200]">
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const renderCheckbox = (label: string, key: string) => (
    <div className="flex items-center gap-2">
      <Checkbox
        checked={form[key] === 'true'}
        onCheckedChange={(checked) => set(key, String(!!checked))}
      />
      <Label className="text-xs">{label}</Label>
    </div>
  );

  const [dobOpen, setDobOpen] = useState(false);
  const [borrowerDobOpen, setBorrowerDobOpen] = useState(false);

  // --- Lender validation helpers ---
  const [lenderErrors, setLenderErrors] = useState<Record<string, string>>({});
  const setLErr = (f: string, m: string) => setLenderErrors(p => ({ ...p, [f]: m }));
  const clrLErr = (f: string) => setLenderErrors(p => { const n = { ...p }; delete n[f]; return n; });

  // --- Borrower validation helpers ---
  const [borrowerErrors, setBorrowerErrors] = useState<Record<string, string>>({});
  const setBErr = (f: string, m: string) => setBorrowerErrors(p => ({ ...p, [f]: m }));
  const clrBErr = (f: string) => setBorrowerErrors(p => { const n = { ...p }; delete n[f]; return n; });

  // --- Broker validation helpers ---
  const [brokerErrors, setBrokerErrors] = useState<Record<string, string>>({});
  const setKErr = (f: string, m: string) => setBrokerErrors(p => ({ ...p, [f]: m }));
  const clrKErr = (f: string) => setBrokerErrors(p => { const n = { ...p }; delete n[f]; return n; });

  const NAV_KEYS = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End'];
  const alphaSpaceKD = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (NAV_KEYS.includes(e.key) || e.ctrlKey || e.metaKey) return;
    if (!/^[A-Za-z ]$/.test(e.key)) e.preventDefault();
  };
  const alphaOnlyKD = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (NAV_KEYS.includes(e.key) || e.ctrlKey || e.metaKey) return;
    if (!/^[A-Za-z]$/.test(e.key)) e.preventDefault();
  };
  const digitOnlyKD = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (NAV_KEYS.includes(e.key) || e.ctrlKey || e.metaKey) return;
    if (!/^\d$/.test(e.key)) e.preventDefault();
  };

  const fmtTIN = (raw: string, idType: string): string => {
    const d = raw.replace(/\D/g, '').slice(0, 9);
    if (idType === '2') { // SSN: XXX-XX-XXXX
      if (d.length <= 3) return d;
      if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
      return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
    }
    if (idType === '1') { // EIN: XX-XXXXXXX
      if (d.length <= 2) return d;
      return `${d.slice(0, 2)}-${d.slice(2)}`;
    }
    return d;
  };

  const handleLenderPref = (prefKey: string, checked: boolean) => {
    const allPrefs = ['preferred.home', 'preferred.work', 'preferred.cell', 'preferred.fax'];
    setForm(prev => {
      const u = { ...prev };
      allPrefs.forEach(k => { u[k] = (k === prefKey && checked) ? 'true' : 'false'; });
      return u;
    });
  };

  const handleBorrowerPref = (prefKey: string, checked: boolean) => {
    const allPrefs = ['preferred.home', 'preferred.home2', 'preferred.work', 'preferred.cell', 'preferred.fax'];
    setForm(prev => {
      const u = { ...prev };
      allPrefs.forEach(k => { u[k] = (k === prefKey && checked) ? 'true' : 'false'; });
      return u;
    });
  };

  const handleBrokerPref = (prefKey: string) => {
    const allPrefs = ['preferred.home', 'preferred.work', 'preferred.cell', 'preferred.fax'];
    setForm(prev => {
      const u = { ...prev };
      allPrefs.forEach(k => { u[k] = k === prefKey ? 'true' : 'false'; });
      return u;
    });
  };

  const alphaNumKD = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (NAV_KEYS.includes(e.key) || e.ctrlKey || e.metaKey) return;
    if (!/^[A-Za-z0-9]$/.test(e.key)) e.preventDefault();
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(
        contactType === 'lender' || contactType === 'borrower'
          ? "max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
          : "max-w-4xl max-h-[85vh] overflow-y-auto"
      )}>
        <DialogHeader className={contactType === 'lender' || contactType === 'borrower' ? "shrink-0" : undefined}>
          <DialogTitle>Create New {typeLabel}</DialogTitle>
        </DialogHeader>

        {contactType === 'lender' && (
          <>
          <div className="flex-1 overflow-y-auto min-h-0 sleek-scrollbar">
            <LenderInfoForm
              fields={[]}
              values={lenderPrefixedValues}
              onValueChange={(prefixedKey, val) => {
                const k = prefixedKey.replace(/^lender\./, '');
                set(k, val);
                if (lenderErrors[k]) clrLErr(k);
              }}
            />
          </div>
          </>
        )}

        {contactType === 'broker' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-6 gap-y-0">
            {/* Column 1: Name + Broker or Representative */}
            <div className="space-y-1.5">
              <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2">Name</h3>

              {/* Broker ID (auto on save - read-only placeholder) */}
              <div className="flex items-center gap-2">
                <Label className="w-[140px] shrink-0 text-xs">Broker ID</Label>
                <Input value="" disabled placeholder="Auto-generated" className="h-7 text-xs flex-1 bg-muted" />
              </div>

              {/* Licensee Name If Entity - mirrors `company` for backward compat */}
              <div className="flex items-center gap-2">
                <Label className="w-[140px] shrink-0 text-xs">Licensee Name If Entity</Label>
                <Input
                  value={form['licensee_name_if_entity'] || ''}
                  onChange={(e) => { set('licensee_name_if_entity', e.target.value); set('company', e.target.value); clrKErr('company'); }}
                  onBlur={() => { const v = (form['licensee_name_if_entity'] || '').trim(); set('licensee_name_if_entity', v); set('company', v); if (!v) setKErr('company', 'Licensee Name is required'); else clrKErr('company'); }}
                  maxLength={100}
                  className={cn("h-7 text-xs flex-1", brokerErrors['company'] && "border-destructive")}
                />
              </div>
              {brokerErrors['company'] && <p className="text-[10px] text-destructive ml-[148px]">{brokerErrors['company']}</p>}

              {/* License Number */}
              <div className="flex items-center gap-2">
                <Label className="w-[140px] shrink-0 text-xs">License Number</Label>
                <Input value={form['License'] || ''} onChange={(e) => { set('License', e.target.value); clrKErr('License'); }} onKeyDown={alphaNumKD} onPaste={(e) => { e.preventDefault(); set('License', e.clipboardData.getData('text').replace(/[^A-Za-z0-9]/g, '')); }} onBlur={() => { const v = (form['License'] || '').trim(); set('License', v); if (!v) setKErr('License', 'Enter valid license number'); else clrKErr('License'); }} maxLength={50} className={cn("h-7 text-xs flex-1", brokerErrors['License'] && "border-destructive")} />
              </div>
              {brokerErrors['License'] && <p className="text-[10px] text-destructive ml-[148px]">{brokerErrors['License']}</p>}

              <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2 mt-4">Broker or Representative</h3>

              {/* First */}
              <div className="flex items-center gap-2">
                <Label className="w-[140px] shrink-0 text-xs">First</Label>
                <Input value={form['first_name'] || ''} onChange={(e) => { set('first_name', e.target.value); clrKErr('first_name'); }} onKeyDown={alphaOnlyKD} onPaste={(e) => { e.preventDefault(); set('first_name', e.clipboardData.getData('text').replace(/[^A-Za-z]/g, '')); }} onBlur={() => { const v = (form['first_name'] || '').trim(); set('first_name', v); if (!v) setKErr('first_name', 'Enter valid first name'); else clrKErr('first_name'); }} className={cn("h-7 text-xs flex-1", brokerErrors['first_name'] && "border-destructive")} />
              </div>
              {brokerErrors['first_name'] && <p className="text-[10px] text-destructive ml-[148px]">{brokerErrors['first_name']}</p>}

              {/* Middle */}
              <div className="flex items-center gap-2">
                <Label className="w-[140px] shrink-0 text-xs">Middle</Label>
                <Input value={form['middle_name'] || ''} onChange={(e) => set('middle_name', e.target.value)} onKeyDown={alphaOnlyKD} onPaste={(e) => { e.preventDefault(); set('middle_name', e.clipboardData.getData('text').replace(/[^A-Za-z]/g, '')); }} onBlur={() => set('middle_name', (form['middle_name'] || '').trim())} className="h-7 text-xs flex-1" />
              </div>

              {/* Last */}
              <div className="flex items-center gap-2">
                <Label className="w-[140px] shrink-0 text-xs">Last</Label>
                <Input value={form['last_name'] || ''} onChange={(e) => { set('last_name', e.target.value); clrKErr('last_name'); }} onKeyDown={alphaOnlyKD} onPaste={(e) => { e.preventDefault(); set('last_name', e.clipboardData.getData('text').replace(/[^A-Za-z]/g, '')); }} onBlur={() => { const v = (form['last_name'] || '').trim(); set('last_name', v); if (!v) setKErr('last_name', 'Enter valid last name'); else clrKErr('last_name'); }} className={cn("h-7 text-xs flex-1", brokerErrors['last_name'] && "border-destructive")} />
              </div>
              {brokerErrors['last_name'] && <p className="text-[10px] text-destructive ml-[148px]">{brokerErrors['last_name']}</p>}

              {/* Capacity */}
              <div className="flex items-center gap-2">
                <Label className="w-[140px] shrink-0 text-xs">Capacity</Label>
                <Select value={form['capacity'] || ''} onValueChange={(v) => set('capacity', v)}>
                  <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent className="bg-background border border-border z-[200]">
                    <SelectItem value="Broker">Broker</SelectItem>
                    <SelectItem value="Broker's Representative">Broker's Representative</SelectItem>
                    <SelectItem value="Unlicensed">Unlicensed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* License Number (Rep) */}
              <div className="flex items-center gap-2">
                <Label className="w-[140px] shrink-0 text-xs">License Number</Label>
                <Input value={form['rep_license'] || ''} onChange={(e) => set('rep_license', e.target.value)} onBlur={() => set('rep_license', (form['rep_license'] || '').trim())} maxLength={50} className="h-7 text-xs flex-1" />
              </div>

              {/* Email */}
              <div className="flex items-center gap-2">
                <Label className="w-[140px] shrink-0 text-xs">Email</Label>
                <EmailInput value={form['email'] || ''} onValueChange={(v) => { set('email', v); clrKErr('email'); }} className="h-7 text-xs" />
              </div>
              {brokerErrors['email'] && <p className="text-[10px] text-destructive ml-[148px]">{brokerErrors['email']}</p>}

              {/* Agreement on File + Date */}
              <div className="pt-2 flex items-center gap-2">
                <div className="flex items-center gap-2 w-[160px] shrink-0">
                  <Checkbox
                    checked={form['agreement_on_file'] === 'true'}
                    onCheckedChange={(checked) => set('agreement_on_file', String(!!checked))}
                  />
                  <Label className="text-xs">Agreement on File</Label>
                </div>
                <Input
                  type="date"
                  value={form['agreement_on_file_date'] || ''}
                  onChange={(e) => set('agreement_on_file_date', e.target.value)}
                  className="h-7 text-xs flex-1"
                />
              </div>
            </div>

            {/* Column 2: Primary Address + Mailing Address + Delivery Options */}
            <div className="space-y-1.5">
              <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2">Primary Address</h3>
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">Street</Label>
                <Input value={form['address.street'] || ''} onChange={(e) => { set('address.street', e.target.value); clrKErr('address.street'); }} onBlur={() => set('address.street', (form['address.street'] || '').trim())} maxLength={150} className={cn("h-7 text-xs flex-1", brokerErrors['address.street'] && "border-destructive")} />
              </div>
              {brokerErrors['address.street'] && <p className="text-[10px] text-destructive ml-[108px]">{brokerErrors['address.street']}</p>}
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">City</Label>
                <Input value={form['address.city'] || ''} onChange={(e) => { set('address.city', e.target.value); clrKErr('address.city'); }} onKeyDown={alphaSpaceKD} onPaste={(e) => { e.preventDefault(); set('address.city', e.clipboardData.getData('text').replace(/[^A-Za-z ]/g, '')); }} onBlur={() => set('address.city', (form['address.city'] || '').trim())} className={cn("h-7 text-xs flex-1", brokerErrors['address.city'] && "border-destructive")} />
              </div>
              {brokerErrors['address.city'] && <p className="text-[10px] text-destructive ml-[108px]">{brokerErrors['address.city']}</p>}
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">State</Label>
                <Select value={form['address.state'] || ''} onValueChange={(v) => { set('address.state', v); clrKErr('address.state'); }}>
                  <SelectTrigger className={cn("h-7 text-xs flex-1", brokerErrors['address.state'] && "border-destructive")}><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent className="bg-background border border-border z-[200]">
                    {US_STATES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              {brokerErrors['address.state'] && <p className="text-[10px] text-destructive ml-[108px]">{brokerErrors['address.state']}</p>}
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">ZIP</Label>
                <ZipInput value={form['address.zip'] || ''} onValueChange={(val) => { set('address.zip', val); clrKErr('address.zip'); }} className="h-7 text-xs" />
              </div>
              {brokerErrors['address.zip'] && <p className="text-[10px] text-destructive ml-[108px]">{brokerErrors['address.zip']}</p>}

              <div className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-border pb-1 mb-2 mt-4">
                <h3 className="font-semibold text-xs text-foreground">Mailing Address</h3>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Same as Primary</Label>
                  <Checkbox
                    checked={form['mailing_same_as_primary'] === 'true'}
                    onCheckedChange={(checked) => set('mailing_same_as_primary', String(!!checked))}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">Street</Label>
                <Input value={form['mailing.street'] || ''} onChange={(e) => set('mailing.street', e.target.value)} disabled={form['mailing_same_as_primary'] === 'true'} className="h-7 text-xs flex-1" />
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">City</Label>
                <Input value={form['mailing.city'] || ''} onChange={(e) => set('mailing.city', e.target.value)} disabled={form['mailing_same_as_primary'] === 'true'} className="h-7 text-xs flex-1" />
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">State</Label>
                <Select value={form['mailing.state'] || ''} onValueChange={(v) => set('mailing.state', v)} disabled={form['mailing_same_as_primary'] === 'true'}>
                  <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent className="bg-background border border-border z-[200]">
                    {US_STATES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">ZIP</Label>
                <ZipInput value={form['mailing.zip'] || ''} onValueChange={(val) => set('mailing.zip', val)} disabled={form['mailing_same_as_primary'] === 'true'} className="h-7 text-xs" />
              </div>

              <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2 mt-4">Delivery Options</h3>
              {([
                { key: 'delivery.online', label: 'Online' },
                { key: 'delivery.mailing_address', label: 'Mailing Address' },
                { key: 'delivery.sms', label: 'SMS' },
              ]).map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between">
                  <Label className="text-xs">{label}</Label>
                  <Checkbox
                    checked={form[key] === 'true'}
                    onCheckedChange={(checked) => set(key, String(!!checked))}
                  />
                </div>
              ))}
            </div>

            {/* Column 3: Phone + FORD + Send */}
            <div className="space-y-1.5">
              <div className="grid grid-cols-[40px_1fr_72px] items-center gap-2 border-b border-border pb-1 mb-2">
                <h3 className="font-semibold text-xs text-foreground">Phone</h3>
                <span />
                <span className="font-semibold text-xs text-foreground text-center">Preferred</span>
              </div>
              <RadioGroup
                value={['preferred.home', 'preferred.work', 'preferred.cell', 'preferred.fax'].find((key) => form[key] === 'true') || ''}
                onValueChange={handleBrokerPref}
                className="space-y-1.5"
              >
                {[
                  { label: 'Home', phoneKey: 'phone.home', prefKey: 'preferred.home' },
                  { label: 'Work', phoneKey: 'phone.work', prefKey: 'preferred.work' },
                  { label: 'Cell', phoneKey: 'phone.cell', prefKey: 'preferred.cell' },
                  { label: 'Fax', phoneKey: 'phone.fax', prefKey: 'preferred.fax' },
                ].map((p) => (
                  <div key={p.label} className="grid grid-cols-[40px_1fr_72px] items-center gap-2">
                    <Label className="w-[40px] shrink-0 text-xs">{p.label}</Label>
                    <PhoneInput
                      value={form[p.phoneKey] || ''}
                      onValueChange={(v) => set(p.phoneKey, v)}
                      className="h-7 text-xs flex-1"
                    />
                    <div className="flex justify-center">
                      <RadioGroupItem value={p.prefKey} aria-label={`Preferred ${p.label} phone`} />
                    </div>
                  </div>
                ))}
              </RadioGroup>

              <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2 mt-4">FORD</h3>
              <div className="space-y-1.5">
                {[['ford.1', 'ford.2'], ['ford.3', 'ford.4'], ['ford.5', 'ford.6'], ['ford.7', 'ford.8']].map(([dKey, iKey], idx) => (
                  <div key={idx} className="grid grid-cols-2 gap-2">
                    <Input value={form[dKey] || ''} onChange={(e) => set(dKey, e.target.value)} className="h-7 text-xs" placeholder="Category" />
                    <Input value={form[iKey] || ''} onChange={(e) => set(iKey, e.target.value)} className="h-7 text-xs" placeholder="Detail" />
                  </div>
                ))}
              </div>

              <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2 mt-4">Send</h3>
              {([
                { key: 'send_pref.payment_notification', label: 'Payment Notification' },
                { key: 'send_pref.late_notice', label: 'Late Notice' },
                { key: 'send_pref.borrower_statement', label: 'Borrower Statement' },
                { key: 'send_pref.maturity_notice', label: 'Maturity Notice' },
              ]).map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between">
                  <Label className="text-xs">{label}</Label>
                  <Checkbox
                    checked={form[key] === 'true'}
                    onCheckedChange={(checked) => set(key, String(!!checked))}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {contactType === 'borrower' && (
          <>
          <div className="flex-1 overflow-y-auto min-h-0 sleek-scrollbar">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-6 gap-y-0">
            {/* Column 1: Borrower Details */}
            <div className="space-y-1.5">
              <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2">Borrower Details</h3>

              {/* Borrower ID */}
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">Borrower ID</Label>
                <Input value={form['borrower_id'] || ''} onChange={(e) => set('borrower_id', e.target.value)} maxLength={50} className="h-7 text-xs flex-1" />
              </div>

              {/* Borrower Type - required */}
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">Borrower Type</Label>
                <Select value={form['borrower_type'] || ''} onValueChange={(v) => { set('borrower_type', v); clrBErr('borrower_type'); }}>
                  <SelectTrigger className={cn("h-7 text-xs flex-1", borrowerErrors['borrower_type'] && "border-destructive")}><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent className="bg-background border border-border z-[200]">
                    {BORROWER_TYPE_OPTIONS.map((opt) => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              {borrowerErrors['borrower_type'] && <p className="text-[10px] text-destructive ml-[108px]">{borrowerErrors['borrower_type']}</p>}

              {/* Entity Name (was Full Name) - alpha+spaces, max 100, required */}
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">Entity Name</Label>
                <Input value={form['full_name'] || ''} onChange={(e) => { set('full_name', e.target.value); clrBErr('full_name'); }} onKeyDown={alphaSpaceKD} onPaste={(e) => { e.preventDefault(); set('full_name', e.clipboardData.getData('text').replace(/[^A-Za-z ]/g, '')); }} onBlur={() => { const v = (form['full_name'] || '').trim(); set('full_name', v); if (!v) setBErr('full_name', 'Entity Name is required'); else clrBErr('full_name'); }} maxLength={100} className={cn("h-7 text-xs flex-1", borrowerErrors['full_name'] && "border-destructive")} />
              </div>
              {borrowerErrors['full_name'] && <p className="text-[10px] text-destructive ml-[108px]">{borrowerErrors['full_name']}</p>}

              {/* First Name - alpha only, required */}
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">First</Label>
                <Input value={form['first_name'] || ''} onChange={(e) => { set('first_name', e.target.value); clrBErr('first_name'); }} onKeyDown={alphaOnlyKD} onPaste={(e) => { e.preventDefault(); set('first_name', e.clipboardData.getData('text').replace(/[^A-Za-z]/g, '')); }} onBlur={() => { const v = (form['first_name'] || '').trim(); set('first_name', v); if (!v) setBErr('first_name', 'Enter valid first name'); else clrBErr('first_name'); }} className={cn("h-7 text-xs flex-1", borrowerErrors['first_name'] && "border-destructive")} />
              </div>
              {borrowerErrors['first_name'] && <p className="text-[10px] text-destructive ml-[108px]">{borrowerErrors['first_name']}</p>}

              {/* Middle Name - alpha only, optional */}
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">Middle</Label>
                <Input value={form['middle_initial'] || ''} onChange={(e) => set('middle_initial', e.target.value)} onKeyDown={alphaOnlyKD} onPaste={(e) => { e.preventDefault(); set('middle_initial', e.clipboardData.getData('text').replace(/[^A-Za-z]/g, '')); }} onBlur={() => set('middle_initial', (form['middle_initial'] || '').trim())} className="h-7 text-xs flex-1" />
              </div>

              {/* Last Name - alpha only, required */}
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">Last</Label>
                <Input value={form['last_name'] || ''} onChange={(e) => { set('last_name', e.target.value); clrBErr('last_name'); }} onKeyDown={alphaOnlyKD} onPaste={(e) => { e.preventDefault(); set('last_name', e.clipboardData.getData('text').replace(/[^A-Za-z]/g, '')); }} onBlur={() => { const v = (form['last_name'] || '').trim(); set('last_name', v); if (!v) setBErr('last_name', 'Enter valid last name'); else clrBErr('last_name'); }} className={cn("h-7 text-xs flex-1", borrowerErrors['last_name'] && "border-destructive")} />
              </div>
              {borrowerErrors['last_name'] && <p className="text-[10px] text-destructive ml-[108px]">{borrowerErrors['last_name']}</p>}

              {/* Capacity */}
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">Capacity</Label>
                <Select value={form['capacity'] || ''} onValueChange={(v) => set('capacity', v)}>
                  <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent className="bg-background border border-border z-[200]">
                    {BORROWER_CAPACITY_OPTIONS.map((opt) => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>

              {/* Email */}
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">Email</Label>
                <EmailInput value={form['email'] || ''} onValueChange={(v) => { set('email', v); clrBErr('email'); }} className="h-7 text-xs" />
              </div>
              {borrowerErrors['email'] && <p className="text-[10px] text-destructive ml-[108px]">{borrowerErrors['email']}</p>}

              {/* Delivery Options - placed below Email per Borrower form */}
              <div className="pt-2">
                <h4 className="font-semibold text-xs text-foreground pb-1">Delivery Options</h4>
                <div className="flex items-center gap-4">
                  {renderCheckbox('Print', 'delivery_print')}
                  {renderCheckbox('Email', 'delivery_email')}
                  {renderCheckbox('SMS', 'delivery_sms')}
                </div>
              </div>

              <div className="pt-2 space-y-1">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={form['agreement_on_file'] === 'true'}
                    onCheckedChange={(checked) => set('agreement_on_file', String(!!checked))}
                  />
                  <Label className="text-xs">Agreement on File</Label>
                  <Input
                    type="date"
                    value={form['agreement_on_file_date'] || ''}
                    onChange={(e) => set('agreement_on_file_date', e.target.value)}
                    className="h-7 text-xs w-[140px]"
                  />
                </div>
              </div>
            </div>

            {/* Column 2: Primary Address + Mailing */}
            <div className="space-y-1.5">
              <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-2">Primary Address</h3>
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">Street</Label>
                <Input value={form['address.street'] || ''} onChange={(e) => { set('address.street', e.target.value); clrBErr('address.street'); }} onBlur={() => set('address.street', (form['address.street'] || '').trim())} maxLength={150} className={cn("h-7 text-xs flex-1", borrowerErrors['address.street'] && "border-destructive")} />
              </div>
              {borrowerErrors['address.street'] && <p className="text-[10px] text-destructive ml-[108px]">{borrowerErrors['address.street']}</p>}
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">City</Label>
                <Input value={form['address.city'] || ''} onChange={(e) => { set('address.city', e.target.value); clrBErr('address.city'); }} onKeyDown={alphaSpaceKD} onPaste={(e) => { e.preventDefault(); set('address.city', e.clipboardData.getData('text').replace(/[^A-Za-z ]/g, '')); }} onBlur={() => set('address.city', (form['address.city'] || '').trim())} className={cn("h-7 text-xs flex-1", borrowerErrors['address.city'] && "border-destructive")} />
              </div>
              {borrowerErrors['address.city'] && <p className="text-[10px] text-destructive ml-[108px]">{borrowerErrors['address.city']}</p>}
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">State</Label>
                <Select value={form['address.state'] || ''} onValueChange={(v) => { set('address.state', v); clrBErr('address.state'); }}>
                  <SelectTrigger className={cn("h-7 text-xs flex-1", borrowerErrors['address.state'] && "border-destructive")}><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent className="bg-background border border-border z-[200]">
                    {US_STATES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              {borrowerErrors['address.state'] && <p className="text-[10px] text-destructive ml-[108px]">{borrowerErrors['address.state']}</p>}
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">ZIP</Label>
                <ZipInput value={form['address.zip'] || ''} onValueChange={(val) => { set('address.zip', val); clrBErr('address.zip'); }} className="h-7 text-xs" />
              </div>
              {borrowerErrors['address.zip'] && <p className="text-[10px] text-destructive ml-[108px]">{borrowerErrors['address.zip']}</p>}
              <div className="pt-2 space-y-1.5">
                <h3 className="font-semibold text-xs text-foreground border-b border-border pb-1 mb-1">Mailing Address</h3>
                {renderCheckbox('Same as Primary', 'mailing_same_as_primary')}
                <div className="flex items-center gap-2">
                  <Label className="w-[100px] shrink-0 text-xs">Street</Label>
                  <Input value={form['mailing.street'] || ''} onChange={(e) => set('mailing.street', e.target.value)} onBlur={() => set('mailing.street', (form['mailing.street'] || '').trim())} disabled={isSameAsPrimary} maxLength={150} className="h-7 text-xs flex-1" />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-[100px] shrink-0 text-xs">City</Label>
                  <Input value={form['mailing.city'] || ''} onChange={(e) => set('mailing.city', e.target.value)} onKeyDown={alphaSpaceKD} onPaste={(e) => { e.preventDefault(); set('mailing.city', e.clipboardData.getData('text').replace(/[^A-Za-z ]/g, '')); }} onBlur={() => set('mailing.city', (form['mailing.city'] || '').trim())} disabled={isSameAsPrimary} className="h-7 text-xs flex-1" />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-[100px] shrink-0 text-xs">State</Label>
                  <Select value={form['mailing.state'] || ''} onValueChange={(v) => set('mailing.state', v)} disabled={isSameAsPrimary}>
                    <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent className="bg-background border border-border z-[200]">
                      {US_STATES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-[100px] shrink-0 text-xs">ZIP</Label>
                  <ZipInput value={form['mailing.zip'] || ''} onValueChange={(val) => set('mailing.zip', val)} disabled={isSameAsPrimary} className="h-7 text-xs" />
                </div>
              </div>
              <div className="pt-2 space-y-1">
                <h4 className="font-semibold text-xs text-foreground pb-1">Send</h4>
                {renderCheckbox('Payment Confirmation', 'send_pref.payment_confirmation')}
                {renderCheckbox('Coupon Book', 'send_pref.coupon_book')}
                {renderCheckbox('Payment Statement', 'send_pref.payment_statement')}
                {renderCheckbox('Late Notice', 'send_pref.late_notice')}
                {renderCheckbox('Maturity Notice', 'send_pref.maturity_notice')}
              </div>
            </div>

            {/* Column 3: Phone (with second Home + Preferred) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between border-b border-border pb-1 mb-2">
                <h3 className="font-semibold text-xs text-foreground">Phone</h3>
                <span className="font-semibold text-xs text-foreground">Pref</span>
              </div>
              <RadioGroup
                value={['preferred.home', 'preferred.home2', 'preferred.work', 'preferred.cell', 'preferred.fax'].find((key) => form[key] === 'true') || ''}
                onValueChange={(value) => handleBorrowerPref(value, true)}
                className="space-y-1.5"
              >
                {[
                  { label: 'Home', phoneKey: 'phone.home', prefKey: 'preferred.home', hasPref: true },
                  { label: 'Home', phoneKey: 'phone.home2', prefKey: 'preferred.home2', hasPref: true },
                  { label: 'Work', phoneKey: 'phone.work', prefKey: 'preferred.work', hasPref: true },
                  { label: 'Cell', phoneKey: 'phone.cell', prefKey: 'preferred.cell', hasPref: true },
                  { label: 'Fax', phoneKey: 'phone.fax', prefKey: 'preferred.fax', hasPref: false },
                ].map((p, idx) => (
                  <div key={`${p.phoneKey}-${idx}`} className="flex items-center gap-2">
                    <Label className="w-[40px] shrink-0 text-xs">{p.label}</Label>
                    <PhoneInput
                      value={form[p.phoneKey] || ''}
                      onValueChange={(v) => set(p.phoneKey, v)}
                      className="h-7 text-xs flex-1"
                    />
                    {p.hasPref ? (
                      <RadioGroupItem value={p.prefKey} id={`borrower-${p.prefKey}`} />
                    ) : (
                      <div className="w-4 h-4" />
                    )}
                  </div>
                ))}
              </RadioGroup>

              <div className="pt-2">
                <h4 className="font-semibold text-xs text-foreground pb-1">Vesting</h4>
                <Textarea value={form['vesting'] || ''} onChange={(e) => set('vesting', e.target.value)} className="text-xs min-h-[60px] resize-none" />
              </div>

              <div className="pt-2">
                <h4 className="font-semibold text-xs text-foreground pb-1">FORD</h4>
                <div className="space-y-1">
                  {([['ford.1', 'ford.2'], ['ford.3', 'ford.4'], ['ford.5', 'ford.6'], ['ford.7', 'ford.8']] as const).map(([dropdownKey, inputKey], idx) => (
                    <div key={idx} className="grid grid-cols-2 gap-1">
                      <Select value={form[dropdownKey] || ''} onValueChange={(v) => set(dropdownKey, v)}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent className="bg-background border border-border z-[200]">
                          {BORROWER_FORD_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Input value={form[inputKey] || ''} onChange={(e) => set(inputKey, e.target.value)} className="h-7 text-xs" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          </div>
          </>
        )}

        <DialogFooter className={contactType === 'lender' || contactType === 'borrower' ? "shrink-0" : undefined}>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!hasAtLeastOneFieldFilled(form, ['mailing_same_as_primary', 'preferred.home', 'preferred.home2', 'preferred.work', 'preferred.cell', 'preferred.fax', 'delivery.print', 'delivery.email', 'delivery.sms', 'delivery_print', 'delivery_email', 'delivery_sms', 'agreement_on_file', 'agreement_on_file_date', 'send_pref.payment_notification', 'send_pref.late_notice', 'send_pref.borrower_statement', 'send_pref.maturity_notice', 'send_pref.payment_confirmation', 'send_pref.coupon_book', 'send_pref.payment_statement']) || !hasValidContactEmails(form)}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogContent className="z-[9999]">
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm Create {typeLabel}</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to create this new {contactType} contact? Please verify the entered data is correct.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>Confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
};