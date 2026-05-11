import React, { useState, useEffect, useMemo } from 'react';
import { US_STATES } from '@/lib/usStates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ZipInput } from '@/components/ui/zip-input';
import { EmailInput } from '@/components/ui/email-input';
import { PhoneInput } from '@/components/ui/phone-input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { hasAtLeastOneFieldFilled, validatePhoneFields } from '@/lib/contactFormValidation';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { ContactLender } from '@/pages/contacts/ContactLendersPage';

interface Props {
  lender: ContactLender;
  onSave: (lender: ContactLender) => void;
  onCancel: () => void;
}

export const ContactLenderDetailForm: React.FC<Props> = ({ lender, onSave, onCancel }) => {
  const [form, setForm] = useState<ContactLender>({ ...lender });
  const [showConfirm, setShowConfirm] = useState(false);

  const initialSnapshot = useMemo(() => JSON.stringify(lender), [lender]);
  const isDirty = JSON.stringify(form) !== initialSnapshot;

  const set = (field: string, value: any) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  // Same as primary address sync
  useEffect(() => {
    if (form.sameAsPrimary) {
      setForm((prev) => ({
        ...prev,
        mailingStreet: prev.street,
        mailingCity: prev.city,
        mailingState: prev.state,
        mailingZip: prev.zip,
      }));
    }
  }, [form.sameAsPrimary, form.street, form.city, form.state, form.zip]);

  const handleSameAsPrimaryChange = (checked: boolean) => {
    if (checked) {
      set('sameAsPrimary', true);
    } else {
      setForm((prev) => ({
        ...prev,
        sameAsPrimary: false,
        mailingStreet: '',
        mailingCity: '',
        mailingState: '',
        mailingZip: '',
      }));
    }
  };

  const handleSaveClick = () => {
    if (!hasAtLeastOneFieldFilled(form as any, ['lenderId', 'preferredPhone', 'type'])) {
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

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Basic Information */}
      <div>
        <h4 className="font-semibold text-base text-foreground mb-3">Basic Information</h4>
        <Separator className="mb-4" />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Lender ID</Label>
            <Input value={form.lenderId} disabled className="bg-muted/50" />
          </div>
          <div />
          <div className="col-span-2">
            <Label>Full Name</Label>
            <Input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
          </div>
          <div>
            <Label>First Name</Label>
            <Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
          </div>
          <div>
            <Label>Last Name</Label>
            <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={form.type} onValueChange={(v) => set('type', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Individual">Individual</SelectItem>
                <SelectItem value="Entity">Entity</SelectItem>
                <SelectItem value="Trust">Trust</SelectItem>
                <SelectItem value="IRA">IRA</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div />
          <div className="flex items-center gap-2">
            <Checkbox checked={form.frozen} onCheckedChange={(v) => set('frozen', !!v)} />
            <Label>Frozen</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox checked={form.verified} onCheckedChange={(v) => set('verified', !!v)} />
            <Label>Verified</Label>
          </div>
          <div className="col-span-2">
            <Label>Investor Questionnaire</Label>
            <Input
              value={form.investorQuestionnaire}
              onChange={(e) => set('investorQuestionnaire', e.target.value)}
              placeholder="Upload file or enter link"
            />
          </div>
        </div>
      </div>

      {/* Contact Information */}
      <div>
        <h4 className="font-semibold text-base text-foreground mb-3">Contact Information</h4>
        <Separator className="mb-4" />
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>Email</Label>
            <EmailInput value={form.email} onValueChange={(v) => set('email', v)} />
          </div>
          <div className="col-span-2">
            <div className="grid grid-cols-[80px_1fr_90px] items-center gap-3 mb-2">
              <div />
              <Label className="text-muted-foreground">Phone</Label>
              <Label className="text-muted-foreground text-center">Preferred</Label>
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
                <div key={row.key} className="grid grid-cols-[80px_1fr_90px] items-center gap-3">
                  <Label className="font-normal">{row.label}</Label>
                  <PhoneInput
                    value={(form as any)[row.key]}
                    onValueChange={(v) => set(row.key as any, v)}
                  />
                  <div className="flex justify-center">
                    <RadioGroupItem value={row.value} id={`pref-lender-${row.key}`} />
                  </div>
                </div>
              ))}
            </RadioGroup>
          </div>
        </div>
      </div>

      {/* Financial / Compliance */}
      <div>
        <h4 className="font-semibold text-base text-foreground mb-3">Financial / Compliance</h4>
        <Separator className="mb-4" />
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2">
            <Checkbox checked={form.ach} onCheckedChange={(v) => set('ach', !!v)} />
            <Label>ACH</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox checked={form.send1099} onCheckedChange={(v) => set('send1099', !!v)} />
            <Label>Send 1099</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox checked={form.agreement} onCheckedChange={(v) => set('agreement', !!v)} />
            <Label>Agreement on File</Label>
          </div>
        </div>
      </div>

      {/* Primary Address */}
      <div>
        <h4 className="font-semibold text-base text-foreground mb-3">Primary Address</h4>
        <Separator className="mb-4" />
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>Street</Label>
            <Input value={form.street} onChange={(e) => set('street', e.target.value)} />
          </div>
          <div>
            <Label>City</Label>
            <Input value={form.city} onChange={(e) => set('city', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>State</Label>
              <Select value={form.state || '__select__'} onValueChange={(v) => set('state', v === '__select__' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__select__">Select</SelectItem>
                  {US_STATES.map(s => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>ZIP</Label>
              <ZipInput value={form.zip} onValueChange={(v) => set('zip', v)} />
            </div>
          </div>
        </div>
      </div>

      {/* Mailing Address */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <h4 className="font-semibold text-base text-foreground">Mailing Address</h4>
          <div className="flex items-center gap-1.5">
            <Checkbox
              checked={form.sameAsPrimary}
              onCheckedChange={(v) => handleSameAsPrimaryChange(!!v)}
            />
            <Label className="font-normal text-sm">Same as Primary Address</Label>
          </div>
        </div>
        <Separator className="mb-4" />
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>Mailing Street</Label>
            <Input
              value={form.mailingStreet}
              onChange={(e) => set('mailingStreet', e.target.value)}
              readOnly={form.sameAsPrimary}
              className={form.sameAsPrimary ? 'bg-muted/50' : ''}
            />
          </div>
          <div>
            <Label>Mailing City</Label>
            <Input
              value={form.mailingCity}
              onChange={(e) => set('mailingCity', e.target.value)}
              readOnly={form.sameAsPrimary}
              className={form.sameAsPrimary ? 'bg-muted/50' : ''}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Mailing State</Label>
              <Select value={form.mailingState} onValueChange={(v) => set('mailingState', v)} disabled={form.sameAsPrimary}>
                <SelectTrigger className={form.sameAsPrimary ? 'bg-muted/50' : ''}><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {US_STATES.map(s => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Mailing ZIP</Label>
              <ZipInput
                value={form.mailingZip}
                onValueChange={(v) => set('mailingZip', v)}
                readOnly={form.sameAsPrimary}
                className={form.sameAsPrimary ? 'bg-muted/50' : ''}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Actions - only visible when dirty */}
      {isDirty && (
        <div className="flex justify-end gap-2 pt-4">
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
