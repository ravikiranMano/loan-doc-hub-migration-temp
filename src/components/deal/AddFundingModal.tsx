import React, { useState } from 'react';
import { ModalSaveConfirmation } from './ModalSaveConfirmation';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog';
import { hasModalFormData } from '@/lib/modalFormValidation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Pencil, Trash2, X, SlidersHorizontal, Info } from 'lucide-react';
import { LenderDisbursementModal, type DisbursementFormData } from './LenderDisbursementModal';
import { cn } from '@/lib/utils';
import { LenderIdSearch } from './LenderIdSearch';
import { AccountIdSearch } from './AccountIdSearch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { CalendarIcon } from 'lucide-react';
import { formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/dateOnly';
import { formatCurrencyDisplay, unformatCurrencyDisplay, numericKeyDown, numericPaste } from '@/lib/numericInputFilter';
import { roundPctForStorage, computeAmortizedPayment, Decimal, formatPercentDisplay } from '@/lib/precisionFormat';
import { toast } from 'sonner';

interface AddFundingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loanNumber?: string;
  borrowerName?: string;
  onSubmit: (data: FundingFormData) => void;
  editData?: FundingFormData | null;
  isEditing?: boolean;
  noteRate?: string;
  soldRate?: string;
  totalPayment?: string;
  loanAmount?: string;
  loanPrincipalBalance?: string;
  remainingPayments?: number;
  existingRecords?: Array<{ id: string; roundingError: boolean; pctOwned: number; originalAmount?: number; currentBalance?: number; lenderId?: string; lenderName?: string }>;
  editingRecordId?: string;
}

export interface DisbursementRow {
  active: boolean;
  accountId: string;
  name: string;
  startDate: string;
  endDate: string;
  amount: string;
  percentage: string;
  from: 'Interest' | 'Principal' | 'Payment' | 'NA' | '';
  comments: string;
  debitPercent: string;
  debitOf: 'Payment' | 'Interest' | 'Principal' | 'NA' | '';
  plusAmount: string;
  minimumAmount: string;
  maximumAmount: string;
  debitThrough: 'date' | 'amount' | 'payments' | 'payoff' | '';
  debitThroughDate: string;
  debitThroughAmount: string;
  debitThroughPayments: string;
}

export interface PaymentRow {
  active: boolean;
  accountId: string;
  name: string;
  amount: string;
  percentage: string;
  comment: string;
  from: 'Interest' | 'Principal' | '';
}

const emptyDisbursementRow = (): DisbursementRow => ({
  active: true,
  accountId: '', name: '', startDate: '', endDate: '', amount: '', percentage: '', from: '', comments: '',
  debitPercent: '', debitOf: '', plusAmount: '', minimumAmount: '', maximumAmount: '',
  debitThrough: '', debitThroughDate: '', debitThroughAmount: '', debitThroughPayments: '',
});
const defaultDisbursements = (): DisbursementRow[] => [];

const emptyPaymentRow = (): PaymentRow => ({ active: false, accountId: '', name: '', amount: '', percentage: '', comment: '', from: '' });
const defaultPayments = (): PaymentRow[] => [emptyPaymentRow(), emptyPaymentRow()];

export interface FundingFormData {
  loan: string;
  borrower: string;
  lenderId: string;
  lenderFullName: string;
  lenderEmail?: string;
  lenderPhone?: string;
  lenderRate: string;
  fundingAmount: string;
  baseFee: string;
  fundingDate: string;
  interestFrom: string;
  notes: string;
  brokerParticipates: boolean;
  percentOwned: string;
  regularPayment: string;
  lenderShare: string;
  rateSelection: 'note_rate' | 'sold_rate' | 'lender_rate';
  rateNoteValue: string;
  rateSoldValue: string;
  rateLenderValue: string;
  /** When true, user has opted to override the auto-prefilled Lender Rate (from Sold Rate). */
  lenderRateOverride?: boolean;
  /** Editable override value entered by user when Override checkbox is on. */
  lenderRateOverrideValue?: string;
  roundingAdjustment: boolean;
  disbursements: DisbursementRow[];
  principalBalance?: string;
  currentBalance?: string;
  noteRateDisplay?: string;
  overrideServicing?: boolean;
  companyBaseFee?: string;
  companyBaseFeePct?: string;
  companyAdditionalServices?: string;
  companyMinimum?: string;
  companyMaximum?: string;
  companyNrSitSplitPct?: string;
  companyNrSitSplit?: string;
  companyTotal?: string;
  vendorId?: string;
  vendorName?: string;
  vendorBaseFee?: string;
  vendorBaseFeePct?: string;
  vendorAdditionalServices?: string;
  vendorMinimum?: string;
  vendorMaximum?: string;
  vendorNrSitSplitPct?: string;
  vendorNrSitSplit?: string;
  vendorTotal?: string;
  payments?: PaymentRow[];
  // Legacy servicing fees (kept for backward compatibility)
  overrideServicingFees: boolean;
  companyServicingFee: string;
  companyServicingFeePct: string;
  companyMaxFee: string;
  companyMaxFeePct: string;
  companyMinFee: string;
  companyMinFeePct: string;
  brokerServicingFee: string;
  brokerServicingFeePct: string;
  brokerMaxFee: string;
  brokerMaxFeePct: string;
  brokerMinFee: string;
  brokerMinFeePct: string;
  // Default fees section
  overrideDefaultFees: boolean;
  lateFee1Lender: string;
  lateFee1Company: string;
  lateFee1Broker: string;
  lateFee1Total: string;
  lateFee1Maximum: string;
  lateFee2Lender: string;
  lateFee2Company: string;
  lateFee2Broker: string;
  lateFee2Total: string;
  lateFee2Maximum: string;
  defaultInterestLender: string;
  defaultInterestCompany: string;
  defaultInterestBroker: string;
  defaultInterestTotal: string;
  defaultInterestMaximum: string;
  interestGuaranteeLender: string;
  interestGuaranteeCompany: string;
  interestGuaranteeBroker: string;
  interestGuaranteeTotal: string;
  interestGuaranteeMaximum: string;
  prepaymentLender: string;
  prepaymentCompany: string;
  prepaymentBroker: string;
  prepaymentTotal: string;
  prepaymentMaximum: string;
  maturityLender: string;
  maturityCompany: string;
  maturityBroker: string;
  maturityTotal: string;
  maturityMaximum: string;
}

const getDefaultFormData = (loanNumber: string, borrowerName: string, noteRate: string, soldRate: string): FundingFormData => ({
  loan: loanNumber, borrower: borrowerName, lenderId: '', lenderFullName: '', lenderEmail: '', lenderPhone: '',
  lenderRate: '', fundingAmount: '', baseFee: '', fundingDate: '', interestFrom: '', notes: '', brokerParticipates: false,
  percentOwned: '', regularPayment: '', lenderShare: '',
  rateSelection: 'note_rate', rateNoteValue: noteRate, rateSoldValue: soldRate, rateLenderValue: '',
  lenderRateOverride: false,
  lenderRateOverrideValue: '',
  roundingAdjustment: false,
  disbursements: defaultDisbursements(),
  principalBalance: '', currentBalance: '', noteRateDisplay: noteRate,
  overrideServicing: false,
  companyBaseFee: '', companyBaseFeePct: '', companyAdditionalServices: '', companyMinimum: '', companyMaximum: '',
  companyNrSitSplitPct: '', companyNrSitSplit: '', companyTotal: '',
  vendorId: '', vendorName: '',
  vendorBaseFee: '', vendorBaseFeePct: '', vendorAdditionalServices: '', vendorMinimum: '', vendorMaximum: '',
  vendorNrSitSplitPct: '', vendorNrSitSplit: '', vendorTotal: '',
  payments: defaultPayments(),
  overrideServicingFees: false,
  companyServicingFee: '', companyServicingFeePct: '', companyMaxFee: '', companyMaxFeePct: '',
  companyMinFee: '', companyMinFeePct: '', brokerServicingFee: '', brokerServicingFeePct: '',
  brokerMaxFee: '', brokerMaxFeePct: '', brokerMinFee: '', brokerMinFeePct: '',
  overrideDefaultFees: false,
  lateFee1Lender: '', lateFee1Company: '', lateFee1Broker: '', lateFee1Total: '', lateFee1Maximum: '',
  lateFee2Lender: '', lateFee2Company: '', lateFee2Broker: '', lateFee2Total: '', lateFee2Maximum: '',
  defaultInterestLender: '', defaultInterestCompany: '', defaultInterestBroker: '', defaultInterestTotal: '', defaultInterestMaximum: '',
  interestGuaranteeLender: '', interestGuaranteeCompany: '', interestGuaranteeBroker: '', interestGuaranteeTotal: '', interestGuaranteeMaximum: '',
  prepaymentLender: '', prepaymentCompany: '', prepaymentBroker: '', prepaymentTotal: '', prepaymentMaximum: '',
  maturityLender: '', maturityCompany: '', maturityBroker: '', maturityTotal: '', maturityMaximum: '',
});

