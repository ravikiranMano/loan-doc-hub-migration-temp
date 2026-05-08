import React, { useState, useEffect } from 'react';
import { Users } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ModalSaveConfirmation } from './ModalSaveConfirmation';
import { hasModalFormData, hasValidEmails } from '@/lib/modalFormValidation';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import { EmailInput } from '@/components/ui/email-input';
import { ZipInput } from '@/components/ui/zip-input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { BrokerData } from './BrokersTableView';

interface BrokerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  broker?: BrokerData | null;
  onSave: (broker: BrokerData) => void;
  isEdit?: boolean;
}

import { US_STATES } from '@/lib/usStates';

const generateBrokerId = () => `broker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const getEmptyBroker = (): BrokerData => ({
  id: generateBrokerId(), brokerId: '', license: '', company: '', firstName: '',
  middleName: '', lastName: '', email: '', street: '', city: '', state: '', zip: '',
  phoneWork: '', phoneCell: '',
});

export const BrokerModal: React.FC<BrokerModalProps> = ({ open, onOpenChange, broker, onSave, isEdit = false }) => {
  const [formData, setFormData] = useState<BrokerData>(getEmptyBroker());
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (open) setFormData(broker ? broker : getEmptyBroker());
  }, [open, broker]);

  const handleFieldChange = (field: keyof BrokerData, value: string) => setFormData(prev => ({ ...prev, [field]: value }));

  const isFormFilled = hasModalFormData(formData, ['id']);
  const emailsValid = hasValidEmails(formData as any, ['email']);

  const handleSaveClick = () => setShowConfirm(true);
  const handleConfirmSave = () => { setShowConfirm(false); onSave(formData); onOpenChange(false); };

  const renderInlineField = (field: keyof BrokerData, label: string, props: Record<string, any> = {}) => (
    <div className="flex items-center gap-2">
      <Label className="w-[100px] shrink-0 text-xs text-foreground">{label}</Label>
      <Input value={formData[field]} onChange={(e) => handleFieldChange(field, e.target.value)} className="h-7 text-xs flex-1" {...props} />
    </div>
  );

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4 text-primary" />
            {isEdit ? 'Edit Broker' : 'Add New Broker'}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-0 mt-3">
          {/* Left Column */}
          <div className="space-y-1.5">
            <div className="border-b border-border pb-1 mb-2"><span className="font-semibold text-xs text-primary">Broker Information</span></div>
            {renderInlineField('brokerId', 'Broker ID *')}
            {renderInlineField('license', 'License')}
            {renderInlineField('company', 'Company')}
            {renderInlineField('firstName', 'First Name')}
            {renderInlineField('middleName', 'Middle Name')}
            {renderInlineField('lastName', 'Last Name')}
            <div className="flex items-center gap-2">
              <Label className="w-[100px] shrink-0 text-xs">Email</Label>
              <EmailInput value={String(formData.email || '')} onValueChange={(v) => handleFieldChange('email', v)} className="h-7 text-xs" />
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-1.5">
            <div className="border-b border-border pb-1 mb-2"><span className="font-semibold text-xs text-primary">Address & Contact</span></div>
            {renderInlineField('street', 'Street')}
            {renderInlineField('city', 'City')}
            <div className="flex items-center gap-2">
              <Label className="w-[100px] shrink-0 text-xs text-foreground">State</Label>
              <Select value={formData.state} onValueChange={(val) => handleFieldChange('state', val)}>
                <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="bg-background border border-border z-50 max-h-60">
                  <SelectItem value="__select__">Select</SelectItem>
                  {US_STATES.map(s => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="w-[100px] shrink-0 text-xs text-foreground">ZIP Code</Label>
              <ZipInput value={formData.zip} onValueChange={(v) => handleFieldChange('zip', v)} className="h-7 text-xs" />
            </div>
            <div className="flex items-center gap-2">
              <Label className="w-[100px] shrink-0 text-xs text-foreground">Work Phone</Label>
              <PhoneInput value={formData.phoneWork} onValueChange={(v) => handleFieldChange('phoneWork', v)} className="h-7 text-xs flex-1" />
            </div>
            <div className="flex items-center gap-2">
              <Label className="w-[100px] shrink-0 text-xs text-foreground">Cell Phone</Label>
              <PhoneInput value={formData.phoneCell} onValueChange={(v) => handleFieldChange('phoneCell', v)} className="h-7 text-xs flex-1" />
            </div>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSaveClick} disabled={!isFormFilled || !emailsValid}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ModalSaveConfirmation open={showConfirm} onConfirm={handleConfirmSave} onCancel={() => setShowConfirm(false)} />
    </>
  );
};

export default BrokerModal;
