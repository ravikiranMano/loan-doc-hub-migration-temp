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
import { hasAtLeastOneFieldFilled, validatePhoneFields, hasValidContactEmails } from '@/lib/contactFormValidation';
import { toast } from 'sonner';
import type { ContactBroker } from '@/pages/contacts/ContactBrokersPage';

type CreatePayload = Omit<ContactBroker, 'id' | 'brokerId'>;

const EMPTY: CreatePayload = {
  hold: false, type: 'Individual', ach: false, email: '', agreement: false, agreementDate: '',
  firstName: '', lastName: '', city: '', state: '', cellPhone: '',
  homePhone: '', workPhone: '', fax: '', preferredPhone: 'Cell', verified: false,
  send1099: false, street: '', zip: '',
  mailingStreet: '', mailingCity: '', mailingState: '', mailingZip: '', sameAsPrimary: false,
  company: '', license: '', brokersRepresentative: '',
  repPhone: '', repEmail: '', repLicense: '',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreatePayload) => void;
}

export const ContactBrokerModal: React.FC<Props> = ({ open, onOpenChange, onSubmit }) => {
  const [form, setForm] = useState<CreatePayload>({ ...EMPTY });
  const [confirmOpen, setConfirmOpen] = useState(false);

  const set = (field: keyof CreatePayload, value: string | boolean) =>
    setForm((p) => ({ ...p, [field]: value }));

  const handleSubmit = () => {
    if (!hasAtLeastOneFieldFilled(form as any, ['preferredPhone', 'type'])) {
      toast.error('Please fill at least one field before saving');
      return;
    }
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
    onSubmit(form);
    setForm({ ...EMPTY });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Contact Broker</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>First Name</Label>
                <Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
              </div>
              <div>
                <Label>Last Name</Label>
                <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
              </div>
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
            <div>
              <Label>Email</Label>
              <EmailInput value={form.email} onValueChange={(v) => set('email', v)} />
            </div>
            <div>
              <Label>Cell Phone</Label>
              <PhoneInput value={form.cellPhone} onValueChange={(v) => set('cellPhone', v)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>City</Label>
                <Input value={form.city} onChange={(e) => set('city', e.target.value)} />
              </div>
              <div>
                <Label>State</Label>
                <Input value={form.state} onChange={(e) => set('state', e.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.hold} onCheckedChange={(v) => set('hold', !!v)} /> Hold
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.agreement} onCheckedChange={(v) => set('agreement', !!v)} /> Agreement
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.verified} onCheckedChange={(v) => set('verified', !!v)} /> Verified
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.send1099} onCheckedChange={(v) => set('send1099', !!v)} /> 1099
              </label>
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
            <AlertDialogTitle>Confirm Create Broker</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to create this new broker contact? Please verify the entered data is correct.
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
