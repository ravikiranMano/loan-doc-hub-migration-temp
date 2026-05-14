import React, { useState, useEffect } from 'react';
import { User } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { ModalSaveConfirmation } from './ModalSaveConfirmation';
import { hasModalFormData, hasValidEmails } from '@/lib/modalFormValidation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import { EmailInput } from '@/components/ui/email-input';
import { ZipInput } from '@/components/ui/zip-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { BorrowerData } from './BorrowersTableView';

interface BorrowerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  borrower?: BorrowerData | null;
  onSave: (borrower: BorrowerData) => void;
  isEdit?: boolean;
}

const BORROWER_TYPE_OPTIONS = [
  'Individual', 'Joint', 'Family Trust', 'LLC', 'C Corp / S Corp',
  'IRA / ERISA', 'Investment Fund', '401K', 'Foreign Holder W-8', 'Non-profit',
];

const CAPACITY_OPTIONS = [
  'Borrower', 'Co-borrower', 'Trustee', 'Co-Trustee', 'Managing Member', 'Authorized Signer', 'Additional Guarantor',
];

const TAX_ID_TYPE_OPTIONS = ['0 – Unknown', '1 – EIN', '2 – SSN'];

const FORD_DROPDOWN_OPTIONS = [
  { value: 'Spouse, Kids, Grandkids', label: 'Spouse, Kids, Grandkids' },
  { value: 'Big Dream', label: 'Big Dream' },
  { value: 'Sports Teams', label: 'Sports Teams' },
  { value: 'Hobbies / Collections', label: 'Hobbies / Collections' },
  { value: 'Goals / Achievements', label: 'Goals / Achievements' },
  { value: 'Favorite Restaurant, Food, Drinks', label: 'Favorite Restaurant, Food, Drinks' },
  { value: 'Pet(s)', label: 'Pet(s)' },
  { value: 'Vacation Spot', label: 'Vacation Spot' },
  { value: 'Job / Occupation', label: 'Job / Occupation' },
  { value: 'Music / Bands', label: 'Music / Bands' },
  { value: 'College', label: 'College' },
  { value: 'Hometown / Childhood', label: 'Hometown / Childhood' },
  { value: 'TV / Movies / Books', label: 'TV / Movies / Books' },
  { value: 'Anniversary', label: 'Anniversary' },
  { value: 'Challenges / Frustrations', label: 'Challenges / Frustrations' },
  { value: 'Charity / Personal Causes', label: 'Charity / Personal Causes' },
  { value: 'Upcoming Event - What / When', label: 'Upcoming Event - What / When' },
  { value: 'Celebration - What / When', label: 'Celebration - What / When' },
];

import { STATE_OPTIONS } from '@/lib/usStates';

