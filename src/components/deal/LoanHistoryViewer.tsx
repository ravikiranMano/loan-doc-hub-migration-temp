import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  Pencil, Trash2, MoreHorizontal, Printer, Download, Settings2, RefreshCw,
  ChevronDown, ChevronUp, ChevronsUpDown, History, Plus,
} from 'lucide-react';
import { format, startOfYear, startOfMonth, startOfQuarter, subYears, subMonths, endOfMonth, endOfYear } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { GridExportDialog, type ExportColumn } from './GridExportDialog';

// ===== Types =====
interface LoanHistoryEntry {
  id: string;
  deal_id: string;
  date_received: string | null;
  date_due: string | null;
  reference: string | null;
  payment_code: string | null;
  total_amount_received: number;
  applied_to_interest: number;
  applied_to_principal: number;
  applied_to_late_charges: number;
  applied_to_reserve: number;
  applied_to_impound: number;
  prepayment_penalty: number;
  charges_principal: number;
  charges_interest: number;
  fees_paid_to_broker: number;
  fees_paid_to_lenders: number;
  description: string | null;
  created_at: string;
}

interface LoanHistoryViewerProps {
  dealId: string;
  disabled?: boolean;
}

const PAYMENT_CODES = [
  'RegPmt', 'Oth', 'PAYMENT_REV', 'PAYMENT_VOID', 'PAYMENT_NONCASH', 'NSF',
];

const DATE_FILTERS = [
  { value: 'all', label: 'All Dates' },
  { value: 'ytd', label: 'Year to Date' },
  { value: 'qtd', label: 'Quarter to Date' },
  { value: 'mtd', label: 'Month to Date' },
  { value: 'last_year', label: 'Last Year' },
  { value: 'last_month', label: 'Last Month' },
];

// ===== Helpers =====
const num = (v: any): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
};

const isNegativeRow = (code: string | null) =>
  code === 'PAYMENT_REV' || code === 'PAYMENT_VOID';

const fmtCurrency = (v: number | null | undefined, code?: string | null): string => {
  const n = num(v);
  if (n === 0) return '$0.00';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (isNegativeRow(code || null) || n < 0) return `($${abs})`;
  return `$${abs}`;
};

const fmtDate = (v: string | null): string => {
  if (!v) return '—';
  try { return format(new Date(v + 'T00:00:00'), 'M/d/yyyy'); } catch { return v; }
};

const getDateRange = (filter: string): { from: Date | null; to: Date | null } => {
  const now = new Date();
  switch (filter) {
    case 'ytd': return { from: startOfYear(now), to: now };
    case 'qtd': return { from: startOfQuarter(now), to: now };
    case 'mtd': return { from: startOfMonth(now), to: now };
    case 'last_year': {
      const ly = subYears(now, 1);
      return { from: startOfYear(ly), to: endOfYear(ly) };
    }
    case 'last_month': {
      const lm = subMonths(now, 1);
      return { from: startOfMonth(lm), to: endOfMonth(lm) };
    }
    default: return { from: null, to: null };
  }
};

// ===== Column Definitions =====
const ALL_COLUMNS = [
  { id: 'date_received', label: 'Date Received', sticky: true, width: 120 },
  { id: 'date_due', label: 'Date Due', sticky: true, width: 110 },
  { id: 'reference', label: 'Reference', sticky: true, width: 110 },
  { id: 'payment_code', label: 'Payment Code', sticky: false, width: 130 },
  { id: 'total_amount_received', label: 'Total Amount Received', sticky: false, width: 150, money: true },
  { id: 'applied_to_interest', label: 'Applied To Interest', sticky: false, width: 140, money: true },
  { id: 'applied_to_principal', label: 'Applied To Principal', sticky: false, width: 140, money: true },
  { id: 'applied_to_late_charges', label: 'Applied To Late Charges', sticky: false, width: 150, money: true },
  { id: 'applied_to_reserve', label: 'Applied To Reserve', sticky: false, width: 140, money: true },
  { id: 'applied_to_impound', label: 'Applied To Impound', sticky: false, width: 140, money: true },
  { id: 'prepayment_penalty', label: 'Prepayment Penalty', sticky: false, width: 140, money: true },
  { id: 'fees_paid_to_broker', label: 'Fees Paid To Broker', sticky: false, width: 140, money: true },
  { id: 'fees_paid_to_lenders', label: 'Fees Paid To Lenders', sticky: false, width: 140, money: true },
];

