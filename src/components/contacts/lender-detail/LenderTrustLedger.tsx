import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { logContactEvent } from '@/hooks/useContactEventJournal';
import { Plus, DollarSign, FileText, ArrowRightLeft, Ban, CheckSquare, Building, RefreshCw, FileCheck, CalendarIcon } from 'lucide-react';
import { numericKeyDown, numericPaste, formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { parseDateOnly, formatDateOnly, todayDateOnly } from '@/lib/dateOnly';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Tabs, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ColumnConfigPopover, ColumnConfig } from '@/components/deal/ColumnConfigPopover';
import { useTableColumnConfig } from '@/hooks/useTableColumnConfig';
import { GridToolbar } from '@/components/deal/GridToolbar';
import { GridExportDialog, ExportColumn } from '@/components/deal/GridExportDialog';
import { SortableTableHead } from '@/components/deal/SortableTableHead';
import { useGridSortFilter } from '@/hooks/useGridSortFilter';
import { useGridSelection } from '@/hooks/useGridSelection';
import { DeleteConfirmationDialog } from '@/components/deal/DeleteConfirmationDialog';
import { getContactContactData, patchContactData } from '@/services/contacts/contacts.service';
import { toast } from 'sonner';

interface LedgerEntry {
  id: string;
  date: string;
  reference: string;
  fromWhomReceivedPaid: string;
  memo: string;
  payment: string;
  clr: string;
  deposit: string;
  balance: string;
  category: 'all' | 'reserve' | 'holdback';
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'date', label: 'Date', visible: true },
  { id: 'reference', label: 'Reference', visible: true },
  { id: 'fromWhomReceivedPaid', label: 'From Whom Received / Paid', visible: true },
  { id: 'memo', label: 'Memo', visible: true },
  { id: 'payment', label: 'Payment', visible: true },
  { id: 'clr', label: 'CLR', visible: true },
  { id: 'deposit', label: 'Deposit', visible: true },
  { id: 'balance', label: 'Balance', visible: true },
];

const DATE_FILTER_OPTIONS = [
  { value: 'all', label: 'All Dates' },
  { value: 'quarter_to_date', label: 'Quarter To Date' },
  { value: 'year_to_date', label: 'Year To Date' },
  { value: 'last_3_months', label: 'Last 3 Months' },
  { value: 'last_6_months', label: 'Last 6 Months' },
  { value: 'last_12_months', label: 'Last 12 Months' },
  { value: 'last_year', label: 'Last Year' },
];

const EXPORT_COLUMNS: ExportColumn[] = DEFAULT_COLUMNS.map(c => ({ id: c.id, label: c.label }));
const SEARCHABLE_FIELDS = ['reference', 'fromWhomReceivedPaid', 'memo', 'date'];
const FILTER_OPTIONS = [
  { id: 'category', label: 'Category', options: [{ value: 'reserve', label: 'Reserve' }, { value: 'holdback', label: 'Holdback' }] },
];

const formatCurrency = (val: string) => {
  if (!val) return '';
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  const isNeg = num < 0;
  const formatted = `$${Math.abs(num).toFixed(2)}`;
  return isNeg ? `(${formatted})` : formatted;
};

const filterByDate = (entries: LedgerEntry[], filter: string): LedgerEntry[] => {
  if (filter === 'all') return entries;
  const now = new Date();
  let cutoff: Date;
  switch (filter) {
    case 'quarter_to_date': { const q = Math.floor(now.getMonth() / 3) * 3; cutoff = new Date(now.getFullYear(), q, 1); break; }
    case 'year_to_date': cutoff = new Date(now.getFullYear(), 0, 1); break;
    case 'last_3_months': cutoff = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()); break;
    case 'last_6_months': cutoff = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()); break;
    case 'last_12_months': cutoff = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate()); break;
    case 'last_year': cutoff = new Date(now.getFullYear() - 1, 0, 1); break;
    default: return entries;
  }
  return entries.filter(e => { if (!e.date) return false; return new Date(e.date) >= cutoff; });
};

const EMPTY_ENTRY = { date: '', reference: '', fromWhomReceivedPaid: '', memo: '', payment: '', clr: '', deposit: '', balance: '', category: 'all' as const };

