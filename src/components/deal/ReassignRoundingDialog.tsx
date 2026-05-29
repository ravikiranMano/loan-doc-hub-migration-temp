import React from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { AlertTriangle } from 'lucide-react';
import type { FundingRecord } from './LoanFundingGrid';

interface ReassignRoundingDialogProps {
  state: {
    record: FundingRecord;
    candidates: FundingRecord[];
    selectedId: string;
  } | null;
  onSelectionChange: (id: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Shown when the user attempts to delete the lender currently designated as
 * the rounding-adjustment recipient. Forces the user to pick a replacement
 * before the delete is committed so the leftover penny/remainder is always
 * assigned to exactly one surviving lender.
 *
 * Adding a new lender NEVER opens this dialog — only delete does, and only
 * when more than one lender remains after the deletion (otherwise the flag
 * is auto-transferred to the sole survivor by the caller).
 */
export const ReassignRoundingDialog: React.FC<ReassignRoundingDialogProps> = ({
  state,
  onSelectionChange,
  onConfirm,
  onCancel,
}) => {
  const open = !!state;
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent className="z-[9999] max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden="true" />
            Reassign Rounding Lender
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">
              <strong>{state?.record?.lenderName || 'This lender'}</strong> is
              currently set to receive the rounding adjustment for payment
              splits. Choose another lender to take over before deleting.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-2">
          <Label className="text-xs font-medium">New Rounding Lender</Label>
          <Select
            value={state?.selectedId || ''}
            onValueChange={onSelectionChange}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select a lender..." />
            </SelectTrigger>
            <SelectContent className="z-[10000]">
              {(state?.candidates || []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.lenderName || '(unnamed lender)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <AlertDialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button
            onClick={onConfirm}
            disabled={!state?.selectedId}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Reassign &amp; Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ReassignRoundingDialog;
