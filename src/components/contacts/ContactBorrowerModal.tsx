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
import { US_STATES } from '@/lib/usStates';
import { PhoneInput } from '@/components/ui/phone-input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { hasAtLeastOneFieldFilled, validatePhoneFields, hasValidContactEmails } from '@/lib/contactFormValidation';
import { toast } from 'sonner';
import type { ContactBorrower } from '@/pages/contacts/ContactBorrowersPage';

interface ContactBorrowerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: Omit<ContactBorrower, 'id' | 'borrowerId'>) => void;
}

const EMPTY: Omit<ContactBorrower, 'id' | 'borrowerId'> = {
  hold: false, type: 'Individual', ach: false, email: '', agreement: false,
  fullName: '', firstName: '', lastName: '', city: '', state: '', cellPhone: '',
  homePhone: '', workPhone: '', fax: '', preferredPhone: 'cell', verified: false,
  send1099: false, tin: '', street: '', zip: '',
  mailingStreet: '', mailingCity: '', mailingState: '', mailingZip: '', sameAsPrimary: false,
};

export const ContactBorrowerModal: React.FC<ContactBorrowerModalProps> = ({ open, onOpenChange, onSubmit }) => {
  const [form, setForm] = useState(EMPTY);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const set = (field: string, value: any) => setForm((p) => {
    const updated = { ...p, [field]: value };
    if (field === 'firstName' || field === 'lastName') {
      const fn = field === 'firstName' ? value : p.firstName;
      const ln = field === 'lastName' ? value : p.lastName;
      updated.fullName = `${fn} ${ln}`.trim();
    }
    return updated;
  });

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
    setForm(EMPTY);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create New Borrower</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>First Name</Label><Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} /></div>
              <div><Label>Last Name</Label><Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} /></div>
            </div>
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
            <div><Label>Email</Label><EmailInput value={form.email} onValueChange={(v) => set('email', v)} /></div>
            <div className="grid grid-cols-2 gap-3">
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
            </div>
            <div>
              <Label className="mb-2 block">Preferred Phone</Label>
              <RadioGroup value={form.preferredPhone} onValueChange={(v) => set('preferredPhone', v)} className="flex gap-4">
                <div className="flex items-center gap-1.5"><RadioGroupItem value="home" id="bm-pref-home" /><Label htmlFor="bm-pref-home" className="font-normal">Home</Label></div>
                <div className="flex items-center gap-1.5"><RadioGroupItem value="work" id="bm-pref-work" /><Label htmlFor="bm-pref-work" className="font-normal">Work</Label></div>
                <div className="flex items-center gap-1.5"><RadioGroupItem value="cell" id="bm-pref-cell" /><Label htmlFor="bm-pref-cell" className="font-normal">Cell</Label></div>
                <div className="flex items-center gap-1.5"><RadioGroupItem value="fax" id="bm-pref-fax" /><Label htmlFor="bm-pref-fax" className="font-normal">Fax</Label></div>
              </RadioGroup>
            </div>
            <div><Label>City</Label><Input value={form.city} onChange={(e) => set('city', e.target.value)} /></div>
            <div><Label>State</Label><Input value={form.state} onChange={(e) => set('state', e.target.value)} /></div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2"><Checkbox checked={form.hold} onCheckedChange={(v) => set('hold', !!v)} /><Label>Hold</Label></div>
              <div className="flex items-center gap-2"><Checkbox checked={form.ach} onCheckedChange={(v) => set('ach', !!v)} /><Label>ACH</Label></div>
              <div className="flex items-center gap-2"><Checkbox checked={form.verified} onCheckedChange={(v) => set('verified', !!v)} /><Label>Verified</Label></div>
              <div className="flex items-center gap-2"><Checkbox checked={form.agreement} onCheckedChange={(v) => set('agreement', !!v)} /><Label>Agreement</Label></div>
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
            <AlertDialogTitle>Confirm Create Borrower</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to create this new borrower contact? Please verify the entered data is correct.
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