const LenderTrustLedger: React.FC<{ lenderId: string; contactDbId: string; disabled?: boolean }> = ({ contactDbId, disabled = false }) => {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [columns, setColumns, resetColumns] = useTableColumnConfig('lender_trust_ledger', DEFAULT_COLUMNS);
  const visibleColumns = columns.filter(c => c.visible);
  const [activeTab, setActiveTab] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newEntry, setNewEntry] = useState(EMPTY_ENTRY);

  // Load from DB
  useEffect(() => {
    if (!contactDbId) return;
    (async () => {
      const data = { contact_data: await getContactContactData(contactDbId) };
      if (data?.contact_data && (data.contact_data as any)._trust_ledger) {
        setEntries((data.contact_data as any)._trust_ledger);
      }
    })();
  }, [contactDbId]);

  const persistEntries = useCallback(async (updated: LedgerEntry[]) => {
    if (!contactDbId) return;
    await patchContactData(contactDbId, { _trust_ledger: updated });
  }, [contactDbId]);

  const preFiltered = useMemo(() => {
    let result = entries;
    if (activeTab !== 'all') result = result.filter(e => e.category === activeTab);
    return filterByDate(result, dateFilter);
  }, [entries, activeTab, dateFilter]);

  const {
    searchQuery, setSearchQuery, sortState, toggleSort,
    activeFilters, setFilter, clearFilters, activeFilterCount, filteredData,
  } = useGridSortFilter(preFiltered, SEARCHABLE_FIELDS);

  const {
    selectedIds, selectedItems, toggleOne, toggleAll, clearSelection,
    isAllSelected, selectedCount,
  } = useGridSelection(filteredData);

  const handleAddEntry = async () => {
    const entry: LedgerEntry = { ...newEntry, id: crypto.randomUUID() };
    const updated = [...entries, entry];
    setEntries(updated);
    await persistEntries(updated);
    setNewEntry(EMPTY_ENTRY);
    setAddDialogOpen(false);
    toast.success('Entry added');
    logContactEvent(contactDbId, 'Trust Ledger', [{ fieldLabel: 'Entry Added', oldValue: '', newValue: entry.reference || entry.memo || 'New entry' }]);
  };

  const handleBulkDelete = async () => {
    const updated = entries.filter(e => !selectedIds.has(e.id));
    setEntries(updated);
    await persistEntries(updated);
    clearSelection();
    setBulkDeleteOpen(false);
    toast.success('Entries deleted');
    logContactEvent(contactDbId, 'Trust Ledger', [{ fieldLabel: 'Entries Deleted', oldValue: `${selectedCount} entry(ies)`, newValue: '(deleted)' }]);
  };

  const renderCellValue = (entry: LedgerEntry, colId: string) => {
    switch (colId) {
      case 'payment': return formatCurrency(entry.payment) || '-';
      case 'deposit': return formatCurrency(entry.deposit) || '-';
      case 'balance': return formatCurrency(entry.balance) || '-';
      default: return (entry as any)[colId] || '-';
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg text-foreground">Trust Ledger</h3>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip><TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={disabled}><Ban className="h-4 w-4" /></Button>
            </TooltipTrigger><TooltipContent>Void Transaction</TooltipContent></Tooltip>

            <DropdownMenu>
              <Tooltip><TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-8 w-8" disabled={disabled}><DollarSign className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
              </TooltipTrigger><TooltipContent>Transactions</TooltipContent></Tooltip>
              <DropdownMenuContent align="start">
                <DropdownMenuItem><DollarSign className="h-4 w-4 mr-2" />Enter Deposit</DropdownMenuItem>
                <DropdownMenuItem><FileText className="h-4 w-4 mr-2" />Enter Check</DropdownMenuItem>
                <DropdownMenuItem><RefreshCw className="h-4 w-4 mr-2" />Enter Adjustment</DropdownMenuItem>
                <DropdownMenuItem><ArrowRightLeft className="h-4 w-4 mr-2" />Transfer Funds</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem><Ban className="h-4 w-4 mr-2" />Void Transaction</DropdownMenuItem>
                <DropdownMenuItem><CheckSquare className="h-4 w-4 mr-2" />Clear Status</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip><TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={disabled}><FileText className="h-4 w-4" /></Button>
            </TooltipTrigger><TooltipContent>Info</TooltipContent></Tooltip>

            <DropdownMenu>
              <Tooltip><TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-8 w-8" disabled={disabled}><Building className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
              </TooltipTrigger><TooltipContent>Banking</TooltipContent></Tooltip>
              <DropdownMenuContent align="start">
                <DropdownMenuItem><Building className="h-4 w-4 mr-2" />Make Bank Deposit</DropdownMenuItem>
                <DropdownMenuItem><RefreshCw className="h-4 w-4 mr-2" />Reconcile Bank Account</DropdownMenuItem>
                <DropdownMenuItem><FileCheck className="h-4 w-4 mr-2" />Create Positive Pay File</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip><TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={disabled}><FileCheck className="h-4 w-4" /></Button>
            </TooltipTrigger><TooltipContent>Select & Print Checks</TooltipContent></Tooltip>
          </TooltipProvider>
        </div>

        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DATE_FILTER_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <GridToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filterOptions={FILTER_OPTIONS}
        activeFilters={activeFilters}
        onFilterChange={setFilter}
        onClearFilters={clearFilters}
        activeFilterCount={activeFilterCount}
        selectedCount={selectedCount}
        onBulkDelete={disabled ? undefined : () => setBulkDeleteOpen(true)}
        onExport={() => setExportDialogOpen(true)}
      />

      <div className="flex items-center justify-between">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-8">
            <TabsTrigger value="all" className="text-xs px-3 py-1">All Transactions</TabsTrigger>
            <TabsTrigger value="reserve" className="text-xs px-3 py-1">Reserve</TabsTrigger>
            <TabsTrigger value="holdback" className="text-xs px-3 py-1">Holdback</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <ColumnConfigPopover columns={columns} onColumnsChange={setColumns} onResetColumns={resetColumns} />
          {!disabled && (
            <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(true)} className="gap-1 text-xs">
              <Plus className="h-4 w-4" /> Add Entry
            </Button>
          )}
        </div>
      </div>

      <div className="border border-border rounded-lg overflow-x-auto">
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[40px]">
                <Checkbox checked={isAllSelected} onCheckedChange={() => toggleAll()} aria-label="Select all" />
              </TableHead>
              {visibleColumns.map(col => (
                <SortableTableHead key={col.id} columnId={col.id} label={col.label}
                  sortColumnId={sortState.columnId} sortDirection={sortState.direction} onSort={toggleSort} className="text-xs" />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumns.length + 1} className="text-center py-8 text-muted-foreground">
                  No entries found. Click "Add Entry" to add one.
                </TableCell>
              </TableRow>
            ) : filteredData.map((entry, idx) => (
              <TableRow key={entry.id} className={`hover:bg-muted/30 ${idx === 0 ? 'bg-accent/20' : ''}`}>
                <TableCell onClick={e => e.stopPropagation()} className="w-[40px]">
                  <Checkbox checked={selectedIds.has(entry.id)} onCheckedChange={() => toggleOne(entry.id)} />
                </TableCell>
                {visibleColumns.map(col => (
                  <TableCell key={col.id} className="text-xs py-2">{renderCellValue(entry, col.id)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {filteredData.length > 0 && (
        <div className="flex justify-end">
          <div className="text-sm text-muted-foreground">Total Entries: {filteredData.length}</div>
        </div>
      )}

      {/* Add Entry Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add Trust Ledger Entry</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: 'date', label: 'Date', type: 'date' },
              { key: 'reference', label: 'Reference' },
              { key: 'fromWhomReceivedPaid', label: 'From Whom' },
              { key: 'memo', label: 'Memo' },
              { key: 'payment', label: 'Payment', type: 'currency' },
              { key: 'deposit', label: 'Deposit', type: 'currency' },
              { key: 'clr', label: 'CLR' },
              { key: 'balance', label: 'Balance', type: 'currency' },
            ].map(f => (
              <div key={f.key} className="space-y-1">
                <Label className="text-xs">{f.label}</Label>
                {f.type === 'date' ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full h-8 text-xs justify-start font-normal">
                        {(newEntry as any)[f.key] || <span className="text-muted-foreground">mm/dd/yyyy</span>}
                        <CalendarIcon className="ml-auto h-3 w-3" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                      <EnhancedCalendar mode="single" selected={parseDateOnly((newEntry as any)[f.key])} onSelect={(date) => setNewEntry(prev => ({ ...prev, [f.key]: formatDateOnly(date) }))} onClear={() => setNewEntry(prev => ({ ...prev, [f.key]: '' }))} onToday={() => setNewEntry(prev => ({ ...prev, [f.key]: todayDateOnly() }))} initialFocus />
                    </PopoverContent>
                  </Popover>
                ) : f.type === 'currency' ? (
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={(newEntry as any)[f.key]}
                      onChange={e => setNewEntry(prev => ({ ...prev, [f.key]: e.target.value }))}
                      onKeyDown={numericKeyDown}
                      onPaste={e => numericPaste(e, val => setNewEntry(prev => ({ ...prev, [f.key]: val })))}
                      onFocus={() => {
                        const raw = unformatCurrencyDisplay((newEntry as any)[f.key] || '');
                        setNewEntry(prev => ({ ...prev, [f.key]: raw }));
                      }}
                      onBlur={() => {
                        const raw = unformatCurrencyDisplay((newEntry as any)[f.key] || '');
                        if (raw) setNewEntry(prev => ({ ...prev, [f.key]: formatCurrencyDisplay(raw) }));
                      }}
                      className="h-8 text-xs pl-5 text-right"
                      placeholder="0.00"
                    />
                  </div>
                ) : (
                  <Input type="text" value={(newEntry as any)[f.key]}
                    onChange={e => setNewEntry(prev => ({ ...prev, [f.key]: e.target.value }))} className="h-8 text-xs" />
                )}
              </div>
            ))}
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <Select value={newEntry.category} onValueChange={v => setNewEntry(prev => ({ ...prev, category: v as any }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent className="!z-[9999]" position="popper">
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="reserve">Reserve</SelectItem>
                  <SelectItem value="holdback">Holdback</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleAddEntry}>Add Entry</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen} onConfirm={handleBulkDelete}
        title="Delete Selected Entries" description={`Are you sure you want to delete ${selectedCount} selected entry(ies)?`} />
      <GridExportDialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}
        columns={EXPORT_COLUMNS} data={filteredData} fileName="lender_trust_ledger_export" />
    </div>
  );
};

export default LenderTrustLedger;
