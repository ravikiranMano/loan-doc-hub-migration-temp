import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { logContactEvent } from '@/hooks/useContactEventJournal';
import { sanitizeInterestInput, normalizeInterestOnBlur } from '@/lib/interestValidation';
import { numericKeyDown, numericPaste, formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Plus, Filter, Download, Settings2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import SortableTableHead from '@/components/deal/SortableTableHead';
import { type SortDirection } from '@/hooks/useGridSortFilter';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { History, Pencil } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { format } from 'date-fns';

// Predefined Charge Types (no free text allowed) — values per screenshot dropdown
const CHARGE_TYPE_OPTIONS = [
  'Demand Fee',
  'Online Payment Fee',
  'Modification Doc Prep',
  'New Account Setup',
  'Origination Doc Prep',
  'Beneficiary Wire',
  'Wire Processing',
  'NSF Charge',
  'Account Close Out',
  'Pay By Phone',
  'Extension / Modification Doc Prep',
  'Account Maintenance',
  'Beneficiary Origination',
  'Administrative Services',
  'Professional Services',
  "Foreclosure Processing Fees - Trustee's Fees",
  'Setup Fee',
  '50110-Servicing Fee',
  'Holdback',
];

interface ChargeAdjustment {
  id: string;
  amount: number; // positive or negative — applied to Advanced By by default
  on_behalf_of_amount?: number; // optional split
  reference?: string;
  adjustment_date?: string;
  remarks: string;
  user: string;
  timestamp: string;
}

interface ChargeHistoryEntry {
  id: string;
  chargeId: string;
  action: 'created' | 'updated' | 'adjusted' | 'deleted' | 'paid';
  field?: string;
  oldValue?: string;
  newValue?: string;
  // Payment-style audit (per screenshot Charge History)
  payer_name?: string;
  reference?: string;
  amount?: number;
  principal?: number;
  interest?: number;
  payee?: string; // lender name receiving funds
  user: string;
  timestamp: string;
}

interface ChargeRow {
  id: string;
  // Charge Information
  date: string;            // Date of Charge (also "DATE" column)
  reference: string;       // REFERENCE
  charge_type?: string;    // TYPE
  description: string;     // DESCRIPTION
  interest_rate: string;   // INTEREST RATE
  interest_from: string;   // INTEREST FROM
  deferred: string;        // DEFERRED ("Yes"/"No"/"")
  notes?: string;
  // Loan Information
  loan_account: string;       // Account
  borrower_full_name?: string; // Borrower Full Name
  // Distribution
  advanced_by_account?: string;
  advanced_by_lender_name?: string;
  advanced_by_amount?: string;
  on_behalf_of_account?: string;
  on_behalf_of_lender_name?: string;
  on_behalf_of_amount?: string;
  distribute_between_all_lenders?: boolean;
  // Balances
  owed_to_account: string;     // OWED TO ACCOUNT
  original_balance?: string;   // ORIGINAL BALANCE — snapshot, never overwritten
  unpaid_balance: string;      // UNPAID BALANCE
  accrued_interest: string;    // ACCRUED INTEREST
  total_due: string;           // TOTAL DUE
  // Status / lifecycle
  paid?: boolean;
  adjustments?: ChargeAdjustment[];
}

const ALL_COLUMNS = [
  { id: 'date', label: 'DATE' },
  { id: 'reference', label: 'REFERENCE' },
  { id: 'charge_type', label: 'TYPE' },
  { id: 'description', label: 'DESCRIPTION' },
  { id: 'interest_rate', label: 'INTEREST RATE' },
  { id: 'interest_from', label: 'INTEREST FROM' },
  { id: 'deferred', label: 'DEFERRED' },
  { id: 'owed_to_account', label: 'OWED TO ACCOUNT' },
  { id: 'original_balance', label: 'ORIGINAL BALANCE' },
  { id: 'unpaid_balance', label: 'UNPAID BALANCE' },
  { id: 'accrued_interest', label: 'ACCRUED INTEREST' },
  { id: 'total_due', label: 'TOTAL DUE' },
];

const CURRENCY_COLS = new Set(['original_balance', 'unpaid_balance', 'accrued_interest', 'total_due']);

const EMPTY_CHARGE: Omit<ChargeRow, 'id'> = {
  date: '',
  reference: '',
  charge_type: '',
  description: '',
  interest_rate: '',
  interest_from: '',
  deferred: '',
  notes: '',
  loan_account: '',
  borrower_full_name: '',
  advanced_by_account: '',
  advanced_by_lender_name: '',
  advanced_by_amount: '',
  on_behalf_of_account: '',
  on_behalf_of_lender_name: '',
  on_behalf_of_amount: '',
  distribute_between_all_lenders: false,
  owed_to_account: '',
  original_balance: '',
  unpaid_balance: '',
  accrued_interest: '',
  total_due: '',
  paid: false,
  adjustments: [],
};

const parseMoney = (v: string | number | undefined): number => {
  if (v === undefined || v === null || v === '') return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
};

const sumAdjustments = (adjs?: ChargeAdjustment[]): number =>
  (adjs || []).reduce((s, a) => s + (Number(a.amount) || 0) + (Number(a.on_behalf_of_amount) || 0), 0);

const computeFinalUnpaid = (row: ChargeRow): number => {
  const original = parseMoney(row.original_balance || row.unpaid_balance);
  return original + sumAdjustments(row.adjustments);
};

const computeAmountOwedByBorrower = (advBy: string, onBehalf: string): number =>
  parseMoney(advBy) + parseMoney(onBehalf);

const fmtMoney = (n: number) =>
  `$${(isNaN(n) ? 0 : n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ─── Calculated read-only field derivations (Charges Grid) ───────────────────
// Deferred amount: when row.deferred flag is set, the charge amount is postponed
// per loan-terms/payment-schedule logic. Otherwise 0.
const isDeferredFlag = (v: string | undefined): boolean => {
  const s = String(v || '').trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1';
};
const computeDeferredAmount = (row: ChargeRow): number => {
  if (!isDeferredFlag(row.deferred)) return 0;
  // Deferred portion = original charge amount as scheduled to be postponed.
  return parseMoney(row.original_balance || row.unpaid_balance);
};

// Accrued Interest: simple-interest accrual on the charge principal from
// `interest_from` date (last accrual date) through today, using `interest_rate`
// (annual %). Falls back to 0 if any input is missing/invalid.
const parseGridDate = (s?: string): Date | null => {
  if (!s) return null;
  // Support MM/DD/YYYY and yyyy-MM-dd
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (mdy) {
    const d = new Date(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]));
    return isNaN(d.getTime()) ? null : d;
  }
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (ymd) {
    const d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};
const computeAccruedInterest = (row: ChargeRow): number => {
  const principal = parseMoney(row.original_balance || row.unpaid_balance);
  if (principal <= 0) return 0;
  const rate = parseFloat(String(row.interest_rate || '').replace(/[^0-9.\-]/g, ''));
  if (!isFinite(rate) || rate <= 0) return 0;
  const from = parseGridDate(row.interest_from) || parseGridDate(row.date);
  if (!from) return 0;
  const today = new Date();
  const days = Math.max(0, Math.floor((today.getTime() - from.getTime()) / 86400000));
  if (days <= 0) return 0;
  // Simple interest: P * (r/100) * (days/365)
  return principal * (rate / 100) * (days / 365);
};

// Unpaid Balance: Total Charges - Payments Received.
// Total Charges per row = original (or seeded unpaid) + cumulative adjustments.
// Payments Received = full original when row.paid, else 0 (no per-charge
// partial-payment table exists; matches existing data model).
const computeUnpaidBalance = (row: ChargeRow): number => {
  const totalCharges = parseMoney(row.original_balance || row.unpaid_balance) + sumAdjustments(row.adjustments);
  const payments = row.paid ? parseMoney(row.original_balance || row.unpaid_balance) : 0;
  return totalCharges - payments;
};

// Total Due: Charges + Accrued Interest + Unpaid Balances ± Adjustments - Deferred.
// "Charges" here = principal (original_balance). Adjustments are already in
// Unpaid Balance, so we don't double-count them.
const computeTotalDue = (row: ChargeRow): number => {
  const charges = parseMoney(row.original_balance || row.unpaid_balance);
  const accrued = computeAccruedInterest(row);
  const unpaid = computeUnpaidBalance(row);
  const deferred = computeDeferredAmount(row);
  return charges + accrued + unpaid - deferred;
};

// Owed to Account: portion of Total Due allocated to this lender's account
// based on the funding split captured on the charge (Advanced By + On Behalf Of
// over the same two amounts — i.e. this lender's share of the distribution).
// When no split exists, falls back to full Total Due.
const computeOwedToAccount = (row: ChargeRow): number => {
  const totalDue = computeTotalDue(row);
  const adv = parseMoney(row.advanced_by_amount);
  const ob = parseMoney(row.on_behalf_of_amount);
  const distTotal = adv + ob;
  if (distTotal <= 0) return totalDue;
  // This lender's share = Advanced By portion of the distribution
  const share = adv / distTotal;
  return totalDue * share;
};


interface LenderChargesProps {
  lenderId: string;
  contactDbId: string;
  disabled?: boolean;
}

const LenderCharges: React.FC<LenderChargesProps> = ({ contactDbId, disabled }) => {
  const [rows, setRows] = useState<ChargeRow[]>([]);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    new Set(ALL_COLUMNS.map(c => c.id))
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [showPaidCharges, setShowPaidCharges] = useState(false);

  // Add / Edit dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Omit<ChargeRow, 'id'>>(EMPTY_CHARGE);
  const [isSaving, setIsSaving] = useState(false);
  const [originalAmountFocused, setOriginalAmountFocused] = useState(false);

  // Adjustment + History state
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeChargeId, setActiveChargeId] = useState<string | null>(null);
  const [adjustAdvBy, setAdjustAdvBy] = useState<string>('');
  const [adjustOnBehalf, setAdjustOnBehalf] = useState<string>('');
  const [adjustReference, setAdjustReference] = useState<string>('');
  const [adjustDate, setAdjustDate] = useState<string>(format(new Date(), 'MM/dd/yyyy'));
  const [history, setHistory] = useState<ChargeHistoryEntry[]>([]);
  const [currentUserEmail, setCurrentUserEmail] = useState<string>('Unknown');

  // Resolve current user once for audit trail
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserEmail(data.user?.email || data.user?.id || 'Unknown');
    });
  }, []);

  // Migration helper: backwards-compatible field mapping for legacy rows
  const normalizeRow = (r: any): ChargeRow => ({
    id: r.id,
    date: r.date || '',
    reference: r.reference || '',
    charge_type: r.charge_type || '',
    description: r.description || '',
    interest_rate: r.interest_rate || '',
    interest_from: r.interest_from || '',
    deferred: r.deferred || '',
    notes: r.notes || '',
    loan_account: r.loan_account || '',
    borrower_full_name: r.borrower_full_name || '',
    advanced_by_account: r.advanced_by_account || '',
    advanced_by_lender_name: r.advanced_by_lender_name || '',
    advanced_by_amount: r.advanced_by_amount || '',
    on_behalf_of_account: r.on_behalf_of_account || '',
    on_behalf_of_lender_name: r.on_behalf_of_lender_name || '',
    on_behalf_of_amount: r.on_behalf_of_amount || '',
    distribute_between_all_lenders: !!r.distribute_between_all_lenders,
    owed_to_account: r.owed_to_account || r.owed_to_accounts || '',
    original_balance: r.original_balance !== undefined
      ? r.original_balance
      : (r.original_amount !== undefined ? r.original_amount : (r.unpaid_balance || '')),
    unpaid_balance: r.unpaid_balance || '',
    accrued_interest: r.accrued_interest || '',
    total_due: r.total_due !== undefined ? r.total_due : (r.total_due_to_you || ''),
    paid: !!r.paid,
    adjustments: Array.isArray(r.adjustments) ? r.adjustments : [],
  });

  // Load charges + history from contact_data on mount
  useEffect(() => {
    const loadCharges = async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('contact_data')
        .eq('id', contactDbId)
        .single();
      if (!error && data?.contact_data) {
        const cd = data.contact_data as Record<string, any>;
        if (Array.isArray(cd._charges)) {
          setRows((cd._charges as any[]).map(normalizeRow));
        }
        if (Array.isArray(cd._charges_history)) {
          setHistory(cd._charges_history as ChargeHistoryEntry[]);
        }
      }
    };
    if (contactDbId) loadCharges();
  }, [contactDbId]);

  const persistCharges = useCallback(async (updatedRows: ChargeRow[], updatedHistory?: ChargeHistoryEntry[]) => {
    setIsSaving(true);
    try {
      const { data: current, error: fetchErr } = await supabase
        .from('contacts')
        .select('contact_data')
        .eq('id', contactDbId)
        .single();
      if (fetchErr) throw fetchErr;

      const existingData = (current?.contact_data as Record<string, any>) || {};
      // Funding Grid sync: publish a denormalized funding view derived from final values
      const _funding_grid = updatedRows.map(r => ({
        charge_id: r.id,
        date: r.date,
        reference: r.reference,
        type: r.charge_type || '',
        description: r.description,
        // Calculated read-only fields — derived for funding-grid sync
        owed_to_account: computeOwedToAccount(r),
        original_balance: parseMoney(r.original_balance || r.unpaid_balance),
        unpaid_balance: computeUnpaidBalance(r),
        accrued_interest: computeAccruedInterest(r),
        total_due: computeTotalDue(r),
        deferred: computeDeferredAmount(r),
        amount_owed_by_borrower: computeAmountOwedByBorrower(r.advanced_by_amount || '', r.on_behalf_of_amount || ''),
        paid: !!r.paid,
      }));
      const merged: any = {
        ...existingData,
        _charges: updatedRows,
        _funding_grid,
      };
      if (updatedHistory) merged._charges_history = updatedHistory;

      const { error } = await supabase
        .from('contacts')
        .update({ contact_data: merged as any, updated_at: new Date().toISOString() })
        .eq('id', contactDbId);
      if (error) throw error;
    } catch (err: any) {
      console.error('Failed to save charges:', err);
      toast.error('Failed to save charge');
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [contactDbId]);

  const openAddDialog = () => {
    setEditingId(null);
    setDraft(EMPTY_CHARGE);
    setAddDialogOpen(true);
  };

  const openEditDialog = (row: ChargeRow) => {
    setEditingId(row.id);
    const { id, ...rest } = row;
    setDraft(rest);
    setAddDialogOpen(true);
  };

  const handleSaveCharge = useCallback(async () => {
    if (disabled) return;

    // Validate adjustment vs original (only on edit)
    if (editingId) {
      const original = parseMoney(draft.original_balance || draft.unpaid_balance);
      if (parseMoney(draft.unpaid_balance) > original && original > 0) {
        // Allow but warn (do not block) — original is preserved separately
      }
    }

    if (editingId) {
      const target = rows.find(r => r.id === editingId);
      if (!target) return;
      const updatedRow: ChargeRow = {
        ...draft,
        id: editingId,
        // Original balance must remain preserved
        original_balance: target.original_balance || target.unpaid_balance || draft.original_balance || draft.unpaid_balance,
        adjustments: target.adjustments || [],
      };
      const updatedRows = rows.map(r => r.id === editingId ? updatedRow : r);
      const histEntry: ChargeHistoryEntry = {
        id: crypto.randomUUID(),
        chargeId: editingId,
        action: 'updated',
        oldValue: target.description || target.charge_type || '',
        newValue: updatedRow.description || updatedRow.charge_type || '',
        user: currentUserEmail,
        timestamp: new Date().toISOString(),
      };
      const updatedHistory = [...history, histEntry];
      try {
        await persistCharges(updatedRows, updatedHistory);
        setRows(updatedRows);
        setHistory(updatedHistory);
        setAddDialogOpen(false);
        toast.success('Charge updated');
        logContactEvent(contactDbId, 'Charges', [{ fieldLabel: 'Charge Updated', oldValue: histEntry.oldValue || '', newValue: histEntry.newValue || '' }]);
      } catch { /* toasted */ }
      return;
    }

    // New charge
    const chargeId = crypto.randomUUID();
    const original = draft.original_balance || draft.unpaid_balance || '';
    const chargeWithId: ChargeRow = {
      ...draft,
      id: chargeId,
      original_balance: original,
      adjustments: [],
    };
    const updatedRows = [...rows, chargeWithId];
    const newHistoryEntry: ChargeHistoryEntry = {
      id: crypto.randomUUID(),
      chargeId,
      action: 'created',
      payer_name: chargeWithId.borrower_full_name || '',
      reference: 'Beginning Balance',
      amount: parseMoney(original),
      principal: parseMoney(original),
      interest: 0,
      payee: chargeWithId.advanced_by_lender_name || '',
      newValue: `${chargeWithId.charge_type || chargeWithId.description || 'Charge'} | $${original || '0'}`,
      user: currentUserEmail,
      timestamp: new Date().toISOString(),
    };
    const updatedHistory = [...history, newHistoryEntry];
    try {
      await persistCharges(updatedRows, updatedHistory);
      setRows(updatedRows);
      setHistory(updatedHistory);
      setDraft(EMPTY_CHARGE);
      setAddDialogOpen(false);
      toast.success('Charge added');
      logContactEvent(contactDbId, 'Charges', [{ fieldLabel: 'Charge Added', oldValue: '', newValue: chargeWithId.charge_type || chargeWithId.description || 'New charge' }]);
    } catch { /* toasted */ }
  }, [draft, editingId, rows, history, currentUserEmail, persistCharges, contactDbId, disabled]);

  const handleDeleteSelected = useCallback(async () => {
    if (disabled || selectedRows.size === 0) return;
    const updatedRows = rows.filter(r => !selectedRows.has(r.id));
    const deletionEntries: ChargeHistoryEntry[] = Array.from(selectedRows).map(cid => ({
      id: crypto.randomUUID(),
      chargeId: cid,
      action: 'deleted',
      oldValue: rows.find(r => r.id === cid)?.charge_type || rows.find(r => r.id === cid)?.description || '',
      user: currentUserEmail,
      timestamp: new Date().toISOString(),
    }));
    const updatedHistory = [...history, ...deletionEntries];
    try {
      await persistCharges(updatedRows, updatedHistory);
      setRows(updatedRows);
      setHistory(updatedHistory);
      setSelectedRows(new Set());
      toast.success(`${selectedRows.size} charge(s) deleted`);
      logContactEvent(contactDbId, 'Charges', [{ fieldLabel: 'Charges Deleted', oldValue: `${selectedRows.size} charge(s)`, newValue: '(deleted)' }]);
    } catch { /* toasted */ }
  }, [rows, selectedRows, history, currentUserEmail, persistCharges, contactDbId, disabled]);

  // Apply adjustment — preserves original_balance, appends to adjustments[]
  const handleApplyAdjustment = useCallback(async () => {
    if (disabled || !activeChargeId) return;
    const advAmt = parseFloat(adjustAdvBy || '0');
    const obAmt = parseFloat(adjustOnBehalf || '0');
    if ((isNaN(advAmt) || advAmt === 0) && (isNaN(obAmt) || obAmt === 0)) {
      toast.error('Enter a non-zero adjustment amount');
      return;
    }
    const target = rows.find(r => r.id === activeChargeId);
    if (!target) return;

    const original = parseMoney(target.original_balance || target.unpaid_balance);
    const totalAdj = (isNaN(advAmt) ? 0 : advAmt) + (isNaN(obAmt) ? 0 : obAmt);
    if (Math.abs(totalAdj) > original && original > 0 && totalAdj < 0) {
      toast.error('Adjustment cannot exceed original balance');
      return;
    }

    const newAdjustment: ChargeAdjustment = {
      id: crypto.randomUUID(),
      amount: isNaN(advAmt) ? 0 : advAmt,
      on_behalf_of_amount: isNaN(obAmt) ? 0 : obAmt,
      reference: adjustReference.trim(),
      adjustment_date: adjustDate,
      remarks: adjustReference.trim(),
      user: currentUserEmail,
      timestamp: new Date().toISOString(),
    };
    const previousFinal = computeFinalUnpaid(target);
    const updatedTarget: ChargeRow = {
      ...target,
      adjustments: [...(target.adjustments || []), newAdjustment],
    };
    const newFinal = computeFinalUnpaid(updatedTarget);
    const updatedRows = rows.map(r => r.id === activeChargeId ? updatedTarget : r);
    const histEntry: ChargeHistoryEntry = {
      id: crypto.randomUUID(),
      chargeId: activeChargeId,
      action: 'adjusted',
      payer_name: target.borrower_full_name || '',
      reference: adjustReference.trim() || 'TR-CH',
      amount: totalAdj,
      principal: totalAdj,
      interest: 0,
      payee: target.advanced_by_lender_name || '',
      field: 'final_amount',
      oldValue: fmtMoney(previousFinal),
      newValue: `${fmtMoney(newFinal)} (adj ${totalAdj >= 0 ? '+' : ''}${totalAdj.toFixed(2)})`,
      user: currentUserEmail,
      timestamp: new Date().toISOString(),
    };
    const updatedHistory = [...history, histEntry];
    try {
      await persistCharges(updatedRows, updatedHistory);
      setRows(updatedRows);
      setHistory(updatedHistory);
      setAdjustAdvBy('');
      setAdjustOnBehalf('');
      setAdjustReference('');
      setAdjustOpen(false);
      toast.success('Adjustment applied');
      logContactEvent(contactDbId, 'Charges', [{ fieldLabel: 'Charge Adjusted', oldValue: histEntry.oldValue || '', newValue: histEntry.newValue || '' }]);
    } catch { /* toasted */ }
  }, [activeChargeId, adjustAdvBy, adjustOnBehalf, adjustReference, adjustDate, rows, history, currentUserEmail, persistCharges, contactDbId, disabled]);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : sortDir === 'desc' ? null : 'asc');
      if (sortDir === 'desc') setSortCol(null);
    } else { setSortCol(col); setSortDir('asc'); }
  };

  const activeColumns = useMemo(
    () => ALL_COLUMNS.filter(c => visibleColumns.has(c.id)),
    [visibleColumns]
  );

  const filtered = useMemo(() => {
    let result = rows.filter(r => showPaidCharges ? true : !r.paid);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q)));
    }
    if (sortCol && sortDir) {
      result = [...result].sort((a, b) => {
        const av = String((a as any)[sortCol] || '');
        const bv = String((b as any)[sortCol] || '');
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    return result;
  }, [rows, search, sortCol, sortDir, showPaidCharges]);

  // Totals row (per screenshot — totals of unpaid active bills)
  const totals = useMemo(() => {
    const acc = {
      original_balance: 0,
      unpaid_balance: 0,
      accrued_interest: 0,
      total_due: 0,
      owed_to_account: 0,
      deferred: 0,
    };
    filtered.forEach(r => {
      acc.original_balance += parseMoney(r.original_balance || r.unpaid_balance);
      acc.unpaid_balance += computeUnpaidBalance(r);
      acc.accrued_interest += computeAccruedInterest(r);
      acc.total_due += computeTotalDue(r);
      acc.owed_to_account += computeOwedToAccount(r);
      acc.deferred += computeDeferredAmount(r);
    });
    return acc;
  }, [filtered]);


  const toggleRow = (id: string) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedRows.size === filtered.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(filtered.map(r => r.id)));
    }
  };

  const toggleColumn = (colId: string) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(colId)) next.delete(colId); else next.add(colId);
      return next;
    });
  };

  const handleExport = () => {
    const headers = activeColumns.map(c => c.label).join(',');
    const csvRows = filtered.map(r =>
      activeColumns.map(c => {
        if (c.id === 'unpaid_balance') return computeUnpaidBalance(r).toFixed(2);
        if (c.id === 'total_due') return computeTotalDue(r).toFixed(2);
        if (c.id === 'accrued_interest') return computeAccruedInterest(r).toFixed(2);
        if (c.id === 'owed_to_account') return computeOwedToAccount(r).toFixed(2);
        if (c.id === 'deferred') return isDeferredFlag(r.deferred) ? 'Yes' : 'No';
        return (r as any)[c.id] || '';
      }).join(',')
    );
    const csv = [headers, ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lender_charges.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Helpers for the dialog grid
  const setDraftField = (k: keyof ChargeRow, v: any) => setDraft(prev => ({ ...prev, [k]: v } as any));
  const amountOwedByBorrower = computeAmountOwedByBorrower(draft.advanced_by_amount || '', draft.on_behalf_of_amount || '');

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h4 className="text-lg font-semibold text-foreground">Charges</h4>
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1 h-8 text-xs">
                <Settings2 className="h-3.5 w-3.5" /> Columns
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-3" align="end">
              <div className="space-y-2">
                <span className="text-sm font-medium">Toggle Columns</span>
                {ALL_COLUMNS.map(c => (
                  <div key={c.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`col-${c.id}`}
                      checked={visibleColumns.has(c.id)}
                      onCheckedChange={() => toggleColumn(c.id)}
                    />
                    <label htmlFor={`col-${c.id}`} className="text-xs cursor-pointer">{c.label}</label>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          {!disabled && selectedRows.size > 0 && (
            <Button size="sm" variant="destructive" className="gap-1 h-8 text-xs" onClick={handleDeleteSelected}>
              Delete ({selectedRows.size})
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-1 h-8 text-xs"
            onClick={() => { setActiveChargeId(null); setHistoryOpen(true); }}
          >
            <History className="h-3.5 w-3.5" /> History
          </Button>
          {!disabled && (
            <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" onClick={openAddDialog}>
              <Plus className="h-3.5 w-3.5" /> Add Charge
            </Button>
          )}
        </div>
      </div>

      {/* Toolbar row */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-7 h-8 w-[180px] text-xs" />
        </div>
        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1 h-8 text-xs">
              <Filter className="h-3.5 w-3.5" /> Filters
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3" align="start">
            <p className="text-xs text-muted-foreground">No filters configured yet.</p>
          </PopoverContent>
        </Popover>
        <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" onClick={handleExport}>
          <Download className="h-3.5 w-3.5" /> Export
        </Button>
        <div className="flex items-center gap-2 ml-auto">
          <Checkbox
            id="show-paid-charges"
            checked={showPaidCharges}
            onCheckedChange={(c) => setShowPaidCharges(!!c)}
          />
          <label htmlFor="show-paid-charges" className="text-xs cursor-pointer select-none">Show Paid Charges</label>
        </div>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              {!disabled && (
                <TableHead className="w-10 px-2">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selectedRows.size === filtered.length}
                    onChange={toggleAll}
                    className="rounded border-input"
                  />
                </TableHead>
              )}
              {activeColumns.map(c => (
                <SortableTableHead
                  key={c.id}
                  columnId={c.id}
                  label={c.label}
                  sortColumnId={sortCol}
                  sortDirection={sortDir}
                  onSort={handleSort}
                  className="whitespace-nowrap text-xs"
                />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={activeColumns.length + (disabled ? 0 : 1)} className="text-center py-8 text-muted-foreground text-sm">
                  No charge records found.
                </TableCell>
              </TableRow>
            ) : filtered.map(r => (
              <TableRow
                key={r.id}
                className={`${selectedRows.has(r.id) ? 'bg-primary/5' : ''} cursor-pointer hover:bg-muted/40`}
                onClick={() => {
                  if (disabled) return;
                  openEditDialog(r);
                }}
              >
                {!disabled && (
                  <TableCell className="w-10 px-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedRows.has(r.id)}
                      onChange={() => toggleRow(r.id)}
                      className="rounded border-input"
                    />
                  </TableCell>
                )}
                {activeColumns.map(c => {
                  let raw: any = (r as any)[c.id];
                  // Calculated read-only fields — derived from existing data
                  if (c.id === 'unpaid_balance') {
                    raw = computeUnpaidBalance(r).toFixed(2);
                  } else if (c.id === 'total_due') {
                    raw = computeTotalDue(r).toFixed(2);
                  } else if (c.id === 'accrued_interest') {
                    raw = computeAccruedInterest(r).toFixed(2);
                  } else if (c.id === 'owed_to_account') {
                    raw = computeOwedToAccount(r).toFixed(2);
                  } else if (c.id === 'deferred') {
                    raw = isDeferredFlag(r.deferred) ? 'Yes' : 'No';
                  } else if (c.id === 'original_balance') {
                    raw = r.original_balance || r.unpaid_balance || '';
                  }
                  let display = raw || '-';
                  if (raw && CURRENCY_COLS.has(c.id)) {
                    const n = parseMoney(raw);
                    display = fmtMoney(n);
                  } else if (raw && c.id === 'owed_to_account') {
                    const n = parseMoney(raw);
                    display = fmtMoney(n);
                  } else if (raw && c.id === 'interest_rate') {
                    display = `${raw}%`;
                  }
                  return (
                    <TableCell key={c.id} className="whitespace-nowrap text-xs">
                      {display}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            {filtered.length > 0 && (
              <TableRow className="bg-muted/40 font-semibold">
                {!disabled && <TableCell />}
                {activeColumns.map(c => {
                  if (c.id === 'original_balance') return <TableCell key={c.id} className="text-xs">{fmtMoney(totals.original_balance)}</TableCell>;
                  if (c.id === 'unpaid_balance') return <TableCell key={c.id} className="text-xs">{fmtMoney(totals.unpaid_balance)}</TableCell>;
                  if (c.id === 'accrued_interest') return <TableCell key={c.id} className="text-xs">{fmtMoney(totals.accrued_interest)}</TableCell>;
                  if (c.id === 'total_due') return <TableCell key={c.id} className="text-xs">{fmtMoney(totals.total_due)}</TableCell>;
                  if (c.id === 'owed_to_account') return <TableCell key={c.id} className="text-xs">{fmtMoney(totals.owed_to_account)}</TableCell>;
                  return <TableCell key={c.id} />;
                })}
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add / Edit Charge Dialog — layout per screenshot */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Charge' : 'New Charge'}</DialogTitle>
          </DialogHeader>

          {/* Loan Information */}
          <div className="space-y-2">
            <div className="text-sm font-semibold text-primary border-b pb-1">Loan Information</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Account</Label>
                <Input
                  className="h-8 text-xs"
                  value={draft.loan_account || ''}
                  onChange={e => setDraftField('loan_account', e.target.value)}
                  placeholder="Account"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Borrower Full Name</Label>
                <Input
                  className="h-8 text-xs"
                  value={draft.borrower_full_name || ''}
                  onChange={e => setDraftField('borrower_full_name', e.target.value)}
                  placeholder="Borrower Full Name"
                />
              </div>
            </div>
          </div>

          {/* Charge Information */}
          <div className="space-y-2">
            <div className="text-sm font-semibold text-primary border-b pb-1">Charge Information</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Date of Charge</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full h-8 text-xs justify-start font-normal">
                      {draft.date || <span className="text-muted-foreground">mm/dd/yyyy</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 !z-[9999]" align="start">
                    <EnhancedCalendar
                      mode="single"
                      selected={draft.date ? new Date(draft.date) : undefined}
                      onSelect={(date) => setDraftField('date', date ? format(date, 'MM/dd/yyyy') : '')}
                      onClear={() => setDraftField('date', '')}
                      onToday={() => setDraftField('date', format(new Date(), 'MM/dd/yyyy'))}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Interest From</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full h-8 text-xs justify-start font-normal">
                      {draft.interest_from || <span className="text-muted-foreground">mm/dd/yyyy</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 !z-[9999]" align="start">
                    <EnhancedCalendar
                      mode="single"
                      selected={draft.interest_from ? new Date(draft.interest_from) : undefined}
                      onSelect={(date) => setDraftField('interest_from', date ? format(date, 'MM/dd/yyyy') : '')}
                      onClear={() => setDraftField('interest_from', '')}
                      onToday={() => setDraftField('interest_from', format(new Date(), 'MM/dd/yyyy'))}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Reference</Label>
                <Input
                  className="h-8 text-xs"
                  value={draft.reference || ''}
                  onChange={e => setDraftField('reference', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-primary">Charge Type</Label>
                <Select
                  value={draft.charge_type || ''}
                  onValueChange={(v) => setDraftField('charge_type', v)}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent className="z-[9999]">
                    {CHARGE_TYPE_OPTIONS.map(opt => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Original Amount</Label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                  <Input
                    className="h-8 text-xs pl-6"
                    value={
                      originalAmountFocused
                        ? (draft.original_balance || '')
                        : formatCurrencyDisplay(draft.original_balance || '')
                    }
                    onFocus={() => setOriginalAmountFocused(true)}
                    onBlur={() => {
                      setOriginalAmountFocused(false);
                      // Normalize stored value to raw numeric (no commas)
                      const raw = unformatCurrencyDisplay(draft.original_balance || '');
                      if (raw !== (draft.original_balance || '')) {
                        setDraftField('original_balance', raw);
                        if (!editingId) setDraftField('unpaid_balance', raw);
                      }
                    }}
                    onKeyDown={numericKeyDown}
                    onPaste={(e) => numericPaste(e, (val) => {
                      setDraftField('original_balance', val);
                      if (!editingId) setDraftField('unpaid_balance', val);
                    })}
                    onChange={e => {
                      const raw = unformatCurrencyDisplay(e.target.value);
                      setDraftField('original_balance', raw);
                      // also seed unpaid_balance on creation
                      if (!editingId) setDraftField('unpaid_balance', raw);
                    }}
                    placeholder="0.00"
                    inputMode="decimal"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Description</Label>
                <Input
                  className="h-8 text-xs"
                  value={draft.description || ''}
                  onChange={e => setDraftField('description', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Interest Rate</Label>
                <div className="flex items-center gap-1">
                  <Input
                    className="h-8 text-xs"
                    value={draft.interest_rate || ''}
                    onChange={e => setDraftField('interest_rate', sanitizeInterestInput(e.target.value))}
                    onBlur={() => { const v = normalizeInterestOnBlur(draft.interest_rate || '', 3); if (v !== (draft.interest_rate || '')) setDraftField('interest_rate', v); }}
                    placeholder="0.000"
                    inputMode="decimal"
                  />
                  <span className="text-muted-foreground text-xs">%</span>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Input
                  className="h-8 text-xs"
                  value={draft.notes || ''}
                  onChange={e => setDraftField('notes', e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 col-span-2">
                <Checkbox
                  id="charge-deferred"
                  checked={draft.deferred === 'Yes' || draft.deferred === 'true'}
                  onCheckedChange={(c) => setDraftField('deferred', c ? 'Yes' : 'No')}
                />
                <label htmlFor="charge-deferred" className="text-xs cursor-pointer select-none">Deferred</label>
              </div>
            </div>
          </div>

          {/* Distribution */}
          <div className="space-y-2">
            <div className="text-sm font-semibold text-primary border-b pb-1">Distribution</div>
            <div className="border border-border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs w-[110px]"></TableHead>
                    <TableHead className="text-xs">Account</TableHead>
                    <TableHead className="text-xs">Lender Name</TableHead>
                    <TableHead className="text-xs w-[140px]">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-xs font-medium">Advanced By</TableCell>
                    <TableCell>
                      <Input
                        className="h-7 text-xs"
                        value={draft.advanced_by_account || ''}
                        onChange={e => setDraftField('advanced_by_account', e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-7 text-xs"
                        value={draft.advanced_by_lender_name || ''}
                        onChange={e => setDraftField('advanced_by_lender_name', e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                        <Input
                          className="h-7 text-xs pl-5"
                          value={draft.advanced_by_amount || ''}
                          onChange={e => setDraftField('advanced_by_amount', e.target.value)}
                          inputMode="decimal"
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs font-medium">On Behalf Of</TableCell>
                    <TableCell>
                      <Input
                        className="h-7 text-xs"
                        value={draft.on_behalf_of_account || ''}
                        onChange={e => setDraftField('on_behalf_of_account', e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-7 text-xs"
                        value={draft.on_behalf_of_lender_name || ''}
                        onChange={e => setDraftField('on_behalf_of_lender_name', e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                        <Input
                          className="h-7 text-xs pl-5"
                          value={draft.on_behalf_of_amount || ''}
                          onChange={e => setDraftField('on_behalf_of_amount', e.target.value)}
                          inputMode="decimal"
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="dist-all-lenders"
                  checked={!!draft.distribute_between_all_lenders}
                  onCheckedChange={(c) => setDraftField('distribute_between_all_lenders', !!c)}
                />
                <label htmlFor="dist-all-lenders" className="text-xs cursor-pointer select-none">Distribute Between All Lenders</label>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">Amount Owed by Borrower:</span>
                <span className="text-xs text-muted-foreground">$</span>
                <span className="text-xs font-semibold tabular-nums w-20 text-right">{amountOwedByBorrower.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveCharge} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'OK'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Charge Adjustment Dialog */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Charge Adjustment</DialogTitle>
          </DialogHeader>
          {(() => {
            const target = rows.find(r => r.id === activeChargeId);
            if (!target) return null;
            const advCurrent = parseMoney(target.advanced_by_amount);
            const obCurrent = parseMoney(target.on_behalf_of_amount);
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-sm font-semibold text-primary border-b pb-1">Loan Information</div>
                    <div className="space-y-1">
                      <Label className="text-xs">Account</Label>
                      <Input className="h-8 text-xs" value={target.loan_account || ''} disabled />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Borrower Full Name</Label>
                      <Input className="h-8 text-xs" value={target.borrower_full_name || ''} disabled />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-semibold text-primary border-b pb-1">Adjustment Information</div>
                    <div className="space-y-1">
                      <Label className="text-xs">Adjustment Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full h-8 text-xs justify-start font-normal">
                            {adjustDate || <span className="text-muted-foreground">mm/dd/yyyy</span>}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 !z-[9999]" align="start">
                          <EnhancedCalendar
                            mode="single"
                            selected={adjustDate ? new Date(adjustDate) : undefined}
                            onSelect={(date) => setAdjustDate(date ? format(date, 'MM/dd/yyyy') : '')}
                            onClear={() => setAdjustDate('')}
                            onToday={() => setAdjustDate(format(new Date(), 'MM/dd/yyyy'))}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Reference</Label>
                      <Input
                        className="h-8 text-xs"
                        value={adjustReference}
                        onChange={(e) => setAdjustReference(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="border border-border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/70">
                        <TableHead colSpan={4} className="text-xs text-center font-semibold">Adjustments</TableHead>
                      </TableRow>
                      <TableRow className="bg-muted/40">
                        <TableHead className="text-xs w-[110px]"></TableHead>
                        <TableHead className="text-xs">Account</TableHead>
                        <TableHead className="text-xs">Current</TableHead>
                        <TableHead className="text-xs">Adjustment</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="text-xs font-medium">Advanced By</TableCell>
                        <TableCell>
                          <Input className="h-7 text-xs" value={`${target.advanced_by_account || ''}${target.advanced_by_lender_name ? '-' + target.advanced_by_lender_name : ''}`} disabled />
                        </TableCell>
                        <TableCell>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                            <Input className="h-7 text-xs pl-5 text-right" value={advCurrent.toFixed(2)} disabled />
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                            <Input
                              className="h-7 text-xs pl-5 text-right"
                              value={adjustAdvBy}
                              onChange={(e) => setAdjustAdvBy(e.target.value)}
                              inputMode="decimal"
                              placeholder="0.00"
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-xs font-medium">On Behalf Of</TableCell>
                        <TableCell>
                          <Input className="h-7 text-xs" value={`${target.on_behalf_of_account || ''}${target.on_behalf_of_lender_name ? '-' + target.on_behalf_of_lender_name : ''}`} disabled />
                        </TableCell>
                        <TableCell>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                            <Input className="h-7 text-xs pl-5 text-right" value={obCurrent.toFixed(2)} disabled />
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                            <Input
                              className="h-7 text-xs pl-5 text-right"
                              value={adjustOnBehalf}
                              onChange={(e) => setAdjustOnBehalf(e.target.value)}
                              inputMode="decimal"
                              placeholder="0.00"
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                      <TableRow className="bg-muted/20">
                        <TableCell />
                        <TableCell />
                        <TableCell className="text-xs text-right font-semibold">${(advCurrent + obCurrent).toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-right font-semibold">
                          ${((parseFloat(adjustAdvBy) || 0) + (parseFloat(adjustOnBehalf) || 0)).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setHistoryOpen(true); setAdjustOpen(false); }}
              className="gap-1"
            >
              <History className="h-3.5 w-3.5" /> View History
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAdjustOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleApplyAdjustment} disabled={isSaving || disabled}>
              <Pencil className="h-3.5 w-3.5 mr-1" /> OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Charge History Dialog — payment-style ledger per screenshot */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Charge History</DialogTitle>
          </DialogHeader>
          {(() => {
            const target = activeChargeId ? rows.find(r => r.id === activeChargeId) : null;
            const filteredHist = activeChargeId
              ? history.filter(h => h.chargeId === activeChargeId)
              : history;
            const sorted = [...filteredHist].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
            const advLender = target?.advanced_by_lender_name || 'Advanced By';
            const obLender = target?.on_behalf_of_lender_name || 'N/A';
            const advTotalP = sorted.reduce((s, h) => s + (h.principal || 0), 0);
            const advTotalI = sorted.reduce((s, h) => s + (h.interest || 0), 0);
            return (
              <div className="space-y-2">
                {target && (
                  <div className="text-sm font-semibold text-primary border-b pb-1">{target.charge_type || target.description}</div>
                )}
                <div className="border border-border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead className="text-xs" colSpan={4}></TableHead>
                        <TableHead className="text-xs text-center" colSpan={2}>{advLender}</TableHead>
                        <TableHead className="text-xs text-center" colSpan={2}>{obLender}</TableHead>
                      </TableRow>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-xs">DATE</TableHead>
                        <TableHead className="text-xs">REFERENCE</TableHead>
                        <TableHead className="text-xs">PAYER NAME</TableHead>
                        <TableHead className="text-xs">AMOUNT</TableHead>
                        <TableHead className="text-xs">PRINCIPAL</TableHead>
                        <TableHead className="text-xs">INTEREST</TableHead>
                        <TableHead className="text-xs">PRINCIPAL</TableHead>
                        <TableHead className="text-xs">INTEREST</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sorted.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-6 text-muted-foreground text-xs">
                            No history records yet.
                          </TableCell>
                        </TableRow>
                      ) : sorted.map(h => (
                        <TableRow key={h.id}>
                          <TableCell className="text-xs whitespace-nowrap">{new Date(h.timestamp).toLocaleDateString('en-US')}</TableCell>
                          <TableCell className="text-xs">{h.reference || h.action}</TableCell>
                          <TableCell className="text-xs">{h.payer_name || h.user}</TableCell>
                          <TableCell className="text-xs">{h.amount !== undefined ? `${h.amount < 0 ? '(' : ''}$${Math.abs(h.amount).toFixed(2)}${h.amount < 0 ? ')' : ''}` : (h.newValue || '—')}</TableCell>
                          <TableCell className="text-xs">{h.principal !== undefined ? `${h.principal < 0 ? '(' : ''}$${Math.abs(h.principal).toFixed(2)}${h.principal < 0 ? ')' : ''}` : '—'}</TableCell>
                          <TableCell className="text-xs">{h.interest !== undefined ? `$${h.interest.toFixed(2)}` : '—'}</TableCell>
                          <TableCell className="text-xs">$0.00</TableCell>
                          <TableCell className="text-xs">$0.00</TableCell>
                        </TableRow>
                      ))}
                      {sorted.length > 0 && (
                        <TableRow className="bg-muted/30 font-semibold">
                          <TableCell colSpan={4} />
                          <TableCell className="text-xs">${advTotalP.toFixed(2)}</TableCell>
                          <TableCell className="text-xs">${advTotalI.toFixed(2)}</TableCell>
                          <TableCell className="text-xs">$0.00</TableCell>
                          <TableCell className="text-xs">$0.00</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => window.print()}>Print</Button>
            <Button size="sm" variant="outline" onClick={() => setHistoryOpen(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LenderCharges;
