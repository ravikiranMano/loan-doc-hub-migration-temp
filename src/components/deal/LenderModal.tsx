import React, { useState, useEffect } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { LenderData } from './LendersTableView';

const LENDER_TYPE_OPTIONS = [
  { value: 'Individual', label: 'Individual' },
  { value: 'Joint', label: 'Joint' },
  { value: 'Family Trust', label: 'Family Trust' },
  { value: 'LLC', label: 'LLC' },
  { value: 'C Corp / S Corp', label: 'C Corp / S Corp' },
  { value: 'IRA / ERISA', label: 'IRA / ERISA' },
  { value: 'Investment Fund', label: 'Investment Fund' },
  { value: '401k', label: '401k' },
  { value: 'Foreign Holder W-8', label: 'Foreign Holder W-8' },
  { value: 'Non-profit', label: 'Non-profit' },
];

const TAX_ID_TYPE_OPTIONS = [
  { value: '0', label: '0 - Unknown' },
  { value: '1', label: '1 - EIN' },
  { value: '2', label: '2 - SSN' },
];

interface LenderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lender: LenderData | null;
  onSave: (lenderData: LenderData) => void;
  isEdit?: boolean;
}

const getDefaultLenderData = (): LenderData => ({
  id: '', isPrimary: false, type: '', fullName: '', firstName: '', lastName: '',
  email: '', phone: '', street: '', city: '', state: '', zip: '', taxId: '', taxIdType: '',
});

export const LenderModal: React.FC<LenderModalProps> = ({ open, onOpenChange, lender, onSave, isEdit = false }) => {
  const [formData, setFormData] = useState<LenderData>(getDefaultLenderData());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (open) {
      setFormData(lender ? { ...getDefaultLenderData(), ...lender } : getDefaultLenderData());
      setErrors({});
    }
  }, [open, lender]);

  const handleChange = (field: keyof LenderData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const isFormFilled = hasModalFormData(formData, ['id'], { isPrimary: false });
  const emailsValid = hasValidEmails(formData as any, ['email']);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.fullName.trim() && !formData.firstName.trim()) newErrors.fullName = 'Full Name or First Name is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSaveClick = () => setShowConfirm(true);
  const handleConfirmSave = () => { setShowConfirm(false); if (validateForm()) onSave(formData); };

  const renderInlineField = (field: keyof LenderData, label: string, props: Record<string, any> = {}) => (
    <div className="flex items-center gap-2">
      <Label className="w-[100px] shrink-0 text-xs">{label}</Label>
      <Input value={String(formData[field] || '')} onChange={(e) => handleChange(field, e.target.value)} className={`h-7 text-xs flex-1 ${errors[field] ? 'border-destructive' : ''}`} {...props} />
    </div>
  );

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="text-sm">{isEdit ? 'Edit Lender' : 'Add Lender'}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-1.5 py-3">
            <div className="flex items-center gap-2 pb-2">
              <Checkbox id="isPrimary" checked={formData.isPrimary} onCheckedChange={(checked) => handleChange('isPrimary', !!checked)} className="h-3.5 w-3.5" />
              <Label htmlFor="isPrimary" className="text-xs font-medium">Primary Lender</Label>
            </div>

            {/* Lender Type dropdown - full width */}
            <div className="flex items-center gap-2">
              <Label className="w-[100px] shrink-0 text-xs">Lender Type</Label>
              <SearchableSelect
                value={formData.type}
                onValueChange={(value) => handleChange('type', value)}
                options={LENDER_TYPE_OPTIONS.map(o => o.value)}
                placeholder="Select type"
                searchPlaceholder="Search lender type..."
              />
            </div>

            <div>
              {renderInlineField('fullName', 'Full Name *')}
              {errors.fullName && <p className="text-[10px] text-destructive pl-[108px]">{errors.fullName}</p>}
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {renderInlineField('firstName', 'First Name')}
              {renderInlineField('lastName', 'Last Name')}
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">Email</Label>
                <EmailInput value={String(formData.email || '')} onValueChange={(v) => handleChange('email', v)} className={`h-7 text-xs ${errors.email ? 'border-destructive' : ''}`} />
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">Phone</Label>
                <PhoneInput value={String(formData.phone || '')} onValueChange={(v) => handleChange('phone', v)} className="h-7 text-xs flex-1" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {renderInlineField('city', 'City')}
              {renderInlineField('state', 'State')}
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {renderInlineField('street', 'Street')}
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">Zip</Label>
                <ZipInput value={String(formData.zip || '')} onValueChange={(v) => handleChange('zip', v)} className="h-7 text-xs" />
              </div>
            </div>

            {/* Tax ID Type dropdown - same width as Street (half row) */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <div className="flex items-center gap-2">
                <Label className="w-[100px] shrink-0 text-xs">Tax ID</Label>
                <Select
                  value={formData.taxIdType}
                  onValueChange={(value) => handleChange('taxIdType', value)}
                >
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {TAX_ID_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSaveClick} disabled={!isFormFilled || !emailsValid}>{isEdit ? 'Save Changes' : 'Add Lender'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ModalSaveConfirmation open={showConfirm} onConfirm={handleConfirmSave} onCancel={() => setShowConfirm(false)} />
    </>
  );
};

export default LenderModal;