export const AddFundingModal: React.FC<AddFundingModalProps> = ({
  open,
  onOpenChange,
  loanNumber = '',
  borrowerName = '',
  onSubmit,
  editData,
  isEditing = false,
  noteRate = '',
  soldRate = '',
  totalPayment = '',
  loanAmount = '',
  loanPrincipalBalance,
  remainingPayments = 0,
  existingRecords = [],
  editingRecordId,
}) => {
  // Draft persistence key — survives tab switches and modal close until explicit Save/Cancel
  const draftKey = React.useMemo(
    () => `addFundingDraft:${editingRecordId || 'new'}:${loanNumber || 'noloan'}`,
    [editingRecordId, loanNumber]
  );

  const readDraft = (): FundingFormData | null => {
    try {
      const raw = sessionStorage.getItem(draftKey);
      return raw ? JSON.parse(raw) as FundingFormData : null;
    } catch { return null; }
  };

  // Sanity guard: US private mortgage rates legally cap around 18-20%. Anything
  // above 25% is almost certainly a wrong field mapped into a rate slot
  // (e.g. hold_days = 44, term in months, fee amount, an integer ID).
  // Returns true when the rate is a valid mortgage rate (> 0 and <= 25).
  const isValidMortgageRate = (raw: unknown): boolean => {
    if (raw === null || raw === undefined) return false;
    const s = String(raw).trim();
    if (s === '') return false;
    const n = parseFloat(s.replace(/[%,]/g, ''));
    if (!Number.isFinite(n)) return false;
    if (n <= 0) return false;
    if (n > 25) {
      console.error(
        '[AddFundingModal] Lender Rate sanity check failed:',
        n,
        '— value exceeds 25%, likely a wrong field mapping. Falling back to default.'
      );
      return false;
    }
    return true;
  };

  // Authoritative Lender Rate default priority chain:
  //   P1 Override+manual → keep manual (handled by caller)
  //   P2 Sold Rate valid → soldRate
  //   P3 Note Rate valid → noteRate  (previously missing — caused blank Lender Rate)
  //   P4 neither valid   → '' (warn user)
  const getDefaultLenderRate = (): string => {
    const s = (soldRate || '').trim();
    if (isValidMortgageRate(s)) return s;
    const n = (noteRate || '').trim();
    if (isValidMortgageRate(n)) return n;
    return '';
  };

  const getInitialFormData = (): FundingFormData => {
    const defaultLR = getDefaultLenderRate();
    // 1. Restore unsaved draft (highest priority — preserves in-progress edits across tab switches)
    const draft = readDraft();
    if (draft) {
      const draftOverride = !!draft.lenderRateOverride;
      const draftLR = (draft.lenderRate || draft.rateLenderValue || '').trim();
      const draftOverrideVal = (draft.lenderRateOverrideValue || '').trim();
      // Apply sanity guard: reject any saved/draft value > 100% even when
      // override is on (a manual override of 44 would still be corruption).
      const resolvedLR = draftOverride && isValidMortgageRate(draftOverrideVal)
        ? draftOverrideVal
        : (isValidMortgageRate(draftLR) ? draftLR : defaultLR);
      const mergedDraft = {
        ...draft,
        rateSoldValue: soldRate || draft.rateSoldValue || '',
        lenderRate: resolvedLR,
        // If the override value itself is corrupt, clear it so the modal
        // doesn't re-show 44 the next time override is toggled on.
        lenderRateOverrideValue: draftOverride && isValidMortgageRate(draftOverrideVal)
          ? draftOverrideVal
          : '',
      };
      return {
        ...getDefaultFormData(loanNumber, borrowerName, noteRate, soldRate),
        ...mergedDraft,
        loan: loanNumber || draft.loan,
        borrower: borrowerName || draft.borrower,
        // Rounding Adjustment is a mutually-exclusive global flag — always trust the
        // latest editData value (parent enforces exclusivity), never the stale draft.
        roundingAdjustment: editData
          ? (editData.roundingAdjustment ?? false)
          : (draft.roundingAdjustment ?? false),
        disbursements: draft.disbursements?.length ? draft.disbursements.map(d => ({
          ...emptyDisbursementRow(),
          ...d,
        })) : defaultDisbursements(),
        payments: draft.payments?.length ? draft.payments : defaultPayments(),
      };
    }
    if (editData) {
      const editOverride = !!editData.lenderRateOverride;
      const editLR = (editData.lenderRate || editData.rateLenderValue || '').trim();
      const editOverrideVal = (editData.lenderRateOverrideValue || '').trim();
      // P1: respect saved override rate when valid. Otherwise apply default chain
      // (repairing corrupted null/0/>100% saved rates).
      const resolvedLR = editOverride && isValidMortgageRate(editOverrideVal)
        ? editOverrideVal
        : (isValidMortgageRate(editLR) ? editLR : defaultLR);
      const mergedEditData = {
        ...editData,
        rateSoldValue: soldRate || editData.rateSoldValue || '',
        lenderRate: resolvedLR,
      };
      return {
        ...getDefaultFormData(loanNumber, borrowerName, noteRate, soldRate),
        ...mergedEditData,
        loan: loanNumber || editData.loan,
        borrower: borrowerName || editData.borrower,
        roundingAdjustment: editData.roundingAdjustment ?? false,
        disbursements: editData.disbursements?.length ? editData.disbursements.map(d => ({
          ...emptyDisbursementRow(),
          ...d,
        })) : defaultDisbursements(),
        payments: editData.payments?.length ? editData.payments : defaultPayments(),
        lateFee1Maximum: editData.lateFee1Maximum ?? '',
        lateFee2Maximum: editData.lateFee2Maximum ?? '',
        defaultInterestMaximum: editData.defaultInterestMaximum ?? '',
        interestGuaranteeMaximum: editData.interestGuaranteeMaximum ?? '',
        prepaymentMaximum: editData.prepaymentMaximum ?? '',
        maturityMaximum: editData.maturityMaximum ?? '',
      };
    }
    return getDefaultFormData(loanNumber, borrowerName, noteRate, soldRate);
  };

  const [formData, setFormData] = useState<FundingFormData>(getInitialFormData());
  const [showConfirm, setShowConfirm] = useState(false);
  const [duplicateLender, setDuplicateLender] = useState<{ lenderId: string; lenderName: string } | null>(null);
  const [fundingDateOpen, setFundingDateOpen] = useState(false);
  const [interestFromOpen, setInterestFromOpen] = useState(false);
  const [disbursementModalOpen, setDisbursementModalOpen] = useState(false);
  const [editingDisbursementIdx, setEditingDisbursementIdx] = useState<number | null>(null);
  const [fundingHidden, setFundingHidden] = useState(false);

  React.useEffect(() => {
    if (open) {
      const data = getInitialFormData();
      setFormData(data);
    }
  }, [open, editData, draftKey]);

  // Note Rate, Sold Rate, and Lender Rate are dynamically linked.
  // Source of truth: Sold Rate (falls back to Note Rate when Sold is empty).
  // When Override is ON, lenderRate mirrors lenderRateOverrideValue (the editable
  // override input) so all in-modal downstream calculations (interest share,
  // NR/Sit split, payment) immediately use the overridden rate. When Override
  // is OFF, lenderRate mirrors Sold Rate (falling back to Note Rate).
  React.useEffect(() => {
    if (!open) return;

    setFormData((prev) => {
      const nextSoldRate = (soldRate || '').trim();
      const nextNoteRate = (noteRate || '').trim();
      // Guard: a corrupt soldRate (e.g. 44 from a mis-mapped field) must not
      // poison the lender rate. Fall through to noteRate when soldRate fails
      // the mortgage-rate sanity check.
      const soldRateSafe = isValidMortgageRate(nextSoldRate) ? nextSoldRate : '';
      const noteRateSafe = isValidMortgageRate(nextNoteRate) ? nextNoteRate : '';
      const linkedRate = soldRateSafe !== '' ? soldRateSafe : noteRateSafe;

      const overrideOn = !!prev.lenderRateOverride;
      const overrideVal = (prev.lenderRateOverrideValue || '').trim();
      const effectiveRate = overrideOn ? overrideVal : linkedRate;

      const shouldSyncLenderRate =
        effectiveRate !== '' && prev.lenderRate !== effectiveRate;
      const soldChanged = prev.rateSoldValue !== nextSoldRate;
      const noteChanged = (prev.rateNoteValue || '') !== nextNoteRate;
      const noteDisplayChanged = (prev.noteRateDisplay || '') !== nextNoteRate;

      if (!soldChanged && !noteChanged && !noteDisplayChanged && !shouldSyncLenderRate) {
        return prev;
      }

      return {
        ...prev,
        rateSoldValue: nextSoldRate,
        rateNoteValue: nextNoteRate || prev.rateNoteValue,
        noteRateDisplay: nextNoteRate || prev.noteRateDisplay,
        ...(shouldSyncLenderRate
          ? { lenderRate: effectiveRate, rateLenderValue: effectiveRate }
          : {}),
      };
    });
  }, [open, soldRate, noteRate, formData.lenderRateOverride, formData.lenderRateOverrideValue]);

  // Auto-save in-progress form to sessionStorage on every change (so tab-switch/close keeps the draft).
  // Cleared explicitly on successful save (handleConfirmSave) — Cancel keeps the draft so user can resume.
  React.useEffect(() => {
    if (!open) return;
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(formData));
    } catch { /* ignore quota errors */ }
  }, [formData, open, draftKey]);

  // Warn the user before the browser/tab is closed if the modal has entered (unsaved) data.
  // Triggers the browser's native "Leave site?" confirmation dialog.
  React.useEffect(() => {
    if (!open) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const filled = hasModalFormData(formData, ['loan', 'borrower', 'rateSelection', 'rateNoteValue', 'rateSoldValue', 'rateLenderValue', 'percentOwned', 'regularPayment', 'lenderRate', 'disbursements', 'payments', 'principalBalance', 'noteRateDisplay', 'overrideServicing', 'companyBaseFee', 'companyBaseFeePct', 'companyAdditionalServices', 'companyMinimum', 'companyMaximum', 'companyNrSitSplitPct', 'companyNrSitSplit', 'companyTotal', 'vendorId', 'vendorName', 'vendorBaseFee', 'vendorBaseFeePct', 'vendorAdditionalServices', 'vendorMinimum', 'vendorMaximum', 'vendorNrSitSplitPct', 'vendorNrSitSplit', 'vendorTotal'], { brokerParticipates: false, overrideServicingFees: false, overrideDefaultFees: false, roundingAdjustment: false });
      if (filled) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [open, formData]);

  // Keep the legacy rateLenderValue in sync with the editable Lender Rate field without overwriting user input.
  React.useEffect(() => {
    if ((formData.rateLenderValue || '') !== (formData.lenderRate || '')) {
      setFormData(prev => ({ ...prev, rateLenderValue: prev.lenderRate || '' }));
    }
  }, [formData.lenderRate, formData.rateLenderValue]);

  // Auto-compute Lender Pro Rata (Percent Owned):
  //   Pro Rata = Lender Current Balance ÷ Loan Principal Balance × 100
  // Stored at 6 decimal places (display layer rounds to 4dp + %).
  React.useEffect(() => {
    const principal = parseFloat((loanPrincipalBalance || '').replace(/[$,]/g, '')) || 0;
    const cb = parseFloat((formData.currentBalance || '').replace(/[$,]/g, ''));
    if (principal > 0 && !isNaN(cb) && cb > 0) {
      const computed = new Decimal(cb).div(principal).mul(100)
        .toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
      if (computed !== formData.percentOwned) {
        setFormData(prev => ({ ...prev, percentOwned: computed }));
      }
    } else if ((isNaN(cb) || cb <= 0) && formData.percentOwned !== '') {
      setFormData(prev => ({ ...prev, percentOwned: '' }));
    }
  }, [formData.currentBalance, loanPrincipalBalance]);



  // Auto-default Current Balance = Original Funding − Base Fee (only when not manually edited)
  const currentBalanceTouchedRef = React.useRef<boolean>(!!editData?.currentBalance);
  React.useEffect(() => {
    if (currentBalanceTouchedRef.current) return;
    const fa = parseFloat((formData.fundingAmount || '').replace(/[$,]/g, '')) || 0;
    const bf = parseFloat((formData.baseFee || '').replace(/[$,]/g, '')) || 0;
    if (fa <= 0) {
      if (formData.currentBalance && formData.currentBalance !== '') {
        setFormData(prev => ({ ...prev, currentBalance: '' }));
      }
      return;
    }
    const remaining = Math.max(0, fa - bf);
    const formatted = formatCurrencyDisplay(String(remaining.toFixed(2)));
    if (formatted !== formData.currentBalance) {
      setFormData(prev => ({ ...prev, currentBalance: formatted }));
    }
  }, [formData.fundingAmount, formData.baseFee]);

  // Mark Current Balance as manually touched when user edits it
  const prevCurrentBalanceRef = React.useRef<string | undefined>(formData.currentBalance);
  React.useEffect(() => {
    // detect change that didn't come from our auto-default by comparing against last known auto value
    if (formData.currentBalance !== prevCurrentBalanceRef.current && formData.currentBalance) {
      const fa = parseFloat((formData.fundingAmount || '').replace(/[$,]/g, '')) || 0;
      const bf = parseFloat((formData.baseFee || '').replace(/[$,]/g, '')) || 0;
      const auto = formatCurrencyDisplay(String(Math.max(0, fa - bf).toFixed(2)));
      if (formData.currentBalance !== auto) currentBalanceTouchedRef.current = true;
    }
    prevCurrentBalanceRef.current = formData.currentBalance;
  }, [formData.currentBalance, formData.fundingAmount, formData.baseFee]);

  // Lender Payment (per-lender share of borrower's scheduled P&I):
  //   Lender Payment = (Pro Rata / 100) × Borrower Regular P&I
  // Pro Rata is derived from Current Balance / Principal (computed above).
  // Rate (Note/Lender) is NOT used here — rates only drive interest accrual.
  React.useEffect(() => {
    const pct = parseFloat((formData.percentOwned || '').replace(/[%,]/g, '')) || 0;
    const regPI = parseFloat((totalPayment || '').replace(/[$,]/g, '')) || 0;
    const share = pct > 0 && regPI > 0
      ? new Decimal(pct).div(100).mul(regPI).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2)
      : '';
    if (share !== formData.regularPayment) {
      setFormData(prev => ({ ...prev, regularPayment: share }));
    }
  }, [formData.percentOwned, totalPayment]);

  // Auto-compute total columns for default fees
  const computeTotal = (lender: string, company: string, broker: string): string => {
    const l = parseFloat(lender) || 0;
    const c = parseFloat(company) || 0;
    const b = parseFloat(broker) || 0;
    const total = l + c + b;
    return total > 0 ? total.toFixed(2) : '';
  };

  React.useEffect(() => {
    const updates: Partial<FundingFormData> = {};
    updates.lateFee1Total = computeTotal(formData.lateFee1Lender, formData.lateFee1Company, formData.lateFee1Broker);
    updates.lateFee2Total = computeTotal(formData.lateFee2Lender, formData.lateFee2Company, formData.lateFee2Broker);
    updates.defaultInterestTotal = computeTotal(formData.defaultInterestLender, formData.defaultInterestCompany, formData.defaultInterestBroker);
    updates.interestGuaranteeTotal = computeTotal(formData.interestGuaranteeLender, formData.interestGuaranteeCompany, formData.interestGuaranteeBroker);
    updates.prepaymentTotal = computeTotal(formData.prepaymentLender, formData.prepaymentCompany, formData.prepaymentBroker);
    updates.maturityTotal = computeTotal(formData.maturityLender, formData.maturityCompany, formData.maturityBroker);
    setFormData(prev => ({ ...prev, ...updates }));
  }, [
    formData.lateFee1Lender, formData.lateFee1Company, formData.lateFee1Broker,
    formData.lateFee2Lender, formData.lateFee2Company, formData.lateFee2Broker,
    formData.defaultInterestLender, formData.defaultInterestCompany, formData.defaultInterestBroker,
    formData.interestGuaranteeLender, formData.interestGuaranteeCompany, formData.interestGuaranteeBroker,
    formData.prepaymentLender, formData.prepaymentCompany, formData.prepaymentBroker,
    formData.maturityLender, formData.maturityCompany, formData.maturityBroker,
  ]);

  // Auto-compute company and vendor totals
  React.useEffect(() => {
    const sum = (vals: (string | undefined)[]) => vals.reduce((s, v) => s + (parseFloat((v || '').replace(/[$,]/g, '')) || 0), 0);
    const companyTotal = sum([formData.companyBaseFee, formData.companyAdditionalServices, formData.companyMinimum, formData.companyMaximum, formData.companyNrSitSplit]);
    const vendorTotal = sum([formData.vendorBaseFee, formData.vendorAdditionalServices, formData.vendorMinimum, formData.vendorMaximum, formData.vendorNrSitSplit]);
    setFormData(prev => ({
      ...prev,
      companyTotal: companyTotal > 0 ? formatCurrencyDisplay(companyTotal.toFixed(2)) : '',
      vendorTotal: vendorTotal > 0 ? formatCurrencyDisplay(vendorTotal.toFixed(2)) : '',
    }));
  }, [formData.companyBaseFee, formData.companyAdditionalServices, formData.companyMinimum, formData.companyMaximum, formData.companyNrSitSplit,
      formData.vendorBaseFee, formData.vendorAdditionalServices, formData.vendorMinimum, formData.vendorMaximum, formData.vendorNrSitSplit]);

  const percentOwnedNum = parseFloat(formData.percentOwned) || 0;
  const percentOwnedError = percentOwnedNum > 100;
  // Over-funded: total of ALL lenders' Funding Amounts AND Current Balances
  // must each be ≤ Loan Principal Balance. Strict — only a $0.01 floating-point
  // rounding tolerance is allowed so cent-level overages are blocked.
  const FUNDING_TOLERANCE = 0.01;
  const thisLenderShare = parseFloat((formData.fundingAmount || '').replace(/[$,]/g, '')) || 0;
  const thisLenderCurrentBalance = parseFloat((formData.currentBalance || '').replace(/[$,]/g, '')) || 0;
  const otherLendersCurrentTotal = existingRecords
    .filter(r => r.id !== editingRecordId)
    .reduce((sum, r) => sum + (Number(r.originalAmount) || 0), 0);
  const otherLendersCurrentBalanceTotal = existingRecords
    .filter(r => r.id !== editingRecordId)
    .reduce((sum, r) => sum + (Number(r.currentBalance) || 0), 0);
  const principalBalanceNum = parseFloat((loanPrincipalBalance || '').replace(/[$,]/g, ''))
    || parseFloat((loanAmount || '').replace(/[$,]/g, ''))
    || 0;
  const projectedFundedTotal = otherLendersCurrentTotal + thisLenderShare;
  const projectedCurrentBalanceTotal = otherLendersCurrentBalanceTotal + thisLenderCurrentBalance;
  const totalPercentError = principalBalanceNum > 0
    && projectedFundedTotal > principalBalanceNum + FUNDING_TOLERANCE;
  const currentBalanceTotalError = principalBalanceNum > 0
    && projectedCurrentBalanceTotal > principalBalanceNum + FUNDING_TOLERANCE;
  // Legacy computed for any callers still reading it.
  const otherLendersTotal = existingRecords
    .filter(r => r.id !== editingRecordId)
    .reduce((sum, r) => sum + r.pctOwned, 0);
  const projectedTotal = otherLendersTotal + percentOwnedNum;

  const handleChange = (field: keyof FundingFormData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleDisbursementChange = (index: number, field: keyof DisbursementRow, value: string | boolean) => {
    setFormData(prev => {
      const updated = [...prev.disbursements];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, disbursements: updated };
    });
  };

  const handleAddDisbursement = () => {
    setEditingDisbursementIdx(null);
    setFundingHidden(true);
    setDisbursementModalOpen(true);
  };

  const handleEditDisbursement = (index: number) => {
    setEditingDisbursementIdx(index);
    setFundingHidden(true);
    setDisbursementModalOpen(true);
  };

  const handleDisbursementModalClose = (openState: boolean) => {
    setDisbursementModalOpen(openState);
    if (!openState) {
      setFundingHidden(false);
    }
  };

  const handleDisbursementModalSubmit = (data: DisbursementFormData) => {
    // Validation: Σ disbursements may not exceed the lender's Payment
    // (Pro Rata × Borrower Regular P&I). Single source of truth shared with
    // the Funding grid's Net Payment column.
    const principalNum = parseFloat((loanPrincipalBalance || '').replace(/[$,]/g, '')) || 0;
    const cbNum = parseFloat((formData.currentBalance || '').replace(/[$,]/g, ''))
      || parseFloat((formData.fundingAmount || '').replace(/[$,]/g, '')) || 0;
    const regPI = parseFloat((totalPayment || '').replace(/[$,]/g, '')) || 0;
    const lenderPayment = principalNum > 0
      ? new Decimal(cbNum).div(principalNum).mul(regPI)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toNumber()
      : 0;
    const incoming = parseFloat(String(data.calculatedAmount || data.plusAmount || data.debitThroughAmount || '0').replace(/[$,]/g, '')) || 0;
    const otherDisbSum = (formData.disbursements || [])
      .filter((_, i) => i !== editingDisbursementIdx)
      .reduce((s, d) => s + (parseFloat(String(d.amount || '').replace(/[$,]/g, '')) || 0), 0);
    if (lenderPayment > 0 && otherDisbSum + incoming > lenderPayment + 0.005) {
      toast.error('Disbursement cannot exceed lender payment amount');
      return;
    }
    setFormData(prev => {
      const updated = [...prev.disbursements];
      const finalAmount = data.calculatedAmount
        ? formatCurrencyDisplay(data.calculatedAmount)
        : (data.plusAmount || data.debitThroughAmount || '');
      const row: DisbursementRow = {
        active: editingDisbursementIdx !== null && editingDisbursementIdx < updated.length
          ? updated[editingDisbursementIdx].active
          : true,
        accountId: data.accountId,
        name: data.name,
        startDate: data.startDate || '',
        endDate: '',
        amount: finalAmount,
        percentage: data.debitPercent || '',
        from: data.debitOf || '',
        comments: data.comments || '',
        debitPercent: data.debitPercent,
        debitOf: data.debitOf,
        plusAmount: data.plusAmount,
        minimumAmount: data.minimumAmount,
        maximumAmount: data.maximumAmount || '',
        debitThrough: data.debitThrough,
        debitThroughDate: data.debitThroughDate,
        debitThroughAmount: data.debitThroughAmount,
        debitThroughPayments: data.debitThroughPayments,
      };
      if (editingDisbursementIdx !== null && editingDisbursementIdx < updated.length) {
        updated[editingDisbursementIdx] = row;
      } else {
        updated.push(row);
      }
      return { ...prev, disbursements: updated };
    });
    setEditingDisbursementIdx(null);
  };

  // Inline comment auto-save handler
  const handleDisbursementCommentChange = (index: number, comment: string) => {
    setFormData(prev => {
      const updated = [...prev.disbursements];
      updated[index] = { ...updated[index], comments: comment };
      return { ...prev, disbursements: updated };
    });
  };

  // Percentage column is always visible
  const showPercentageCol = true;

  // Per-column visibility toggles for Disbursements grid
  const [disbColVisibility, setDisbColVisibility] = useState({
    active: true,
    accountId: true,
    name: true,
    startDate: true,
    amount: true,
    debitThrough: true,
    type: true,
    comment: true,
  });
  const toggleDisbCol = (key: keyof typeof disbColVisibility) =>
    setDisbColVisibility((prev) => ({ ...prev, [key]: !prev[key] }));

  // Lender share values for disbursement calculation
  const paymentShareNum = parseFloat((formData.regularPayment || '').replace(/[$,]/g, '')) || 0;
  const principalBalNum = parseFloat((formData.principalBalance || '').replace(/[$,]/g, '')) || 0;
  const lenderRateNum = parseFloat(formData.lenderRate || '0') || 0;
  const interestShareNum = principalBalNum > 0 && lenderRateNum > 0 ? (principalBalNum * lenderRateNum) / 12 / 100 : 0;
  const principalShareNum = Math.max(paymentShareNum - interestShareNum, 0);

  const handleDeleteDisbursement = (index: number) => {
    setFormData(prev => {
      const updated = [...prev.disbursements];
      updated.splice(index, 1);
      return { ...prev, disbursements: updated };
    });
  };

  // Payment row handlers
  const handlePaymentChange = (index: number, field: keyof PaymentRow, value: string | boolean) => {
    setFormData(prev => {
      const payments = [...(prev.payments || defaultPayments())];
      payments[index] = { ...payments[index], [field]: value };
      return { ...prev, payments };
    });
  };

  const handleAddPaymentRow = () => {
    setFormData(prev => ({
      ...prev,
      payments: [...(prev.payments || []), emptyPaymentRow()],
    }));
  };

  const handleDeletePaymentRow = (index: number) => {
    setFormData(prev => {
      const payments = [...(prev.payments || [])];
      payments.splice(index, 1);
      return { ...prev, payments };
    });
  };

  const isFormFilled = hasModalFormData(formData, ['loan', 'borrower', 'rateSelection', 'rateNoteValue', 'rateSoldValue', 'rateLenderValue', 'percentOwned', 'regularPayment', 'lenderRate', 'disbursements', 'payments', 'principalBalance', 'noteRateDisplay', 'overrideServicing', 'companyBaseFee', 'companyBaseFeePct', 'companyAdditionalServices', 'companyMinimum', 'companyMaximum', 'companyNrSitSplitPct', 'companyNrSitSplit', 'companyTotal', 'vendorId', 'vendorName', 'vendorBaseFee', 'vendorBaseFeePct', 'vendorAdditionalServices', 'vendorMinimum', 'vendorMaximum', 'vendorNrSitSplitPct', 'vendorNrSitSplit', 'vendorTotal'], { brokerParticipates: false, overrideServicingFees: false, overrideDefaultFees: false, roundingAdjustment: false });

  const handleSaveClick = () => {
    // Rule: Funding Amount must be > $0 (Test 7).
    if (thisLenderShare <= 0) {
      toast.error('Funding amount must be greater than $0.');
      return;
    }
    // Rule: Funding Amount must not exceed remaining capacity (Tests 4, 6, 12).
    if (totalPercentError) {
      const remaining = Math.max(0, principalBalanceNum - otherLendersCurrentTotal);
      toast.error(
        `Funding amount of $${thisLenderShare.toFixed(2)} exceeds available capacity. ` +
        `Maximum allowed: $${remaining.toFixed(2)}.`
      );
      return;
    }
    // Rule: Current Balance (when editing) must not push total over principal (Test 9).
    if (currentBalanceTotalError) {
      const remaining = Math.max(0, principalBalanceNum - otherLendersCurrentBalanceTotal);
      toast.error(
        'This change would cause total funding to exceed the loan principal. ' +
        `Maximum allowed for this lender: $${remaining.toFixed(2)}.`
      );
      return;
    }
    // Validation: Lender Rate vs Note Rate (Funding > Payment rules)
    const effectiveLenderRateStr = formData.lenderRateOverride
      ? (formData.lenderRateOverrideValue || '')
      : (formData.lenderRate || formData.rateLenderValue || '');
    const trimmedLR = String(effectiveLenderRateStr).trim();
    // P4 guard: when neither Sold Rate nor Note Rate is set on the loan and
    // Override is off, the auto-fill chain returns ''. Block save and tell
    // the user how to recover (set Note Rate, or check Override to enter manually).
    if (trimmedLR === '') {
      toast.error(
        'Lender Rate is required. Set Note Rate on the loan first, or check Override to enter a rate manually.'
      );
      return;
    }
    if (trimmedLR !== '') {
      const lrNum = parseFloat(trimmedLR);
      const nrNum = parseFloat(String(noteRate || '').replace(/[%,]/g, '')) || 0;
      if (!isNaN(lrNum)) {
        if (lrNum < 0) {
          toast.error('Lender Rate cannot be negative');
          return;
        }
        if (nrNum > 0 && lrNum > nrNum) {
          toast.error('Lender Rate cannot exceed Note Rate');
          return;
        }
      }
    }
    // Duplicate-lender warning: allow but confirm if this lender already has a funding record
    const currentLenderId = (formData.lenderId || '').trim();
    if (currentLenderId) {
      const dup = existingRecords.find(r => r.id !== editingRecordId && (r.lenderId || '').trim() === currentLenderId);
      if (dup) {
        setDuplicateLender({ lenderId: currentLenderId, lenderName: dup.lenderName || formData.lenderFullName || '' });
        return;
      }
    }
    setShowConfirm(true);
  };
  const handleConfirmSave = () => {
    setShowConfirm(false);
    // Sync new fee fields back to legacy fields for persistence
    const effectiveRateLenderValue = formData.lenderRateOverride
      ? (formData.lenderRateOverrideValue || '')
      : (formData.lenderRate || formData.rateLenderValue || '');

    const syncedData: FundingFormData = {
      ...formData,
      loan: loanNumber || formData.loan,
      borrower: borrowerName || formData.borrower,
      rateLenderValue: effectiveRateLenderValue,
      overrideServicingFees: formData.overrideServicing || formData.overrideServicingFees,
      companyServicingFee: formData.companyBaseFee || formData.companyServicingFee,
      companyServicingFeePct: formData.companyBaseFeePct || formData.companyServicingFeePct,
      companyMinFee: formData.companyMinimum || formData.companyMinFee,
      companyMaxFee: formData.companyMaximum || formData.companyMaxFee,
      brokerServicingFee: formData.vendorBaseFee || formData.brokerServicingFee,
      brokerServicingFeePct: formData.vendorBaseFeePct || formData.brokerServicingFeePct,
      brokerMinFee: formData.vendorMinimum || formData.brokerMinFee,
      brokerMaxFee: formData.vendorMaximum || formData.brokerMaxFee,
    };
    onSubmit(syncedData);
    // Clear draft on successful save so reopening starts fresh
    try { sessionStorage.removeItem(draftKey); } catch { /* ignore */ }
    setFormData(getDefaultFormData(loanNumber, borrowerName, noteRate, soldRate));
    onOpenChange(false);
  };

  const handleCancel = () => { onOpenChange(false); };

  const servicingDisabled = !(formData.overrideServicing ?? false);
  // Fees to Vendor fields are editable independently of Vendor ID selection.
  // Role-based access (CSR/Admin) is enforced by the surrounding form / RLS,
  // so we do NOT gate the inputs on whether a Vendor ID is present.
  const vendorDisabled = false;

  const fundingDate = parseDateOnly(formData.fundingDate);
  const interestFromDate = parseDateOnly(formData.interestFrom);

  const renderCurrencyInput = (field: keyof FundingFormData, placeholder = '-', disabled = false) => (
    <div className="relative flex-1">
      <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
      <Input
        value={(formData[field] as string) || ''}
        onChange={(e) => handleChange(field, e.target.value.replace(/[^0-9.]/g, ''))}
        onKeyDown={numericKeyDown}
        onPaste={(e) => numericPaste(e, (val) => handleChange(field, val))}
        onBlur={() => { const raw = formData[field] as string; if (raw) handleChange(field, formatCurrencyDisplay(raw)); }}
        onFocus={() => { const raw = formData[field] as string; if (raw) handleChange(field, unformatCurrencyDisplay(raw)); }}
        className="h-6 text-xs pl-4"
        inputMode="decimal"
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  );

  const renderPercentInput = (field: keyof FundingFormData, placeholder = '%', disabled = false) => (
    <div className="relative flex-1">
      <Input
        value={(formData[field] as string) || ''}
        onChange={(e) => handleChange(field, e.target.value.replace(/[^0-9.]/g, ''))}
        onKeyDown={numericKeyDown}
        className="h-6 text-xs pr-4"
        inputMode="decimal"
        placeholder={placeholder}
        disabled={disabled}
      />
      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
    </div>
  );

  const renderDateField = (value: Date | undefined, onSelect: (d: Date | undefined) => void, isOpen: boolean, setOpen: (v: boolean) => void) => (
    <Popover open={isOpen} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn('h-6 text-xs w-full justify-start text-left font-normal flex-1', !value && 'text-muted-foreground')}>
          {value && !isNaN(value.getTime()) ? formatDateOnly(value, 'MM/dd/yyyy') : 'Date'}
          <CalendarIcon className="ml-auto h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 z-[9999]" align="start">
        <EnhancedCalendar mode="single" selected={value} onSelect={(d) => { onSelect(d); setOpen(false); }} onClear={() => { onSelect(undefined); setOpen(false); }} onToday={() => { onSelect(parseDateOnly(todayDateOnly())); setOpen(false); }} initialFocus />
      </PopoverContent>
    </Popover>
  );

  return (
    <>
    <Dialog open={open && !fundingHidden} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden p-0">
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30 pr-10">
          <span className="text-xs font-bold">Add / Edit Lender Funding</span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold">Principal Balance</span>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs max-w-[260px]">
                  Outstanding principal balance for this loan. All lender funding totals and pro rata calculations must reconcile to this amount.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <div className="relative w-24">
              <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
              <Input
                value={loanPrincipalBalance ?? ''}
                readOnly
                tabIndex={-1}
                aria-readonly="true"
                className="h-6 text-xs pl-4 bg-muted/50 cursor-not-allowed"
                placeholder="-"
              />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-2 sleek-scrollbar space-y-3">
          {/* 3-Column Layout: Lender Details | Fees to Company | Fees to Vendor */}
          <div className="grid grid-cols-3 gap-x-4 gap-y-0">
            {/* COLUMN 1: Lender Details */}
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <Label className="text-xs font-bold min-w-[75px] shrink-0">Lender ID</Label>
                <LenderIdSearch
                  value={formData.lenderId}
                  onChange={(lenderId, lenderFullName, contactData) => {
                    setFormData(prev => ({
                      ...prev,
                      lenderId,
                      ...(lenderFullName ? { lenderFullName } : {}),
                      ...(contactData ? {
                        lenderEmail: (contactData.email as string) || prev.lenderEmail || '',
                        lenderPhone: (contactData.phone as string)
                          || (contactData['phone.cell'] as string)
                          || (contactData['phone.work'] as string)
                          || (contactData['phone.home'] as string)
                          || prev.lenderPhone || '',
                      } : {}),
                    }));
                  }}
                  className="h-6 text-xs"
                />
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs font-bold min-w-[75px] shrink-0">Name</Label>
                <Input value={formData.lenderFullName} readOnly className="h-6 text-xs bg-muted/30" />
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs font-bold min-w-[75px] shrink-0">Email</Label>
                <Input
                  type="email"
                  value={formData.lenderEmail || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, lenderEmail: e.target.value }))}
                  className="h-6 text-xs"
                  placeholder="email@example.com"
                />
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs font-bold min-w-[75px] shrink-0">Phone</Label>
                <Input
                  type="tel"
                  value={formData.lenderPhone || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, lenderPhone: e.target.value }))}
                  className="h-6 text-xs"
                  placeholder="Phone"
                />
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs font-bold min-w-[75px] shrink-0">Note Rate</Label>
                {renderPercentInput('noteRateDisplay', '%', true)}
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs font-bold min-w-[75px] shrink-0">Lender Rate</Label>
                {(() => {
                  const hasLenderRate = !!(formData.lenderRate && String(formData.lenderRate).trim() !== '');
                  return (
                    <div className="relative flex-1">
                      <Input
                        value={formData.lenderRate || ''}
                        onChange={(e) => {
                          if (hasLenderRate) return;
                          // Allow only digits and a single decimal. Truncate (do NOT round) to 2 decimals.
                          let v = e.target.value.replace(/[^0-9.]/g, '');
                          const parts = v.split('.');
                          if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
                          const [intPart, decPart] = v.split('.');
                          if (decPart && decPart.length > 2) {
                            v = `${intPart}.${decPart.slice(0, 2)}`;
                          }
                          setFormData(prev => ({ ...prev, lenderRate: v, rateLenderValue: v }));
                        }}
                        onBlur={(e) => {
                          if (hasLenderRate) return;
                          // Pad to exactly 2 decimal places without rounding.
                          const raw = (e.target.value || '').replace(/[^0-9.]/g, '');
                          if (!raw) return;
                          const [intPart, decPart = ''] = raw.split('.');
                          const truncated = `${intPart || '0'}.${(decPart + '00').slice(0, 2)}`;
                          if (truncated !== formData.lenderRate) {
                            setFormData(prev => ({ ...prev, lenderRate: truncated, rateLenderValue: truncated }));
                          }
                        }}
                        onKeyDown={numericKeyDown}
                        disabled={hasLenderRate}
                        className={cn("h-6 text-xs pr-4", hasLenderRate && "opacity-60 bg-muted cursor-not-allowed")}
                        inputMode="decimal"
                        placeholder="%"
                      />
                      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                    </div>
                  );
                })()}
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs font-bold min-w-[75px] shrink-0 flex items-center gap-1">
                  <span>Override</span>
                  {(() => {
                    const isOn = !!formData.lenderRateOverride;
                    const soldRateVal = (formData.rateSoldValue || '').trim();
                    return (
                      <Checkbox
                        checked={isOn}
                        onCheckedChange={(checked) => {
                          const on = !!checked;
                          setFormData(prev => ({
                            ...prev,
                            lenderRateOverride: on,
                            lenderRateOverrideValue: on
                              ? (prev.lenderRateOverrideValue || prev.lenderRate || soldRateVal)
                              : prev.lenderRateOverrideValue,
                          }));
                        }}
                        className="h-3.5 w-3.5"
                      />
                    );
                  })()}
                </Label>
                {(() => {
                  const isOn = !!formData.lenderRateOverride;
                  return (
                    <div className="relative flex-1">
                      <Input
                        value={formData.lenderRateOverrideValue || ''}
                        onChange={(e) => {
                          let v = e.target.value.replace(/[^0-9.]/g, '');
                          const parts = v.split('.');
                          if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
                          const [intPart, decPart] = v.split('.');
                          if (decPart && decPart.length > 2) v = `${intPart}.${decPart.slice(0, 2)}`;
                          setFormData(prev => ({ ...prev, lenderRateOverrideValue: v, rateLenderValue: v }));
                        }}
                        onBlur={(e) => {
                          const raw = (e.target.value || '').replace(/[^0-9.]/g, '');
                          if (!raw) return;
                          const [intPart, decPart = ''] = raw.split('.');
                          const truncated = `${intPart || '0'}.${(decPart + '00').slice(0, 2)}`;
                          if (truncated !== formData.lenderRateOverrideValue) {
                            setFormData(prev => ({ ...prev, lenderRateOverrideValue: truncated, rateLenderValue: truncated }));
                          }
                        }}
                        onKeyDown={numericKeyDown}
                        className="h-6 text-xs pr-4"
                        inputMode="decimal"
                        placeholder="%"
                        disabled={!isOn}
                      />
                      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                    </div>
                  );
                })()}
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs font-bold min-w-[75px] shrink-0">Funding Date</Label>
                {renderDateField(fundingDate, (d) => handleChange('fundingDate', formatDateOnly(d)), fundingDateOpen, setFundingDateOpen)}
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs font-bold min-w-[75px] max-w-[75px] shrink-0 whitespace-normal leading-tight">Original Funding</Label>
                {renderCurrencyInput('fundingAmount', '0.00')}
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs font-bold min-w-[75px] max-w-[75px] shrink-0 whitespace-normal leading-tight">Base Fee</Label>
                {renderCurrencyInput('baseFee', 'Enter amount')}
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs font-bold min-w-[75px] max-w-[75px] shrink-0 whitespace-normal leading-tight">Current Balance</Label>
                {renderCurrencyInput('currentBalance', '0.00')}
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs font-bold min-w-[75px] shrink-0">Interest From</Label>
                {renderDateField(interestFromDate, (d) => handleChange('interestFrom', formatDateOnly(d)), interestFromOpen, setInterestFromOpen)}
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs font-bold min-w-[75px] shrink-0">Pro Rata</Label>
                <div className="relative flex-1">
                  <Input
                    value={formData.percentOwned ? formatPercentDisplay(formData.percentOwned, 4) : ''}
                    className="h-6 text-xs pr-4"
                    disabled
                  />
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                </div>
              </div>
            </div>

            {/* COLUMN 2: Fees to Company */}
            <div className="space-y-1">
              <p className="text-xs font-bold text-center border-b border-border pb-0.5">Fees to Company</p>
              <div className="flex items-center gap-1">
                <Label className="text-xs min-w-[80px] shrink-0">Override</Label>
                <Checkbox
                  checked={formData.overrideServicing ?? false}
                  onCheckedChange={(checked) => handleChange('overrideServicing', !!checked)}
                  className="h-3.5 w-3.5"
                />
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs min-w-[80px] shrink-0">Base Fee</Label>
                {renderCurrencyInput('companyBaseFee', '-', servicingDisabled)}
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs min-w-[80px] shrink-0">% of Principal</Label>
                {renderPercentInput('companyBaseFeePct', '%', servicingDisabled)}
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs min-w-[80px] shrink-0">Services</Label>
                {renderCurrencyInput('companyAdditionalServices', '-', servicingDisabled)}
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs min-w-[80px] shrink-0">Minimum</Label>
                {renderCurrencyInput('companyMinimum', '-', servicingDisabled)}
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs min-w-[80px] shrink-0">Maximum</Label>
                {renderCurrencyInput('companyMaximum', '-', servicingDisabled)}
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs min-w-[80px] shrink-0">NR / Sit Split</Label>
                <div className="flex items-center gap-0.5 flex-1">
                  {renderPercentInput('companyNrSitSplitPct', '%', servicingDisabled)}
                  {renderCurrencyInput('companyNrSitSplit', '-', servicingDisabled)}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs min-w-[80px] shrink-0 font-bold">Total</Label>
                <div className="relative flex-1">
                  <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                  <Input
                    value={(formData.companyTotal as string) || ''}
                    readOnly
                    className="h-6 text-xs pl-4 bg-muted/30 font-semibold"
                    placeholder="-"
                  />
                </div>
              </div>
            </div>

            {/* COLUMN 3: Fees to Vendor */}
            <div className="space-y-1">
              <p className="text-xs font-bold text-center border-b border-border pb-0.5">Fees to Vendor</p>
              <div className="flex items-center gap-1">
                <Label className="text-xs min-w-[70px] shrink-0">Vendor ID</Label>
                <AccountIdSearch
                  value={formData.vendorId || ''}
                  onChange={(vendorId, vendorName) => {
                    setFormData(prev => ({
                      ...prev,
                      vendorId,
                      ...(vendorName ? { vendorName } : {}),
                    }));
                  }}
                  className="h-6 text-xs"
                  contactTypes={['borrower', 'lender', 'broker']}
                />

              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs min-w-[70px] shrink-0">Name</Label>
                <Input value={formData.vendorName || ''} readOnly className="h-6 text-xs bg-muted/30" />
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs min-w-[70px] shrink-0">Base Fee</Label>
                {renderCurrencyInput('vendorBaseFee', '-', vendorDisabled)}
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs min-w-[70px] shrink-0">Additional</Label>
                {renderCurrencyInput('vendorAdditionalServices', '-', vendorDisabled)}
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs min-w-[70px] shrink-0">Minimum</Label>
                {renderCurrencyInput('vendorMinimum', '-', vendorDisabled)}
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs min-w-[70px] shrink-0">Maximum</Label>
                {renderCurrencyInput('vendorMaximum', '-', vendorDisabled)}
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs min-w-[70px] shrink-0">NR / Sit Split</Label>
                <div className="flex items-center gap-0.5 flex-1">
                  {renderPercentInput('vendorNrSitSplitPct', '%', vendorDisabled)}
                  {renderCurrencyInput('vendorNrSitSplit', '-', vendorDisabled)}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs min-w-[70px] shrink-0 font-bold">Total</Label>
                <div className="relative flex-1">
                  <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                  <Input
                    value={(formData.vendorTotal as string) || ''}
                    readOnly
                    className="h-6 text-xs pl-4 bg-muted/30 font-semibold"
                    placeholder="-"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Validation messages */}
          {percentOwnedError && (
            <p className="text-xs text-destructive font-medium">Percent Owned cannot exceed 100%</p>
          )}
          {totalPercentError && !percentOwnedError && (
            <p className="text-xs text-destructive font-medium">Funding exceeds loan principal balance.</p>
          )}

          {/* Checkboxes row */}
          <div className="space-y-1 pt-1">
            <div className="flex items-center gap-3">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Label className="text-xs font-medium cursor-help">Rounding Adjustment</Label>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">
                    This lender will receive any rounding difference (e.g., $0.01).
                    Only one lender can be selected at a time — enabling here will disable it on all other lenders.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <RadioGroup
                value={formData.roundingAdjustment ? 'yes' : 'no'}
                onValueChange={(v) => handleChange('roundingAdjustment', v === 'yes')}
                className="flex items-center gap-3"
              >
                <div className="flex items-center gap-1">
                  <RadioGroupItem value="yes" id="rounding-adj-yes" className="h-3.5 w-3.5" />
                  <Label htmlFor="rounding-adj-yes" className="text-xs cursor-pointer">Yes</Label>
                </div>
                <div className="flex items-center gap-1">
                  <RadioGroupItem value="no" id="rounding-adj-no" className="h-3.5 w-3.5" />
                  <Label htmlFor="rounding-adj-no" className="text-xs cursor-pointer">No</Label>
                </div>
              </RadioGroup>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={formData.brokerParticipates}
                onCheckedChange={(checked) => handleChange('brokerParticipates', !!checked)}
                className="h-3.5 w-3.5"
              />
              <Label className="text-xs font-medium italic cursor-pointer">Lender is Originating Broker, Employee of Broker, or Family Member</Label>
            </div>
          </div>

          {/* Disbursements from Lender Proceeds */}
          <div className="space-y-1 border-t border-border pt-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold underline text-foreground">Disbursements from Lender Proceeds</p>
              <div className="flex items-center gap-2">

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-6 text-xs gap-1">
                      <SlidersHorizontal className="h-3 w-3" />
                      Columns
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-48 p-2 z-[9999]">
                    <p className="text-xs font-semibold mb-2 text-foreground">Show / Hide Columns</p>
                    <div className="space-y-1.5">
                      {([
                        ['active', 'Active'],
                        ['accountId', 'Account ID'],
                        ['name', 'Name'],
                        ['startDate', 'Start Date'],
                        ['amount', 'Amount'],
                        ['debitThrough', 'Debit Through'],
                        ['type', 'Type'],
                        ['comment', 'Comment'],
                      ] as const).map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2 text-xs cursor-pointer hover:text-foreground text-muted-foreground">
                          <Checkbox
                            checked={disbColVisibility[key]}
                            onCheckedChange={() => toggleDisbCol(key)}
                            className="h-3.5 w-3.5"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <Button variant="outline" size="sm" className="h-6 text-xs gap-1" onClick={handleAddDisbursement}>
                  <Plus className="h-3 w-3" />
                  Add Disbursement
                </Button>
              </div>
            </div>
            {formData.disbursements.length > 0 && (() => {
              const showEndDateCol = formData.disbursements.some(
                (r) => (r.endDate && r.endDate.trim() !== '') ||
                       (r.debitThrough === 'date' && r.debitThroughDate && r.debitThroughDate.trim() !== '')
              );
              return (
              <div className="overflow-x-auto border border-border rounded">
                <table className="w-full text-xs table-fixed">
                  <colgroup>
                    {disbColVisibility.active && <col className="w-[50px]" />}
                    {disbColVisibility.accountId && <col className="w-[80px]" />}
                    {disbColVisibility.name && <col className="w-[100px]" />}
                    {disbColVisibility.startDate && <col className="w-[90px]" />}
                    {showEndDateCol && <col className="w-[90px]" />}
                    {disbColVisibility.amount && <col className="w-[80px]" />}
                    {disbColVisibility.debitThrough && <col className="w-[90px]" />}
                    {showPercentageCol && <col className="w-[60px]" />}
                    {disbColVisibility.type && <col className="w-[70px]" />}
                    {disbColVisibility.comment && <col />}
                    <col className="w-[60px]" />
                  </colgroup>
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      {disbColVisibility.active && <th className="text-center py-1 px-1 font-semibold text-muted-foreground">Active</th>}
                      {disbColVisibility.accountId && <th className="text-left py-1 px-1 font-semibold text-muted-foreground">Account ID</th>}
                      {disbColVisibility.name && <th className="text-left py-1 px-1 font-semibold text-muted-foreground">Name</th>}
                      {disbColVisibility.startDate && <th className="text-left py-1 px-1 font-semibold text-muted-foreground">Start Date</th>}
                      {showEndDateCol && (
                        <th className="text-left py-1 px-1 font-semibold text-muted-foreground">End Date</th>
                      )}
                      {disbColVisibility.amount && <th className="text-right py-1 px-1 font-semibold text-muted-foreground">Amount</th>}
                      {disbColVisibility.debitThrough && <th className="text-left py-1 px-1 font-semibold text-muted-foreground">Debit Through</th>}
                      {showPercentageCol && (
                        <th className="text-right py-1 px-1 font-semibold text-muted-foreground">Percentage</th>
                      )}
                      {disbColVisibility.type && <th className="text-left py-1 px-1 font-semibold text-muted-foreground">Type</th>}
                      {disbColVisibility.comment && <th className="text-left py-1 px-1 font-semibold text-muted-foreground">Comment</th>}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {formData.disbursements.map((row, idx) => (
                      <tr key={idx} className="border-b border-border last:border-b-0 hover:bg-muted/20">
                        {disbColVisibility.active && (
                          <td className="py-0.5 px-1 text-center">
                            <Checkbox
                              checked={row.active ?? true}
                              onCheckedChange={(checked) => handleDisbursementChange(idx, 'active', !!checked)}
                              className="h-3.5 w-3.5"
                            />
                          </td>
                        )}
                        {disbColVisibility.accountId && <td className="py-0.5 px-1 text-xs">{row.accountId || '-'}</td>}
                        {disbColVisibility.name && <td className="py-0.5 px-1 text-xs">{row.name || '-'}</td>}
                        {disbColVisibility.startDate && <td className="py-0.5 px-1 text-xs">{row.startDate ? formatDateOnly(parseDateOnly(row.startDate), 'MM/dd/yyyy') : '-'}</td>}
                        {showEndDateCol && (
                          <td className="py-0.5 px-1 text-xs">{row.endDate ? formatDateOnly(parseDateOnly(row.endDate), 'MM/dd/yyyy') : (row.debitThrough === 'date' && row.debitThroughDate ? formatDateOnly(parseDateOnly(row.debitThroughDate), 'MM/dd/yyyy') : '-')}</td>
                        )}
                        {disbColVisibility.amount && <td className="py-0.5 px-1 text-xs text-right">{row.amount ? `$${row.amount}` : '-'}</td>}
                        {disbColVisibility.debitThrough && (
                          <td className="py-0.5 px-1 text-xs">
                            {row.debitThrough === 'date' ? (row.debitThroughDate ? formatDateOnly(parseDateOnly(row.debitThroughDate), 'MM/dd/yyyy') : '-') :
                             row.debitThrough === 'amount' ? `$${row.debitThroughAmount}` :
                             row.debitThrough === 'payments' ? `${row.debitThroughPayments} Payments` :
                             row.debitThrough === 'payoff' ? 'Payoff' : '-'}
                          </td>
                        )}
                        {showPercentageCol && (
                          <td className="py-0.5 px-1 text-xs text-right">{row.debitPercent ? `${row.debitPercent}%` : '-'}</td>
                        )}
                        {disbColVisibility.type && <td className="py-0.5 px-1 text-xs">{row.debitOf || row.from || '-'}</td>}
                        {disbColVisibility.comment && (
                          <td className="py-0.5 px-1">
                            <Input
                              value={row.comments || ''}
                              onChange={(e) => handleDisbursementCommentChange(idx, e.target.value)}
                              onBlur={(e) => handleDisbursementCommentChange(idx, e.target.value)}
                              className="h-5 text-xs"
                              placeholder="Add comment..."
                            />
                          </td>
                        )}
                        <td className="py-0.5 px-1 text-center">
                          <div className="flex items-center gap-0.5 justify-center">
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleEditDisbursement(idx)} title="Edit">
                              <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleDeleteDisbursement(idx)} title="Delete">
                              <Trash2 className="h-2.5 w-2.5 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              );
            })()}
            {formData.disbursements.length === 0 && (
              <p className="text-xs text-muted-foreground italic py-1">No disbursements added.</p>
            )}
          </div>

          {/* Hidden fields for backward-compat calculations */}
          <div className="hidden">
            <RadioGroup value={formData.rateSelection} onValueChange={(val) => handleChange('rateSelection', val)}>
              <RadioGroupItem value="note_rate" id="rate-note" />
              <RadioGroupItem value="sold_rate" id="rate-sold" />
              <RadioGroupItem value="lender_rate" id="rate-lender" />
            </RadioGroup>
            <Input type="text" value={formData.percentOwned} disabled />
            <Input type="text" value={formData.regularPayment || ''} disabled />
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-4 py-2">
          <Button variant="outline" size="sm" onClick={handleCancel}>Cancel</Button>
          <Button size="sm" onClick={handleSaveClick} disabled={percentOwnedError || totalPercentError || !isFormFilled}>
            {isEditing ? 'Update Funding' : 'Save Funding'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {/* Lender Disbursement Modal - rendered outside funding dialog */}
    <LenderDisbursementModal
      open={disbursementModalOpen}
      onOpenChange={handleDisbursementModalClose}
      onSubmit={handleDisbursementModalSubmit}
      paymentShare={paymentShareNum}
      interestShare={interestShareNum}
      principalShare={principalShareNum}
      editData={editingDisbursementIdx !== null && formData.disbursements[editingDisbursementIdx] ? {
        accountId: formData.disbursements[editingDisbursementIdx].accountId,
        name: formData.disbursements[editingDisbursementIdx].name,
        debitPercent: formData.disbursements[editingDisbursementIdx].debitPercent,
        debitOf: formData.disbursements[editingDisbursementIdx].debitOf,
        plusAmount: formData.disbursements[editingDisbursementIdx].plusAmount,
        minimumAmount: formData.disbursements[editingDisbursementIdx].minimumAmount,
        maximumAmount: formData.disbursements[editingDisbursementIdx].maximumAmount || '',
        startDate: formData.disbursements[editingDisbursementIdx].startDate || '',
        debitThrough: formData.disbursements[editingDisbursementIdx].debitThrough,
        debitThroughDate: formData.disbursements[editingDisbursementIdx].debitThroughDate,
        debitThroughAmount: formData.disbursements[editingDisbursementIdx].debitThroughAmount,
        debitThroughPayments: formData.disbursements[editingDisbursementIdx].debitThroughPayments,
        from: formData.disbursements[editingDisbursementIdx].from as any,
        calculatedAmount: '',
        comments: formData.disbursements[editingDisbursementIdx].comments || '',
      } : null}
      isEditing={editingDisbursementIdx !== null}
    />
    <ModalSaveConfirmation open={showConfirm} onConfirm={handleConfirmSave} onCancel={() => setShowConfirm(false)} />
    <AlertDialog open={!!duplicateLender} onOpenChange={(o) => { if (!o) setDuplicateLender(null); }}>
      <AlertDialogContent className="z-[9999]">
        <AlertDialogHeader>
          <AlertDialogTitle>Duplicate Lender Funding</AlertDialogTitle>
          <AlertDialogDescription>
            ⚠️ Lender {duplicateLender?.lenderId}{duplicateLender?.lenderName ? ` (${duplicateLender.lenderName})` : ''} already has a funding record. Are you sure you want to add another funding entry for this lender?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => setDuplicateLender(null)}>Cancel</Button>
          <Button onClick={() => { setDuplicateLender(null); setShowConfirm(true); }}>Add Anyway</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
};

export default AddFundingModal;