const generateBorrowerId = () => `borrower_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const getEmptyBorrower = (): BorrowerData => ({
  id: generateBorrowerId(), isPrimary: false, borrowerType: '', fullName: '',
  firstName: '', middleName: '', lastName: '', email: '', phone: '',
  street: '', city: '', state: '', zipCode: '',
  creditScore: '', capacity: '',
  homePhone: '', workPhone: '', mobilePhone: '', fax: '',
  preferredHome: false, preferredWork: false, preferredCell: false, preferredFax: false,
  primaryStreet: '', primaryCity: '', primaryState: '', primaryZip: '',
  mailingStreet: '', mailingCity: '', mailingState: '', mailingZip: '', mailingSameAsPrimary: false,
  vesting: '', ford1: '', ford2: '', ford3: '', ford4: '', ford5: '', ford6: '', ford7: '', ford8: '',
  issue1098: false, alternateReporting: false,
  deliveryOnline: false, deliveryMail: false,
  borrowerId: '',
  taxIdType: '', tin: '', tinVerified: false,
  deliveryPrint: false, deliveryEmail: false, deliverySms: false,
  sendPaymentNotification: false, sendLateNotice: false, sendBorrowerStatement: false, sendMaturityNotice: false,
});

export const BorrowerModal: React.FC<BorrowerModalProps> = ({
  open, onOpenChange, borrower, onSave, isEdit = false,
}) => {
  const [formData, setFormData] = useState<BorrowerData>(getEmptyBorrower());
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (open) {
      setFormData(borrower ? { ...getEmptyBorrower(), ...borrower } : getEmptyBorrower());
    }
  }, [open, borrower]);

  const handleFieldChange = (field: keyof BorrowerData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const isFormFilled = hasModalFormData(formData, ['id', 'borrowerType'], { mailingSameAsPrimary: false, isPrimary: false, issue1098: false, alternateReporting: false, deliveryOnline: false, deliveryMail: false, preferredHome: false, preferredWork: false, preferredCell: false, preferredFax: false, tinVerified: false, deliveryPrint: false, deliveryEmail: false, deliverySms: false, sendPaymentNotification: false, sendLateNotice: false, sendBorrowerStatement: false, sendMaturityNotice: false });
  const emailsValid = hasValidEmails(formData as any, ['email']);

  const handleSaveClick = () => setShowConfirm(true);
  const handleConfirmSave = () => {
    setShowConfirm(false);
    const primaryPhone = formData.mobilePhone || formData.homePhone || formData.workPhone || formData.phone || '';
    onSave({ ...formData, phone: primaryPhone });
    onOpenChange(false);
  };

  const renderInlineField = (field: keyof BorrowerData, label: string, props: Record<string, any> = {}) => (
    <div className="flex items-center gap-2">
      <Label className="w-[140px] shrink-0 text-xs">{label}</Label>
      <Input value={String(formData[field] || '')} onChange={(e) => handleFieldChange(field, e.target.value)} className="h-7 text-xs flex-1" {...props} />
    </div>
  );

  const renderInlineSelect = (field: keyof BorrowerData, label: string, options: string[], placeholder: string) => (
    <div className="flex items-center gap-2">
      <Label className="w-[140px] shrink-0 text-xs">{label}</Label>
      <Select value={String(formData[field] || '')} onValueChange={(value) => handleFieldChange(field, value)}>
        <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>{options.map(opt => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}</SelectContent>
      </Select>
    </div>
  );

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <User className="h-4 w-4 text-primary" />
            {isEdit ? 'Edit Borrower' : 'Add New Borrower'}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-140px)] pr-4">
          {/* Top section - 4 column grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-0 py-2">
            {/* Column 1 - Name + Tax ID */}
            <div className="space-y-1">
              <div className="font-semibold text-xs text-foreground pb-1 mb-1.5">Name</div>
              {renderInlineField('borrowerId', 'Borrower ID')}
              <div className="flex items-center gap-2">
                <Label className="w-[140px] shrink-0 text-xs">Borrower Type</Label>
                <SearchableSelect
                  value={String(formData.borrowerType || '')}
                  onValueChange={(v) => handleFieldChange('borrowerType', v)}
                  options={BORROWER_TYPE_OPTIONS}
                  searchPlaceholder="Search borrower type..."
                />
              </div>
              <div>
                {renderInlineField('fullName', 'Full Name')}
                <p className="text-[10px] text-muted-foreground pl-[148px] leading-tight">If Entity, Use Entity</p>
              </div>
              <div>
                {renderInlineField('firstName', 'First')}
                <p className="text-[10px] text-muted-foreground pl-[148px] leading-tight">If Entity, Use Signer</p>
              </div>
              {renderInlineField('middleName', 'Middle')}
              {renderInlineField('lastName', 'Last')}
              <div className="flex items-center gap-2">
                <Label className="w-[140px] shrink-0 text-xs">Capacity</Label>
                <SearchableSelect
                  value={String(formData.capacity || '')}
                  onValueChange={(v) => handleFieldChange('capacity', v)}
                  options={CAPACITY_OPTIONS}
                  searchPlaceholder="Search capacity..."
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-[140px] shrink-0 text-xs">Email</Label>
                <EmailInput value={String(formData.email || '')} onValueChange={(v) => handleFieldChange('email', v)} className="h-7 text-xs" />
              </div>
              <div className="h-1" />
              {renderInlineField('creditScore', 'Credit Score')}
              {renderInlineSelect('taxIdType', 'Tax ID Type', TAX_ID_TYPE_OPTIONS, 'Select')}
              {renderInlineField('tin', 'TIN')}
              <div className="flex items-center gap-2 h-7">
                <Checkbox id="modal-borrower-tinVerified" checked={!!formData.tinVerified} onCheckedChange={(checked) => handleFieldChange('tinVerified', !!checked)} className="h-3 w-3" />
                <Label htmlFor="modal-borrower-tinVerified" className="font-normal text-xs">TIN Verified</Label>
              </div>
            </div>

            {/* Column 2 - Primary & Mailing Address */}
            <div className="space-y-1">
              <div className="font-semibold text-xs text-foreground pb-1 mb-1.5">Primary Address</div>
              {renderInlineField('primaryStreet', 'Street')}
              {renderInlineField('primaryCity', 'City')}
              {renderInlineSelect('primaryState', 'State', STATE_OPTIONS, 'State')}
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">ZIP</Label>
                <ZipInput value={String(formData.primaryZip || '')} onValueChange={(v) => handleFieldChange('primaryZip', v)} className="h-7 text-xs" />
              </div>

              <div className="font-semibold text-xs text-foreground pb-1 mt-2 mb-1.5 flex items-center gap-2">
                Mailing Address
                <div className="flex items-center gap-1.5 ml-auto">
                  <Checkbox id="modal-borrower-mailingSame" checked={formData.mailingSameAsPrimary} onCheckedChange={(checked) => {
                    const isChecked = !!checked;
                    setFormData(prev => ({
                      ...prev,
                      mailingSameAsPrimary: isChecked,
                      mailingStreet: isChecked ? (prev.primaryStreet || '') : '',
                      mailingCity: isChecked ? (prev.primaryCity || '') : '',
                      mailingState: isChecked ? (prev.primaryState || '') : '',
                      mailingZip: isChecked ? (prev.primaryZip || '') : '',
                    }));
                  }} className="h-3 w-3" />
                  <Label htmlFor="modal-borrower-mailingSame" className="font-normal text-[10px]">Same as Primary</Label>
                </div>
              </div>
              {renderInlineField('mailingStreet', 'Street', { disabled: formData.mailingSameAsPrimary })}
              {renderInlineField('mailingCity', 'City', { disabled: formData.mailingSameAsPrimary })}
              {renderInlineSelect('mailingState', 'State', STATE_OPTIONS, 'State')}
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">ZIP</Label>
                <ZipInput value={String(formData.mailingZip || '')} onValueChange={(v) => handleFieldChange('mailingZip', v)} disabled={formData.mailingSameAsPrimary} className="h-7 text-xs" />
              </div>

              {/* Delivery Options & Send - stacked layout */}
              <div className="pt-2 space-y-2">
                <div className="space-y-1">
                  <div className="font-semibold text-xs text-foreground">Delivery Options</div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <Checkbox id="modal-borrower-deliveryPrint" checked={!!formData.deliveryPrint} onCheckedChange={(checked) => handleFieldChange('deliveryPrint', !!checked)} className="h-3 w-3" />
                      <Label htmlFor="modal-borrower-deliveryPrint" className="font-normal text-xs">Print</Label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Checkbox id="modal-borrower-deliveryEmail" checked={!!formData.deliveryEmail} onCheckedChange={(checked) => handleFieldChange('deliveryEmail', !!checked)} className="h-3 w-3" />
                      <Label htmlFor="modal-borrower-deliveryEmail" className="font-normal text-xs">Email</Label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Checkbox id="modal-borrower-deliverySms" checked={!!formData.deliverySms} onCheckedChange={(checked) => handleFieldChange('deliverySms', !!checked)} className="h-3 w-3" />
                      <Label htmlFor="modal-borrower-deliverySms" className="font-normal text-xs">SMS</Label>
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="font-semibold text-xs text-foreground">Send</div>
                  <div className="flex items-center gap-2 h-6">
                    <Checkbox id="modal-borrower-sendPayment" checked={!!formData.sendPaymentNotification} onCheckedChange={(checked) => handleFieldChange('sendPaymentNotification', !!checked)} className="h-3 w-3" />
                    <Label htmlFor="modal-borrower-sendPayment" className="font-normal text-xs">Payment Notification</Label>
                  </div>
                  <div className="flex items-center gap-2 h-6">
                    <Checkbox id="modal-borrower-sendLate" checked={!!formData.sendLateNotice} onCheckedChange={(checked) => handleFieldChange('sendLateNotice', !!checked)} className="h-3 w-3" />
                    <Label htmlFor="modal-borrower-sendLate" className="font-normal text-xs">Late Notice</Label>
                  </div>
                  <div className="flex items-center gap-2 h-6">
                    <Checkbox id="modal-borrower-sendStatement" checked={!!formData.sendBorrowerStatement} onCheckedChange={(checked) => handleFieldChange('sendBorrowerStatement', !!checked)} className="h-3 w-3" />
                    <Label htmlFor="modal-borrower-sendStatement" className="font-normal text-xs">Borrower Statement</Label>
                  </div>
                  <div className="flex items-center gap-2 h-6">
                    <Checkbox id="modal-borrower-sendMaturity" checked={!!formData.sendMaturityNotice} onCheckedChange={(checked) => handleFieldChange('sendMaturityNotice', !!checked)} className="h-3 w-3" />
                    <Label htmlFor="modal-borrower-sendMaturity" className="font-normal text-xs">Maturity Notice</Label>
                  </div>
                </div>
              </div>
            </div>

            {/* Column 3 - Phone + Preferred */}
            <div className="space-y-1">
              <div className="font-semibold text-xs text-foreground pb-1 mb-1.5">Phone</div>
              {(['homePhone', 'workPhone', 'mobilePhone', 'fax'] as const).map((phoneKey, idx) => {
                const prefKey = (['preferredHome', 'preferredWork', 'preferredCell', 'preferredFax'] as const)[idx];
                const phoneLabel = ['Home', 'Work', 'Cell', 'Fax'][idx];
                return (
                  <div key={phoneKey} className="flex items-center gap-2">
                    <Label className="w-[50px] shrink-0 text-xs">{phoneLabel}</Label>
                    <PhoneInput value={String(formData[phoneKey] || '')} onValueChange={(val) => handleFieldChange(phoneKey, val)} className="h-7 text-xs flex-1" />
                    <Checkbox id={`modal-borrower-${prefKey}`} checked={!!formData[prefKey]} onCheckedChange={(checked) => handleFieldChange(prefKey, !!checked)} className="h-3 w-3 shrink-0" />
                  </div>
                );
              })}
            </div>

            {/* Column 4 - Vesting & FORD */}
            <div className="space-y-1">
              <div className="font-semibold text-xs text-foreground pb-1 mb-1.5">Vesting</div>
              <Textarea value={String(formData.vesting || '')} onChange={(e) => handleFieldChange('vesting', e.target.value)} className="text-xs w-full min-h-[80px] resize-none" />

              <div className="font-semibold text-xs text-foreground pb-1 mt-2 mb-1.5">FORD</div>
              <div className="space-y-1">
                {([['ford1', 'ford2'], ['ford3', 'ford4'], ['ford5', 'ford6'], ['ford7', 'ford8']] as const).map(([dropdownKey, inputKey], idx) => (
                  <div key={idx} className="grid grid-cols-2 gap-1">
                    <SearchableSelect
                      value={String(formData[dropdownKey] || '')}
                      onValueChange={(v) => handleFieldChange(dropdownKey, v)}
                      options={FORD_DROPDOWN_OPTIONS.map(o => o.value)}
                      searchPlaceholder="Search FORD..."
                    />
                    <Input value={String(formData[inputKey] || '')} onChange={(e) => handleFieldChange(inputKey, e.target.value)} className="h-7 text-xs" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom section - Reporting + Primary */}
          <div className="mt-2 pt-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-0">
              <div className="space-y-1">
                <div className="flex items-center gap-2 h-7">
                  <Checkbox id="modal-borrower-issue1098" checked={formData.issue1098} onCheckedChange={(checked) => handleFieldChange('issue1098', !!checked)} className="h-3 w-3" />
                  <Label htmlFor="modal-borrower-issue1098" className="font-normal text-xs">Issue 1098</Label>
                </div>
                <div className="flex items-center gap-2 h-7">
                  <Checkbox id="modal-borrower-altReporting" checked={formData.alternateReporting} onCheckedChange={(checked) => handleFieldChange('alternateReporting', !!checked)} className="h-3 w-3" />
                  <Label htmlFor="modal-borrower-altReporting" className="font-normal text-xs">Alternate Reporting</Label>
                </div>
              </div>

              <div />

              <div className="space-y-1">
                <div className="flex items-center gap-2 pt-4">
                  <Checkbox id="modal-borrower-isPrimary" checked={formData.isPrimary} onCheckedChange={(checked) => handleFieldChange('isPrimary', !!checked)} className="h-3.5 w-3.5" />
                  <Label htmlFor="modal-borrower-isPrimary" className="text-xs font-medium">Primary Borrower</Label>
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="mt-4 shrink-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSaveClick} disabled={!isFormFilled || !emailsValid}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ModalSaveConfirmation open={showConfirm} onConfirm={handleConfirmSave} onCancel={() => setShowConfirm(false)} />
    </>
  );
};

export default BorrowerModal;
