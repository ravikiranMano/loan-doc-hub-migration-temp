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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { ContactBroker } from '@/pages/contacts/ContactBrokersPage';
import { getLicenseNumberError, sanitizeLicenseNumber } from '@/lib/licenseNumberValidation';

interface Props {
  broker: ContactBroker;
  onSave: (updated: ContactBroker) => void;
  onCancel: () => void;
}

export const ContactBrokerDetailForm: React.FC<Props> = ({ broker, onSave, onCancel }) => {
  const [form, setForm] = useState<ContactBroker>({ ...broker });
  const [showConfirm, setShowConfirm] = useState(false);

  const initialSnapshot = useMemo(() => JSON.stringify(broker), [broker]);
  const isDirty = JSON.stringify(form) !== initialSnapshot;

  const set = (field: keyof ContactBroker, value: string | boolean) =>
    setForm((p) => ({ ...p, [field]: value }));

  useEffect(() => {
    if (form.sameAsPrimary) {
      setForm((p) => ({
        ...p,
        mailingStreet: p.street,
        mailingCity: p.city,
        mailingState: p.state,
        mailingZip: p.zip,
      }));
    }
  }, [form.sameAsPrimary, form.street, form.city, form.state, form.zip]);

  const handleSameAsPrimaryChange = (checked: boolean) => {
    if (checked) {
      setForm((p) => ({
        ...p,
        sameAsPrimary: true,
        mailingStreet: p.street,
        mailingCity: p.city,
        mailingState: p.state,
        mailingZip: p.zip,
      }));
    } else {
      setForm((p) => ({
        ...p,
        sameAsPrimary: false,
        mailingStreet: '',
        mailingCity: '',
        mailingState: '',
        mailingZip: '',
      }));
    }
  };
  // expose for any future usage if needed
  void handleSameAsPrimaryChange;

  const handleSaveClick = () => {
    if (!hasAtLeastOneFieldFilled(form as any, ['brokerId', 'preferredPhone', 'type'])) {
      toast.error('Please fill at least one field before saving');
      return;
    }
    const phoneErrors = validatePhoneFields([
      { label: 'Home Phone', value: form.homePhone },
      { label: 'Work Phone', value: form.workPhone },
      { label: 'Cell Phone', value: form.cellPhone },
      { label: 'Fax', value: form.fax },
      { label: 'Rep Phone', value: form.repPhone },
    ]);
    if (phoneErrors.length > 0) { toast.error(phoneErrors[0]); return; }
    setShowConfirm(true);
  };

  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <h4 className="text-sm font-semibold text-foreground border-b border-border pb-1 mb-3 mt-6 first:mt-0">{children}</h4>
  );

  return (
    <div className="max-w-3xl space-y-2">
      {/* Basic Information */}
      <SectionTitle>Basic Information</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Broker ID</Label>
          <Input value={form.brokerId} disabled className="bg-muted" />
        </div>
        <div>
          <Label>Company</Label>
          <Input value={form.company} onChange={(e) => set('company', e.target.value)} />
        </div>
        <div>
          <Label>License</Label>
          <Input value={form.license} onChange={(e) => set('license', e.target.value)} />
        </div>
        <div>
          <Label>Type</Label>
          <Select value={form.type} onValueChange={(v) => set('type', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Individual">Individual</SelectItem>
              <SelectItem value="Entity">Entity</SelectItem>
              <SelectItem value="Trust">Trust</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-6">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.hold} onCheckedChange={(v) => set('hold', !!v)} /> Hold
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.verified} onCheckedChange={(v) => set('verified', !!v)} /> Verified
          </label>
        </div>
      </div>

      {/* Broker's Representative */}
      <SectionTitle>Broker's Representative</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>First Name</Label>
          <Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
        </div>
        <div>
          <Label>Last Name</Label>
          <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
        </div>
        <div>
          <Label>Phone</Label>
          <PhoneInput value={form.repPhone} onValueChange={(v) => set('repPhone', v)} />
        </div>
        <div>
          <Label>Email</Label>
          <EmailInput value={form.repEmail} onValueChange={(v) => set('repEmail', v)} />
        </div>
        <div>
          <Label>License Number</Label>
          {(() => {
            const raw = form.repLicense || '';
            const error = getLicenseNumberError(raw);
            return (
              <>
                <Input
                  value={raw}
                  maxLength={50}
                  onChange={(e) => {
                    const filtered = sanitizeLicenseNumber(e.target.value);
                    set('repLicense', filtered);
                  }}
                  onBlur={(e) => {
                    const t = e.target.value.trim();
                    if (t !== e.target.value) set('repLicense', t);
                  }}
                  aria-invalid={!!error}
                  className={error ? 'border-destructive' : ''}
                />
                {error && <p className="text-xs text-destructive mt-1">{error}</p>}
              </>
            );
          })()}
        </div>
      </div>

      {/* Contact Information */}
      <SectionTitle>Contact Information</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label>Email</Label>
          <EmailInput value={form.email} onValueChange={(v) => set('email', v)} />
        </div>
        <div className="col-span-2">
          <div className="grid grid-cols-[60px_1fr_90px] items-center gap-3 mb-1">
            <span />
            <Label className="text-xs font-semibold">Phone</Label>
            <Label className="text-xs font-semibold text-center">Preferred</Label>
          </div>
          <RadioGroup
            value={form.preferredPhone}
            onValueChange={(v) => set('preferredPhone', v)}
            className="space-y-2"
          >
            {[
              { key: 'homePhone', label: 'Home', value: 'Home' },
              { key: 'workPhone', label: 'Work', value: 'Work' },
              { key: 'cellPhone', label: 'Cell', value: 'Cell' },
              { key: 'fax', label: 'Fax', value: 'Fax' },
            ].map((row) => (
              <div key={row.key} className="grid grid-cols-[60px_1fr_90px] items-center gap-3">
                <Label className="text-sm">{row.label}</Label>
                <PhoneInput
                  value={(form as any)[row.key] || ''}
                  onValueChange={(v) => set(row.key as any, v)}
                />
                <div className="flex justify-center">
                  <RadioGroupItem value={row.value} id={`pref-${row.value}`} />
                </div>
              </div>
            ))}
          </RadioGroup>
        </div>
      </div>


      {/* Address */}
      <SectionTitle>Address</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label>Street</Label>
          <Input value={form.street} onChange={(e) => set('street', e.target.value)} />
        </div>
        <div>
          <Label>City</Label>
          <Input value={form.city} onChange={(e) => set('city', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>State</Label>
            <Input value={form.state} onChange={(e) => set('state', e.target.value)} />
          </div>
          <div>
            <Label>ZIP</Label>
            <ZipInput value={form.zip} onValueChange={(v) => set('zip', v)} />
          </div>
        </div>
      </div>

      {isDirty && (
        <div className="flex justify-end gap-2 pt-6">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleSaveClick}>Save Changes</Button>
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
