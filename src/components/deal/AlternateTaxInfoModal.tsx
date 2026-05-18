import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ZipInput } from '@/components/ui/zip-input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface AlternateTaxInfoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  values: {
    ssn: string;
    name: string;
    street: string;
    city: string;
    state: string;
    zip: string;
    account: string;
    recipientType: string;
    autoSync: boolean;
  };
  onSave: (data: {
    ssn: string;
    name: string;
    street: string;
    city: string;
    state: string;
    zip: string;
    account: string;
    recipientType: string;
    autoSync: boolean;
  }) => void;
}

import { STATE_OPTIONS } from '@/lib/usStates';

const RECIPIENT_TYPE_OPTIONS = [
  { value: '2-SSN', label: '2-SSN' },
  { value: '1-EIN', label: '1-EIN' },
];

export const AlternateTaxInfoModal: React.FC<AlternateTaxInfoModalProps> = ({
  open,
  onOpenChange,
  values,
  onSave,
}) => {
  const [formData, setFormData] = useState({
    ssn: '',
    name: '',
    street: '',
    city: '',
    state: '',
    zip: '',
    account: '',
    recipientType: '2-SSN',
    autoSync: false,
  });

  useEffect(() => {
    if (open) {
      setFormData({
        ssn: values.ssn || '',
        name: values.name || '',
        street: values.street || '',
        city: values.city || '',
        state: values.state || '',
        zip: values.zip || '',
        account: values.account || '',
        recipientType: values.recipientType || '2-SSN',
        autoSync: values.autoSync || false,
      });
    }
  }, [open, values]);

  const handleChange = (field: keyof typeof formData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave(formData);
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Tax Payer 1098</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* SSN */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">
              TAX PAYER'S social security number
            </Label>
            <Input
              value={formData.ssn}
              onChange={(e) => handleChange('ssn', e.target.value)}
              className="h-9"
            />
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">
              TAX PAYER'S name
            </Label>
            <Input
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              className="h-9"
            />
          </div>

          {/* Street Address */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">
              Street address (including apt no.)
            </Label>
            <Input
              value={formData.street}
              onChange={(e) => handleChange('street', e.target.value)}
              className="h-9"
            />
          </div>

          {/* City, State, Zip */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">City</Label>
              <Input
                value={formData.city}
                onChange={(e) => handleChange('city', e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">State</Label>
              <Select
                value={formData.state}
                onValueChange={(value) => handleChange('state', value)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {STATE_OPTIONS.map((state) => (
                    <SelectItem key={state} value={state}>
                      {state}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Zip Code</Label>
              <ZipInput
                value={formData.zip}
                onValueChange={(v) => handleChange('zip', v)}
                className="h-9"
              />
            </div>
          </div>

          {/* Account Number and Recipient Type */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">
                Account number (optional)
              </Label>
              <Input
                value={formData.account}
                onChange={(e) => handleChange('account', e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">
                Recipient Type
              </Label>
              <Select
                value={formData.recipientType}
                onValueChange={(value) => handleChange('recipientType', value)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {RECIPIENT_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Auto-Synchronize */}
          <div className="flex items-center gap-2 pt-2">
            <Checkbox
              id="autoSync"
              checked={formData.autoSync}
              onCheckedChange={(checked) => handleChange('autoSync', !!checked)}
            />
            <Label htmlFor="autoSync" className="text-sm text-foreground">
              Auto-Synchronize
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="default" onClick={handleSave}>
            OK
          </Button>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AlternateTaxInfoModal;
