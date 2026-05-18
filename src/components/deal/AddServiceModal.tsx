import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  numericKeyDown,
  numericPaste,
} from '@/lib/numericInputFilter';

export interface AddServiceFormData {
  label: string;
  cost: string;
  lender_percent: string;
  lenders_split: string;
  borrower_amount: string;
  borrower_percent: string;
  broker: string;
}

interface AddServiceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: AddServiceFormData) => void;
  existingNames?: string[];
}

const INITIAL: AddServiceFormData = {
  label: '',
  cost: '',
  lender_percent: '',
  lenders_split: '',
  borrower_amount: '',
  borrower_percent: '',
  broker: '',
};

export const AddServiceModal: React.FC<AddServiceModalProps> = ({
  open,
  onOpenChange,
  onSave,
  existingNames = [],
}) => {
  const [form, setForm] = useState<AddServiceFormData>({ ...INITIAL });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (key: keyof AddServiceFormData, val: string) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.label.trim()) errs.label = 'Service Name is required';
    else if (existingNames.some((n) => n.toLowerCase() === form.label.trim().toLowerCase())) {
      errs.label = 'A service with this name already exists';
    }

    const numericFields: (keyof AddServiceFormData)[] = ['cost', 'lender_percent', 'borrower_amount', 'borrower_percent'];
    numericFields.forEach((f) => {
      const raw = form[f].replace(/,/g, '');
      if (raw && isNaN(Number(raw))) errs[f] = 'Must be a valid number';
    });

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    onSave(form);
    toast.success(`Service "${form.label.trim()}" added successfully`);
    setForm({ ...INITIAL });
    setErrors({});
    onOpenChange(false);
  };

  const handleCancel = () => {
    setForm({ ...INITIAL });
    setErrors({});
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Service</DialogTitle>
          <DialogDescription>Enter the details for the new service row.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Service Name */}
          <div className="space-y-1">
            <Label className="text-sm font-medium">
              Service Name <span className="text-destructive">*</span>
            </Label>
            <Input
              value={form.label}
              onChange={(e) => set('label', e.target.value)}
              placeholder="Enter service name"
              className="h-9 text-sm"
            />
            {errors.label && <p className="text-xs text-destructive">{errors.label}</p>}
          </div>

          {/* Cost */}
          <div className="space-y-1">
            <Label className="text-sm font-medium">Cost</Label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
              <Input
                value={form.cost}
                onChange={(e) => set('cost', e.target.value)}
                onKeyDown={numericKeyDown}
                onPaste={(e) => numericPaste(e, (v) => set('cost', v))}
                inputMode="decimal"
                placeholder="0.00"
                className="h-9 text-sm pl-5 text-right"
              />
            </div>
            {errors.cost && <p className="text-xs text-destructive">{errors.cost}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Lender % */}
            <div className="space-y-1">
              <Label className="text-sm font-medium">Lender %</Label>
              <div className="relative">
                <Input
                  value={form.lender_percent}
                  onChange={(e) => set('lender_percent', e.target.value)}
                  onKeyDown={numericKeyDown}
                  onPaste={(e) => numericPaste(e, (v) => set('lender_percent', v))}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="h-9 text-sm text-right pr-6"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
              </div>
              {errors.lender_percent && <p className="text-xs text-destructive">{errors.lender_percent}</p>}
            </div>

            {/* Lender Split */}
            <div className="space-y-1">
              <Label className="text-sm font-medium">Lender Split</Label>
              <Select value={form.lenders_split} onValueChange={(val) => set('lenders_split', val)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fee_per_lender">Fee Per Lender - No Split</SelectItem>
                  <SelectItem value="pro_rata">Pro Rata</SelectItem>
                  <SelectItem value="split_50_50">Split 50/50</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Borrower $ */}
            <div className="space-y-1">
              <Label className="text-sm font-medium">Borrower $</Label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
                <Input
                  value={form.borrower_amount}
                  onChange={(e) => set('borrower_amount', e.target.value)}
                  onKeyDown={numericKeyDown}
                  onPaste={(e) => numericPaste(e, (v) => set('borrower_amount', v))}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="h-9 text-sm pl-5 text-right"
                />
              </div>
              {errors.borrower_amount && <p className="text-xs text-destructive">{errors.borrower_amount}</p>}
            </div>

            {/* Borrower % */}
            <div className="space-y-1">
              <Label className="text-sm font-medium">Borrower %</Label>
              <div className="relative">
                <Input
                  value={form.borrower_percent}
                  onChange={(e) => set('borrower_percent', e.target.value)}
                  onKeyDown={numericKeyDown}
                  onPaste={(e) => numericPaste(e, (v) => set('borrower_percent', v))}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="h-9 text-sm text-right pr-6"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
              </div>
              {errors.borrower_percent && <p className="text-xs text-destructive">{errors.borrower_percent}</p>}
            </div>
          </div>

          {/* Broker */}
          <div className="space-y-1">
            <Label className="text-sm font-medium">Broker</Label>
            <Input
              value={form.broker}
              onChange={(e) => set('broker', e.target.value)}
              placeholder="Enter broker value"
              className="h-9 text-sm"
            />
          </div>
        </div>

        <DialogFooter className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleCancel}>Cancel</Button>
          <Button size="sm" onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddServiceModal;
