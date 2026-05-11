import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ZipInput } from '@/components/ui/zip-input';
import { EmailInput } from '@/components/ui/email-input';
import { PhoneInput } from '@/components/ui/phone-input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { hasAtLeastOneFieldFilled, validatePhoneFields } from '@/lib/contactFormValidation';
import { toast } from 'sonner';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { US_STATES } from '@/lib/usStates';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { ContactBorrower } from '@/pages/contacts/ContactBorrowersPage';

interface Props {
  borrower: ContactBorrower;
  onSave: (updated: ContactBorrower) => void;
  onCancel: () => void;
}

export const ContactBorrowerDetailForm: React.FC<Props> = ({ borrower, onSave, onCancel }) => {
  const [form, setForm] = useState<ContactBorrower>(borrower);
  const [showConfirm, setShowConfirm] = useState(false);

  const initialSnapshot = useMemo(() => JSON.stringify(borrower), [borrower]);
  const isDirty = JSON.stringify(form) !== initialSnapshot;

  const set = (field: string, value: any) => setForm((p) => {
    const updated = { ...p, [field]: value };
    if (field === 'firstName' || field === 'lastName') {
      const fn = field === 'firstName' ? value : p.firstName;
      const ln = field === 'lastName' ? value : p.lastName;
      updated.fullName = `${fn} ${ln}`.trim();
    }
    return updated;
  });

  useEffect(() => {
    if (form.sameAsPrimary) {
      setForm((p) => ({ ...p, mailingStreet: p.street, mailingCity: p.city, mailingState: p.state, mailingZip: p.zip }));
    }
  }, [form.sameAsPrimary, form.street, form.city, form.state, form.zip]);

  const handleSameAsPrimary = (checked: boolean) => {
    if (checked) {
      setForm((p) => ({ ...p, sameAsPrimary: true, mailingStreet: p.street, mailingCity: p.city, mailingState: p.state, mailingZip: p.zip }));
    } else {
      setForm((p) => ({ ...p, sameAsPrimary: false, mailingStreet: '', mailingCity: '', mailingState: '', mailingZip: '' }));
    }
  };

  const handleSaveClick = () => {
    if (!hasAtLeastOneFieldFilled(form as any, ['borrowerId', 'preferredPhone', 'type'])) {
      toast.error('Please fill at least one field before saving');
      return;
    }
    const phoneErrors = validatePhoneFields([
      { label: 'Home Phone', value: form.homePhone },
      { label: 'Work Phone', value: form.workPhone },
      { label: 'Cell Phone', value: form.cellPhone },
      { label: 'Fax', value: form.fax },
    ]);
    if (phoneErrors.length > 0) { toast.error(phoneErrors[0]); return; }
    setShowConfirm(true);
  };

  const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className="space-y-3">
      <h4 className="font-semibold text-sm text-foreground border-b border-border pb-1">{title}</h4>
      {children}
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <Section title="Basic Information">
        <div className="grid grid-cols-2 gap-4">
          <div><Label>Borrower ID</Label><Input value={form.borrowerId} disabled className="bg-muted" /></div>
          <div><Label>Full Name</Label><Input value={form.fullName} disabled className="bg-muted" /></div>
          <div><Label>First Name</Label><Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} /></div>
          <div><Label>Last Name</Label><Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} /></div>
          <div><Label>Type</Label>
            <Select value={form.type} onValueChange={(v) => set('type', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Individual">Individual</SelectItem>
                <SelectItem value="Entity">Entity</SelectItem>
                <SelectItem value="Trust">Trust</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-6 pt-6">
            <div className="flex items-center gap-2"><Checkbox checked={form.hold} onCheckedChange={(v) => set('hold', !!v)} /><Label>Hold</Label></div>
            <div className="flex items-center gap-2"><Checkbox checked={form.verified} onCheckedChange={(v) => set('verified', !!v)} /><Label>Verified</Label></div>
          </div>
        </div>
      </Section>

      <Section title="Contact Information">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Label>Email</Label><EmailInput value={form.email} onValueChange={(v) => set('email', v)} /></div>
          <div><Label>Home Phone</Label><PhoneInput value={form.homePhone} onValueChange={(v) => set('homePhone', v)} /></div>
          <div><Label>Work Phone</Label><PhoneInput value={form.workPhone} onValueChange={(v) => set('workPhone', v)} /></div>
          <div><Label>Cell Phone</Label><PhoneInput value={form.cellPhone} onValueChange={(v) => set('cellPhone', v)} /></div>
          <div><Label>Fax</Label><PhoneInput value={form.fax} onValueChange={(v) => set('fax', v)} /></div>
        </div>
        <div>
          <Label>Preferred Phone</Label>
          <RadioGroup value={form.preferredPhone} onValueChange={(v) => set('preferredPhone', v)} className="flex gap-4 mt-1">
            <div className="flex items-center gap-1"><RadioGroupItem value="home" /><Label>Home</Label></div>
            <div className="flex items-center gap-1"><RadioGroupItem value="work" /><Label>Work</Label></div>
            <div className="flex items-center gap-1"><RadioGroupItem value="cell" /><Label>Cell</Label></div>
          </RadioGroup>
        </div>
      </Section>

      <Section title="Financial / Compliance">
        <div className="grid grid-cols-2 gap-4">
          <div><Label>TIN</Label><Input value={form.tin} onChange={(e) => set('tin', e.target.value)} /></div>
          <div className="flex items-center gap-6 pt-6">
            <div className="flex items-center gap-2"><Checkbox checked={form.ach} onCheckedChange={(v) => set('ach', !!v)} /><Label>ACH</Label></div>
            <div className="flex items-center gap-2"><Checkbox checked={form.send1099} onCheckedChange={(v) => set('send1099', !!v)} /><Label>Send 1099</Label></div>
            <div className="flex items-center gap-2"><Checkbox checked={form.agreement} onCheckedChange={(v) => set('agreement', !!v)} /><Label>Agreement on File</Label></div>
          </div>
        </div>
      </Section>

      <Section title="Primary Address">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Label>Street</Label><Input value={form.street} onChange={(e) => set('street', e.target.value)} /></div>
          <div><Label>City</Label><Input value={form.city} onChange={(e) => set('city', e.target.value)} /></div>
          <div><Label>State</Label>
            <Select value={form.state || '__select__'} onValueChange={(v) => set('state', v === '__select__' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent className="bg-background border border-border z-[200] max-h-60">
                <SelectItem value="__select__">Select</SelectItem>
                {US_STATES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>ZIP</Label><ZipInput value={form.zip} onValueChange={(v) => set('zip', v)} /></div>
        </div>
      </Section>

      <Section title="Mailing Address">
        <div className="flex items-center gap-2 mb-2">
          <Checkbox checked={form.sameAsPrimary} onCheckedChange={(v) => handleSameAsPrimary(!!v)} />
          <Label>Same as Primary Address</Label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Label>Mailing Street</Label><Input value={form.mailingStreet} onChange={(e) => set('mailingStreet', e.target.value)} readOnly={form.sameAsPrimary} className={form.sameAsPrimary ? 'bg-muted' : ''} /></div>
          <div><Label>Mailing City</Label><Input value={form.mailingCity} onChange={(e) => set('mailingCity', e.target.value)} readOnly={form.sameAsPrimary} className={form.sameAsPrimary ? 'bg-muted' : ''} /></div>
          <div><Label>Mailing State</Label><Input value={form.mailingState} onChange={(e) => set('mailingState', e.target.value)} readOnly={form.sameAsPrimary} className={form.sameAsPrimary ? 'bg-muted' : ''} /></div>
          <div><Label>Mailing ZIP</Label><ZipInput value={form.mailingZip} onValueChange={(v) => set('mailingZip', v)} readOnly={form.sameAsPrimary} className={form.sameAsPrimary ? 'bg-muted' : ''} /></div>
        </div>
      </Section>

      {isDirty && (
        <div className="flex gap-3 pt-2">
          <Button onClick={handleSaveClick}>Save Changes</Button>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
        </div>
      )}

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save Changes</AlertDialogTitle>
            <AlertDialogDescription>Do you want to save the data?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => onSave(form)}>Yes, Save</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