const EXPORT_COLUMNS: ExportColumn[] = ALL_COLUMNS.map(c => ({ id: c.id, label: c.label }));

// ===== Default form =====
const emptyForm = (): Partial<LoanHistoryEntry> => ({
  date_received: format(new Date(), 'yyyy-MM-dd'),
  date_due: null,
  reference: '',
  payment_code: 'RegPmt',
  total_amount_received: 0,
  applied_to_interest: 0,
  applied_to_principal: 0,
  applied_to_late_charges: 0,
  applied_to_reserve: 0,
  applied_to_impound: 0,
  prepayment_penalty: 0,
  charges_principal: 0,
  charges_interest: 0,
  fees_paid_to_broker: 0,
  fees_paid_to_lenders: 0,
  description: '',
});

// ===== Main Component =====
export const LoanHistoryViewer: React.FC<LoanHistoryViewerProps> = ({ dealId, disabled = false }) => {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [dateFilter, setDateFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'date_received', desc: true }]);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(
    () => Object.fromEntries(ALL_COLUMNS.map(c => [c.id, true]))
  );

  // modals
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [nsfOpen, setNsfOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [form, setForm] = useState<Partial<LoanHistoryEntry>>(emptyForm());
  const [notesText, setNotesText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const { data: entries = [], isLoading, refetch } = useQuery({
    queryKey: ['loan-history', dealId],
    enabled: !!dealId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loan_history')
        .select('*')
        .eq('deal_id', dealId)
        .order('date_received', { ascending: false });
      if (error) throw error;
      return (data || []) as LoanHistoryEntry[];
    },
  });

  // Date filter
  const filteredEntries = useMemo(() => {
    const { from, to } = getDateRange(dateFilter);
    if (!from || !to) return entries;
    return entries.filter(e => {
      if (!e.date_received) return false;
      const d = new Date(e.date_received + 'T00:00:00');
      return d >= from && d <= to;
    });
  }, [entries, dateFilter]);

  const selectedRow = useMemo(
    () => entries.find(e => e.id === selectedId) || null,
    [entries, selectedId]
  );

  // Totals
  const totals = useMemo(() => {
    const sum = (k: keyof LoanHistoryEntry) =>
      filteredEntries.reduce((acc, e) => {
        const sign = isNegativeRow(e.payment_code) ? -1 : 1;
        return acc + sign * num(e[k]);
      }, 0);
    return {
      total_amount_received: sum('total_amount_received'),
      applied_to_interest: sum('applied_to_interest'),
      applied_to_principal: sum('applied_to_principal'),
      applied_to_late_charges: sum('applied_to_late_charges'),
      applied_to_reserve: sum('applied_to_reserve'),
      applied_to_impound: sum('applied_to_impound'),
      prepayment_penalty: sum('prepayment_penalty'),
      fees_paid_to_broker: sum('fees_paid_to_broker'),
      fees_paid_to_lenders: sum('fees_paid_to_lenders'),
    };
  }, [filteredEntries]);

  // ===== Column defs (tanstack) =====
  const columns = useMemo<ColumnDef<LoanHistoryEntry>[]>(() => ALL_COLUMNS.map(c => ({
    id: c.id,
    accessorKey: c.id as keyof LoanHistoryEntry,
    header: c.label,
    cell: (info) => {
      const row = info.row.original;
      const v = info.getValue();
      if (c.id === 'date_received' || c.id === 'date_due') return fmtDate(v as any);
      if (c.id === 'reference') {
        const isNonCash = row.payment_code === 'PAYMENT_NONCASH';
        return <span className={`font-mono ${isNonCash ? 'italic' : ''}`}>{(v as any) || '—'}</span>;
      }
      if (c.id === 'payment_code') {
        const code = (v as string) || '';
        const cls = code === 'RegPmt'
          ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
          : code === 'Oth'
          ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'
          : code === 'NSF'
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
          : isNegativeRow(code)
          ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
          : 'bg-muted text-muted-foreground';
        return code ? <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{code}</span> : '—';
      }
      if (c.money) {
        const isNeg = isNegativeRow(row.payment_code);
        return (
          <span className={`font-mono ${isNeg ? 'text-red-600 dark:text-red-400' : ''}`}>
            {fmtCurrency(v as any, row.payment_code)}
          </span>
        );
      }
      return (v as any) ?? '—';
    },
  })), []);

  const visibleColumns = useMemo(
    () => columns.filter(c => columnVisibility[c.id as string] !== false),
    [columns, columnVisibility]
  );

  const table = useReactTable({
    data: filteredEntries,
    columns: visibleColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // ===== Sticky offset calc =====
  const stickyOffsets = useMemo(() => {
    const offsets: Record<string, number> = {};
    let acc = 0;
    for (const c of ALL_COLUMNS) {
      if (!c.sticky) break;
      if (columnVisibility[c.id] === false) continue;
      offsets[c.id] = acc;
      acc += c.width;
    }
    return offsets;
  }, [columnVisibility]);

  const isStickyCol = (id: string) => ALL_COLUMNS.find(c => c.id === id)?.sticky === true;
  const colWidth = (id: string) => ALL_COLUMNS.find(c => c.id === id)?.width || 120;

  // ===== Actions =====
  const openAdd = () => {
    if (disabled) return;
    setForm(emptyForm());
    setValidationError(null);
    setEditOpen(true);
  };

  const openEdit = () => {
    if (!selectedRow || disabled) return;
    setForm({ ...selectedRow });
    setValidationError(null);
    setEditOpen(true);
  };

  const handleSave = async () => {
    setValidationError(null);
    if (!form.date_received) {
      setValidationError('Date Received is required.');
      return;
    }
    if (!form.payment_code) {
      setValidationError('Payment Code is required.');
      return;
    }
    const payload: any = {
      deal_id: dealId,
      date_received: form.date_received || null,
      date_due: form.date_due || null,
      reference: form.reference || null,
      payment_code: form.payment_code || null,
      total_amount_received: num(form.total_amount_received),
      applied_to_interest: num(form.applied_to_interest),
      applied_to_principal: num(form.applied_to_principal),
      applied_to_late_charges: num(form.applied_to_late_charges),
      applied_to_reserve: num(form.applied_to_reserve),
      applied_to_impound: num(form.applied_to_impound),
      prepayment_penalty: num(form.prepayment_penalty),
      charges_principal: num(form.charges_principal),
      charges_interest: num(form.charges_interest),
      fees_paid_to_broker: num(form.fees_paid_to_broker),
      fees_paid_to_lenders: num(form.fees_paid_to_lenders),
      description: form.description || null,
    };
    try {
      if (form.id) {
        const { error } = await supabase.from('loan_history').update(payload).eq('id', form.id);
        if (error) throw error;
        toast({ title: 'Updated', description: 'Payment entry updated.' });
      } else {
        const { error } = await supabase.from('loan_history').insert(payload);
        if (error) throw error;
        toast({ title: 'Added', description: 'Payment entry added.' });
      }
      setEditOpen(false);
      qc.invalidateQueries({ queryKey: ['loan-history', dealId] });
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    if (!selectedRow) return;
    try {
      const { error } = await supabase.from('loan_history').delete().eq('id', selectedRow.id);
      if (error) throw error;
      toast({ title: 'Deleted', description: 'Payment entry removed.' });
      setDeleteOpen(false);
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ['loan-history', dealId] });
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' });
    }
  };

  const handleReverse = async () => {
    if (!selectedRow) return;
    if (selectedRow.payment_code === 'PAYMENT_REV' || selectedRow.payment_code === 'PAYMENT_VOID') {
      setValidationError('This entry is already reversed/voided.');
      return;
    }
    try {
      const { id, created_at, ...rest } = selectedRow as any;
      const reversal: any = {
        ...rest,
        payment_code: 'PAYMENT_REV',
        date_received: format(new Date(), 'yyyy-MM-dd'),
        reference: `REV-${selectedRow.reference || selectedRow.id.slice(0, 6)}`,
        description: `Reversal of ${selectedRow.reference || selectedRow.id}. ${notesText || ''}`.trim(),
      };
      const { error } = await supabase.from('loan_history').insert(reversal);
      if (error) throw error;
      toast({ title: 'Reversed', description: 'Reversal entry created.' });
      setReverseOpen(false);
      setNotesText('');
      qc.invalidateQueries({ queryKey: ['loan-history', dealId] });
    } catch (e: any) {
      toast({ title: 'Reverse failed', description: e.message, variant: 'destructive' });
    }
  };

  const handleNsf = async () => {
    if (!selectedRow) return;
    try {
      const { id, created_at, ...rest } = selectedRow as any;
      const nsf: any = {
        ...rest,
        payment_code: 'NSF',
        date_received: format(new Date(), 'yyyy-MM-dd'),
        reference: `NSF-${selectedRow.reference || selectedRow.id.slice(0, 6)}`,
        description: `NSF for ${selectedRow.reference || selectedRow.id}. ${notesText || ''}`.trim(),
      };
      const { error } = await supabase.from('loan_history').insert(nsf);
      if (error) throw error;
      toast({ title: 'NSF recorded', description: 'NSF entry created.' });
      setNsfOpen(false);
      setNotesText('');
      qc.invalidateQueries({ queryKey: ['loan-history', dealId] });
    } catch (e: any) {
      toast({ title: 'NSF failed', description: e.message, variant: 'destructive' });
    }
  };

  const handleAddNotes = async () => {
    if (!selectedRow) return;
    try {
      const merged = [selectedRow.description, notesText].filter(Boolean).join('\n');
      const { error } = await supabase.from('loan_history').update({ description: merged }).eq('id', selectedRow.id);
      if (error) throw error;
      toast({ title: 'Notes saved', description: 'Notes appended to entry.' });
      setNotesOpen(false);
      setNotesText('');
      qc.invalidateQueries({ queryKey: ['loan-history', dealId] });
    } catch (e: any) {
      toast({ title: 'Save notes failed', description: e.message, variant: 'destructive' });
    }
  };

  const handlePrint = () => window.print();

  // ===== Render =====
  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={openEdit} disabled={!selectedRow || disabled}>
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Button>
        <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => setDeleteOpen(true)} disabled={!selectedRow || disabled}>
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={disabled}>
              Actions <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem disabled={!selectedRow} onClick={() => { setValidationError(null); setNotesText(''); setReverseOpen(true); }}>
              Reverse
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!selectedRow} onClick={() => { setNotesText(''); setNsfOpen(true); }}>
              NSF
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!selectedRow} onClick={() => { setNotesText(''); setNotesOpen(true); }}>
              Add Notes
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={handlePrint}>
          <Printer className="h-3.5 w-3.5" /> Print
        </Button>
        <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => setExportOpen(true)}>
          <Download className="h-3.5 w-3.5" /> Export
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 gap-1 text-xs">
              <Settings2 className="h-3.5 w-3.5" /> Columns
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-2">
            <div className="space-y-1 max-h-72 overflow-auto">
              {ALL_COLUMNS.map(c => (
                <label key={c.id} className="flex items-center gap-2 text-xs px-1 py-1 hover:bg-muted rounded cursor-pointer">
                  <Checkbox
                    checked={columnVisibility[c.id] !== false}
                    onCheckedChange={(v) => {
                      const next = { ...columnVisibility, [c.id]: !!v };
                      if (Object.values(next).filter(Boolean).length === 0) return;
                      setColumnVisibility(next);
                    }}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>

        <div className="flex items-center gap-2 ml-auto">
          <Label className="text-xs text-muted-foreground">Date filter</Label>
          <Select value={dateFilter} onValueChange={setDateFilter}>
            <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DATE_FILTERS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-8 gap-1 text-xs" onClick={openAdd} disabled={disabled}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {!isLoading && entries.length === 0 ? (
        <div className="flex items-center justify-center min-h-[280px] border rounded-md">
          <div className="text-center">
            <History className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <h3 className="text-base font-semibold mb-1">Loan History</h3>
            <p className="text-sm text-muted-foreground">No payment history recorded yet.</p>
          </div>
        </div>
      ) : (
        <div className="border rounded-md overflow-auto relative" style={{ maxHeight: 600 }}>
          <table className="w-full text-xs border-collapse">
            <thead className="bg-muted sticky top-0 z-20">
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id}>
                  {hg.headers.map(h => {
                    const id = h.column.id;
                    const sticky = isStickyCol(id);
                    const w = colWidth(id);
                    return (
                      <th
                        key={h.id}
                        style={{
                          width: w, minWidth: w, maxWidth: w,
                          left: sticky ? stickyOffsets[id] : undefined,
                        }}
                        className={`h-9 px-2 text-left font-medium text-muted-foreground border-b select-none cursor-pointer bg-muted ${sticky ? 'sticky z-30' : ''}`}
                        onClick={h.column.getToggleSortingHandler()}
                      >
                        <div className="flex items-center gap-1">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {h.column.getIsSorted() === 'asc' && <ChevronUp className="h-3 w-3" />}
                          {h.column.getIsSorted() === 'desc' && <ChevronDown className="h-3 w-3" />}
                          {!h.column.getIsSorted() && <ChevronsUpDown className="h-3 w-3 opacity-30" />}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="text-center py-8 text-muted-foreground">
                    {isLoading ? 'Loading…' : 'No records match the selected filters.'}
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row, idx) => {
                  const r = row.original;
                  const isSel = selectedId === r.id;
                  const neg = isNegativeRow(r.payment_code);
                  const stripe = idx % 2 === 1;
                  return (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedId(isSel ? null : r.id)}
                      className={`cursor-pointer transition-colors
                        ${isSel ? 'bg-primary/10 hover:bg-primary/15' : ''}
                        ${!isSel && neg ? 'bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/50' : ''}
                        ${!isSel && !neg && stripe ? 'bg-muted/30 hover:bg-muted/50' : ''}
                        ${!isSel && !neg && !stripe ? 'hover:bg-muted/40' : ''}
                      `}
                    >
                      {row.getVisibleCells().map(cell => {
                        const id = cell.column.id;
                        const sticky = isStickyCol(id);
                        const w = colWidth(id);
                        const baseBg = isSel
                          ? 'bg-primary/10'
                          : neg
                          ? 'bg-red-50 dark:bg-red-950/30'
                          : stripe
                          ? 'bg-muted/30'
                          : 'bg-background';
                        return (
                          <td
                            key={cell.id}
                            style={{
                              width: w, minWidth: w, maxWidth: w,
                              left: sticky ? stickyOffsets[id] : undefined,
                            }}
                            className={`px-2 py-1.5 border-b align-middle ${sticky ? `sticky z-10 ${baseBg}` : ''}`}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
            {/* Sticky totals footer */}
            <tfoot className="sticky bottom-0 z-20">
              <tr className="bg-muted font-semibold">
                {visibleColumns.map((c) => {
                  const id = c.id as string;
                  const sticky = isStickyCol(id);
                  const w = colWidth(id);
                  const meta = ALL_COLUMNS.find(x => x.id === id);
                  let content: React.ReactNode = '';
                  if (id === 'date_received') content = 'Totals';
                  else if (meta?.money) {
                    const t = (totals as any)[id] ?? 0;
                    content = <span className={`font-mono ${t < 0 ? 'text-red-600' : ''}`}>{fmtCurrency(t)}</span>;
                  }
                  return (
                    <td
                      key={id}
                      style={{
                        width: w, minWidth: w, maxWidth: w,
                        left: sticky ? stickyOffsets[id] : undefined,
                      }}
                      className={`px-2 py-2 border-t bg-muted ${sticky ? 'sticky z-30' : ''}`}
                    >
                      {content}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        Showing {filteredEntries.length} of {entries.length} records
        {selectedRow && <> • Selected reference: <span className="font-mono">{selectedRow.reference || selectedRow.id.slice(0, 8)}</span></>}
      </div>

      {/* ===== Add/Edit Modal ===== */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit Payment Entry' : 'Add Payment Entry'}</DialogTitle>
            <DialogDescription>Capture a payment with all amount allocations.</DialogDescription>
          </DialogHeader>
          {validationError && <div className="text-xs text-red-600">{validationError}</div>}
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Date Received *">
              <Input type="date" value={form.date_received || ''} onChange={(e) => setForm({ ...form, date_received: e.target.value })} />
            </FormField>
            <FormField label="Date Due">
              <Input type="date" value={form.date_due || ''} onChange={(e) => setForm({ ...form, date_due: e.target.value })} />
            </FormField>
            <FormField label="Reference">
              <Input value={form.reference || ''} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </FormField>
            <FormField label="Payment Code *">
              <Select value={form.payment_code || ''} onValueChange={(v) => setForm({ ...form, payment_code: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_CODES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>
            <NumField label="Total Amount Received" form={form} setForm={setForm} k="total_amount_received" />
            <NumField label="Applied To Interest" form={form} setForm={setForm} k="applied_to_interest" />
            <NumField label="Applied To Principal" form={form} setForm={setForm} k="applied_to_principal" />
            <NumField label="Applied To Late Charges" form={form} setForm={setForm} k="applied_to_late_charges" />
            <NumField label="Applied To Reserve" form={form} setForm={setForm} k="applied_to_reserve" />
            <NumField label="Applied To Impound" form={form} setForm={setForm} k="applied_to_impound" />
            <NumField label="Prepayment Penalty" form={form} setForm={setForm} k="prepayment_penalty" />
            <NumField label="Fees Paid To Broker" form={form} setForm={setForm} k="fees_paid_to_broker" />
            <NumField label="Fees Paid To Lenders" form={form} setForm={setForm} k="fees_paid_to_lenders" />
          </div>
          <FormField label="Notes">
            <Textarea rows={2} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Delete Confirm ===== */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Entry</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete reference{' '}
              <span className="font-mono">{selectedRow?.reference || selectedRow?.id.slice(0, 8)}</span>?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Reverse Modal ===== */}
      <Dialog open={reverseOpen} onOpenChange={setReverseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reverse Transaction</DialogTitle>
            <DialogDescription>
              Create a reversal entry for{' '}
              <span className="font-mono">{selectedRow?.reference || selectedRow?.id.slice(0, 8)}</span>.
            </DialogDescription>
          </DialogHeader>
          {validationError && <div className="text-xs text-red-600">{validationError}</div>}
          <FormField label="Reason / Notes">
            <Textarea rows={3} value={notesText} onChange={(e) => setNotesText(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseOpen(false)}>Cancel</Button>
            <Button onClick={handleReverse}>Reverse</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== NSF Modal ===== */}
      <Dialog open={nsfOpen} onOpenChange={setNsfOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>NSF Payment</DialogTitle>
            <DialogDescription>
              Mark{' '}
              <span className="font-mono">{selectedRow?.reference || selectedRow?.id.slice(0, 8)}</span> as NSF.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Notes">
            <Textarea rows={3} value={notesText} onChange={(e) => setNotesText(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNsfOpen(false)}>Cancel</Button>
            <Button onClick={handleNsf}>Record NSF</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Add Notes Modal ===== */}
      <Dialog open={notesOpen} onOpenChange={setNotesOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Notes</DialogTitle>
            <DialogDescription>
              Append notes to{' '}
              <span className="font-mono">{selectedRow?.reference || selectedRow?.id.slice(0, 8)}</span>.
            </DialogDescription>
          </DialogHeader>
          {selectedRow?.description && (
            <div className="text-xs bg-muted p-2 rounded whitespace-pre-wrap max-h-32 overflow-auto">
              {selectedRow.description}
            </div>
          )}
          <FormField label="New note">
            <Textarea rows={3} value={notesText} onChange={(e) => setNotesText(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotesOpen(false)}>Cancel</Button>
            <Button onClick={handleAddNotes} disabled={!notesText.trim()}>Save Note</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GridExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        columns={EXPORT_COLUMNS}
        data={filteredEntries}
        fileName={`loan_history_${dealId.slice(0, 8)}`}
      />
    </div>
  );
};

// ===== Small form helpers =====
const FormField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1">
    <Label className="text-xs">{label}</Label>
    {children}
  </div>
);

const NumField: React.FC<{
  label: string;
  form: any;
  setForm: (v: any) => void;
  k: string;
}> = ({ label, form, setForm, k }) => (
  <FormField label={label}>
    <Input
      type="number"
      step="0.01"
      value={form[k] ?? 0}
      onChange={(e) => setForm({ ...form, [k]: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
    />
  </FormField>
);

export default LoanHistoryViewer;
