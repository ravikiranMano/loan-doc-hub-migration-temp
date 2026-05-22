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
import { AlertTriangle, Loader2 } from 'lucide-react';

interface OverrideConfirmationDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  title?: string;
  message?: string;
  warningText?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * Custom in-app confirmation dialog used in place of window.confirm() when
 * toggling override flags on financial records. Matches the application
 * theme, traps focus, closes on ESC, and prevents duplicate stacking via
 * the controlled `open` prop.
 */
export const OverrideConfirmationDialog: React.FC<OverrideConfirmationDialogProps> = ({
  open,
  onConfirm,
  onCancel,
  loading = false,
  title = 'Confirm Override',
  message = 'Applying override will recalculate dependent payment values for this funding record.',
  warningText = 'This action may update lender calculations, payment distributions, and accounting values.',
  confirmLabel = 'Confirm Override',
  cancelLabel = 'Cancel',
}) => {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !loading) onCancel();
      }}
    >
      <AlertDialogContent className="z-[9999] max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden="true" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">{message}</span>
            {warningText && (
              <span className="block rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                {warningText}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={loading}
            autoFocus
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default OverrideConfirmationDialog;
