import React, { useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PhoneInput } from '@/components/ui/phone-input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { hasAtLeastOneFieldFilled, validatePhoneFields, hasValidContactEmails } from '@/lib/contactFormValidation';
import { toast } from 'sonner';
import type { ContactLender } from '@/pages/contacts/ContactLendersPage';

interface ContactLenderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: Omit<ContactLender, 'id' | 'lenderId'>) => void;
}

const emptyForm = (): Omit<ContactLender, 'id' | 'lenderId'> => ({
  frozen: false,
  type: 'Individual',
  ach: false,
  email: '',
  agreement: false,
  fullName: '',
  firstName: '',
  lastName: '',
  city: '',
  state: '',
  cellPhone: '',
  homePhone: '',
  workPhone: '',
  fax: '',
  preferredPhone: 'Cell',
  verified: false,
  send1099: false,
  tin: '',
  investorQuestionnaire: '',
  street: '',
  zip: '',
  mailingStreet: '',
  mailingCity: '',
  mailingState: '',
  mailingZip: '',
  sameAsPrimary: false,
});

export const ContactLenderModal: React.FC<ContactLenderModalProps> = ({
  open, onOpenChange, onSubmit,
}) => {
  const [form, setForm] = useState(emptyForm());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const set = (field: string, value: any) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = () => {
    // Check at least one field is filled
    if (!hasAtLeastOneFieldFilled(form as any, ['preferredPhone', 'type'])) {
      toast.error('Please fill at least one field before saving');
      return;
    }
    // Validate phone fields
    const phoneErrors = validatePhoneFields([
      { label: 'Home Phone', value: form.homePhone },
      { label: 'Work Phone', value: form.workPhone },
      { label: 'Cell Phone', value: form.cellPhone },
      { label: 'Fax', value: form.fax },
    ]);
    if (phoneErrors.length > 0) {
      toast.error(phoneErrors[0]);
      return;
    }
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    setConfirmOpen(false);
    const data = {
      ...form,
      fullName: form.fullName || `${form.firstName} ${form.lastName}`.trim(),
    };
    onSubmit(data);
    setForm(emptyForm());
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Contact Lender</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Basic */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Full Name</Label>
                <Input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
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
              <div>
                <Label>First Name</Label>
                <Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
              </div>
              <div>
                <Label>Last Name</Label>
                <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
              </div>
            </div>

            {/* Checkboxes */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Checkbox checked={form.frozen} onCheckedChange={(v) => set('frozen', !!v)} />
                <Label>Frozen</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox checked={form.verified} onCheckedChange={(v) => set('verified', !!v)} />
                <Label>Verified</Label>
              </div>
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
                <Label>Agreement</Label>
              </div>
            </div>

            {/* Contact */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Email</Label>
                <EmailInput value={form.email} onValueChange={(v) => set('email', v)} />
              </div>
              <div>
                <Label>Home Phone</Label>
                <PhoneInput value={form.homePhone} onValueChange={(v) => set('homePhone', v)} />
              </div>
              <div>
                <Label>Work Phone</Label>
                <PhoneInput value={form.workPhone} onValueChange={(v) => set('workPhone', v)} />
              </div>
              <div>
                <Label>Cell Phone</Label>
                <PhoneInput value={form.cellPhone} onValueChange={(v) => set('cellPhone', v)} />
              </div>
              <div>
                <Label>Fax</Label>
                <PhoneInput value={form.fax} onValueChange={(v) => set('fax', v)} />
              </div>
              <div className="col-span-2">
                <Label className="mb-2 block">Preferred Phone</Label>
                <RadioGroup value={form.preferredPhone} onValueChange={(v) => set('preferredPhone', v)} className="flex gap-6">
                  <div className="flex items-center gap-1.5"><RadioGroupItem value="Home" id="lm-pref-home" /><Label htmlFor="lm-pref-home" className="font-normal">Home</Label></div>
                  <div className="flex items-center gap-1.5"><RadioGroupItem value="Work" id="lm-pref-work" /><Label htmlFor="lm-pref-work" className="font-normal">Work</Label></div>
                  <div className="flex items-center gap-1.5"><RadioGroupItem value="Cell" id="lm-pref-cell" /><Label htmlFor="lm-pref-cell" className="font-normal">Cell</Label></div>
                  <div className="flex items-center gap-1.5"><RadioGroupItem value="Fax" id="lm-pref-fax" /><Label htmlFor="lm-pref-fax" className="font-normal">Fax</Label></div>
                </RadioGroup>
              </div>
            </div>

            {/* Address */}
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
                  <Input value={form.state} onChange={(e) => set('state', e.target.value)} />
                </div>
                <div>
                  <Label>ZIP</Label>
                  <Input value={form.zip} onChange={(e) => set('zip', e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!hasAtLeastOneFieldFilled(form as any, ['preferredPhone', 'type']) || !hasValidContactEmails(form as any)}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="z-[9999]">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Create Lender</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to create this new lender contact? Please verify the entered data is correct.
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
