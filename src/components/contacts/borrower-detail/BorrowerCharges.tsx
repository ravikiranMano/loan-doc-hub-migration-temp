import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Download, Filter, Settings2, CalendarIcon } from 'lucide-react';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import SortableTableHead from '@/components/deal/SortableTableHead';
import { type SortDirection } from '@/hooks/useGridSortFilter';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { listParticipantsByContactAndRole } from '@/services/deals/participants.service';
import { listDealsByIds, fetchDealById } from '@/services/deals/deals.service';
import { fetchSectionValuesForDeals } from '@/services/deals/section-values.service';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { format, parse, isValid } from 'date-fns';
import { cn } from '@/lib/utils';

interface ChargeRecord {
  id: string;
  dealId: string;
  chargeDate: string;
  loanReference: string;
  chargeType: string;
  description: string;
  amount: number;
  amountDisplay: string;
  balanceRemaining: number;
  balanceDisplay: string;
  status: string;
  createdBy: string;
  createdDate: string;
  chargeCategory: string;
}

const ALL_COLUMNS = [
  { id: 'chargeDate', label: 'Charge Date' },
  { id: 'loanReference', label: 'Loan Reference' },
  { id: 'chargeType', label: 'Charge Type' },
  { id: 'description', label: 'Description' },
  { id: 'amountDisplay', label: 'Amount' },
  { id: 'balanceDisplay', label: 'Balance Remaining' },
  { id: 'status', label: 'Status' },
  { id: 'createdBy', label: 'Created By' },
  { id: 'createdDate', label: 'Created Date' },
  { id: 'chargeCategory', label: 'Charge Category' },
];

const STATUS_OPTIONS = ['Pending', 'Paid', 'Waived', 'Reversed'];

interface Props {
  borrowerId: string;
  contactDbId: string;
}

const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const BorrowerCharges: React.FC<Props> = ({ contactDbId }) => {
  const navigate = useNavigate();
  const { openFile } = useWorkspace();
  const [rows, setRows] = useState<ChargeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<string | null>('chargeDate');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    new Set(['chargeDate', 'loanReference', 'chargeType', 'description', 'amountDisplay', 'balanceDisplay', 'status'])
  );

  // Filters
  const [showFilters, setShowFilters] = useState(false);
  const [filterLoan, setFilterLoan] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const fetchCharges = useCallback(async () => {
    setLoading(true);
    try {
      // Step 1: Get all deals where this contact participates as a borrower
      const participants = await listParticipantsByContactAndRole(contactDbId, 'borrower', 'deal_id, name');

      if (!participants || participants.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      const dealIds = participants.map(p => p.deal_id);

      // Step 2: Fetch deal info and charges section values in parallel
      const [dealsData, sectionsData] = await Promise.all([
        listDealsByIds(dealIds, 'id, deal_number, status, created_by'),
        fetchSectionValuesForDeals(dealIds, { section: 'charges' }),
      ]);

      const dealsMap = new Map<string, { deal_number: string; status: string }>();
      dealsData.forEach((d: { id: string; deal_number: string; status: string }) =>
        dealsMap.set(d.id, { deal_number: d.deal_number, status: d.status })
      );

      // Step 3: Extract charges from deal_section_values
      const allCharges: ChargeRecord[] = [];

      sectionsData.forEach((sv: { deal_id: string; field_values: Record<string, unknown> }) => {
        const fv = (sv.field_values || {}) as Record<string, any>;
        const deal = dealsMap.get(sv.deal_id);
        if (!deal) return;

        // Find all charge prefixes (charge1, charge2, etc.)
        const prefixes = new Set<string>();
        Object.keys(fv).forEach(key => {
          const m = key.match(/^(charge\d+)\./);
          if (m) prefixes.add(m[1]);
        });

        prefixes.forEach(prefix => {
          const desc = fv[`${prefix}.description`] || '';
          const rawAmount = parseFloat(fv[`${prefix}.original_amount`] || fv[`${prefix}.total_due`] || '0') || 0;
          const rawBalance = parseFloat(fv[`${prefix}.unpaid_balance`] || '0') || 0;
          const chargeType = fv[`${prefix}.charge_type`] || fv[`${prefix}.change_type`] || '';
          const dateOfCharge = fv[`${prefix}.date_of_charge`] || '';
          const deferred = fv[`${prefix}.deferred`] || '';
          const notes = fv[`${prefix}.notes`] || '';
          const account = fv[`${prefix}.account`] || '';

          // Derive status
          let status = 'Pending';
          if (deferred === 'true' || deferred === 'yes') status = 'Waived';
          else if (rawBalance <= 0 && rawAmount > 0) status = 'Paid';

          allCharges.push({
            id: `${sv.deal_id}__${prefix}`,
            dealId: sv.deal_id,
            chargeDate: dateOfCharge,
            loanReference: deal.deal_number,
            chargeType,
            description: desc,
            amount: rawAmount,
            amountDisplay: fmt(rawAmount),
            balanceRemaining: rawBalance,
            balanceDisplay: fmt(rawBalance),
            status,
            createdBy: account,
            createdDate: dateOfCharge,
            chargeCategory: chargeType,
          });
        });
      });

      setRows(allCharges);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [contactDbId]);

  useEffect(() => {
    if (contactDbId) fetchCharges();
  }, [contactDbId, fetchCharges]);

  // Metrics
  const metrics = useMemo(() => {
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const paid = rows.filter(r => r.status === 'Paid').reduce((s, r) => s + r.amount, 0);
    const outstanding = rows.filter(r => r.status === 'Pending').reduce((s, r) => s + r.balanceRemaining, 0);
    const waived = rows.filter(r => r.status === 'Waived').reduce((s, r) => s + r.amount, 0);
    return { total, paid, outstanding, waived };
  }, [rows]);

  // Unique values for filters
  const loanOptions = useMemo(() => [...new Set(rows.map(r => r.loanReference))].sort(), [rows]);
  const typeOptions = useMemo(() => [...new Set(rows.map(r => r.chargeType).filter(Boolean))].sort(), [rows]);

  // Filtering + sorting
  const filtered = useMemo(() => {
    let r = rows;
    if (search) {
      const q = search.toLowerCase();
      r = r.filter(row => Object.values(row).some(v => String(v).toLowerCase().includes(q)));
    }
    if (filterLoan !== 'all') r = r.filter(row => row.loanReference === filterLoan);
    if (filterType !== 'all') r = r.filter(row => row.chargeType === filterType);
    if (filterStatus !== 'all') r = r.filter(row => row.status === filterStatus);
    if (filterDateFrom) r = r.filter(row => row.chargeDate >= filterDateFrom);
    if (filterDateTo) r = r.filter(row => row.chargeDate <= filterDateTo);
    if (sortCol && sortDir) {
      r = [...r].sort((a, b) => {
        const av = (a as any)[sortCol] ?? '';
        const bv = (b as any)[sortCol] ?? '';
        if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
        return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
    }
    return r;
  }, [rows, search, filterLoan, filterType, filterStatus, filterDateFrom, filterDateTo, sortCol, sortDir]);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : sortDir === 'desc' ? null : 'asc');
      if (sortDir === 'desc') setSortCol(null);
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const activeColumns = useMemo(() => ALL_COLUMNS.filter(c => visibleColumns.has(c.id)), [visibleColumns]);
  const toggleColumn = (colId: string) => setVisibleColumns(prev => { const n = new Set(prev); n.has(colId) ? n.delete(colId) : n.add(colId); return n; });

  const handleRowClick = async (row: ChargeRecord) => {
    // Fetch deal details to open workspace
    const deal = await fetchDealById(row.dealId, 'deal_number, state, product_type');
    if (deal) {
      openFile({
        id: row.dealId,
        dealNumber: deal.deal_number,
        state: deal.state || '',
        productType: deal.product_type || '',
        openedAt: Date.now(),
      });
      navigate('/csr/deals');
    }
  };

  const handleExport = () => {
    const headers = activeColumns.map(c => c.label).join(',');
    const csvRows = filtered.map(r => activeColumns.map(c => `"${String((r as any)[c.id] || '').replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[headers, ...csvRows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'borrower_charges.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearFilters = () => {
    setFilterLoan('all');
    setFilterType('all');
    setFilterStatus('all');
    setFilterDateFrom('');
    setFilterDateTo('');
  };

  const activeFilterCount = [filterLoan, filterType, filterStatus].filter(f => f !== 'all').length + (filterDateFrom ? 1 : 0) + (filterDateTo ? 1 : 0);

  const statusBadge = (status: string) => {
    const variants: Record<string, string> = {
      Paid: 'bg-primary/10 text-primary',
      Pending: 'bg-accent text-accent-foreground',
      Waived: 'bg-secondary text-secondary-foreground',
      Reversed: 'bg-destructive/10 text-destructive',
    };
    return <Badge className={`text-xs font-medium ${variants[status] || 'bg-muted text-muted-foreground'}`}>{status}</Badge>;
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <h4 className="text-lg font-semibold text-foreground">Charges</h4>
        <div className="grid grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-20 rounded-lg bg-muted/50 animate-pulse" />)}
        </div>
        <div className="h-48 rounded-lg bg-muted/50 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="text-lg font-semibold text-foreground">Charges</h4>

      {/* Summary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total Charges</p>
          <p className="text-lg font-bold text-foreground">{fmt(metrics.total)}</p>
          <p className="text-xs text-muted-foreground">{rows.length} charge(s)</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total Paid</p>
          <p className="text-lg font-bold text-primary">{fmt(metrics.paid)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total Outstanding</p>
          <p className="text-lg font-bold text-destructive">{fmt(metrics.outstanding)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total Waived</p>
          <p className="text-lg font-bold text-secondary-foreground">{fmt(metrics.waived)}</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search charges..." value={search} onChange={e => setSearch(e.target.value)} className="pl-7 h-8 w-[200px] text-xs" />
        </div>
        <Popover open={showFilters} onOpenChange={setShowFilters}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1 h-8 text-xs">
              <Filter className="h-3.5 w-3.5" /> Filters
              {activeFilterCount > 0 && <Badge className="ml-1 h-4 w-4 p-0 flex items-center justify-center text-[10px] bg-primary text-primary-foreground">{activeFilterCount}</Badge>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3" align="start">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Filters</span>
                {activeFilterCount > 0 && <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={clearFilters}>Clear</Button>}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Loan Reference</Label>
                <Select value={filterLoan} onValueChange={setFilterLoan}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Loans</SelectItem>
                    {loanOptions.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Charge Type</Label>
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {typeOptions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Charge Status</Label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Date From</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn('h-8 text-xs w-full justify-start font-normal', !filterDateFrom && 'text-muted-foreground')}>
                        {filterDateFrom ? (() => { try { const d = parse(filterDateFrom, 'yyyy-MM-dd', new Date()); return isValid(d) ? format(d, 'MM/dd/yyyy') : filterDateFrom; } catch { return filterDateFrom; } })() : 'mm/dd/yyyy'}
                        <CalendarIcon className="ml-auto h-3 w-3" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                      <EnhancedCalendar mode="single" selected={filterDateFrom ? (() => { try { const d = parse(filterDateFrom, 'yyyy-MM-dd', new Date()); return isValid(d) ? d : undefined; } catch { return undefined; } })() : undefined} onSelect={(d) => setFilterDateFrom(d ? format(d, 'yyyy-MM-dd') : '')} onClear={() => setFilterDateFrom('')} onToday={() => setFilterDateFrom(format(new Date(), 'yyyy-MM-dd'))} initialFocus />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Date To</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn('h-8 text-xs w-full justify-start font-normal', !filterDateTo && 'text-muted-foreground')}>
                        {filterDateTo ? (() => { try { const d = parse(filterDateTo, 'yyyy-MM-dd', new Date()); return isValid(d) ? format(d, 'MM/dd/yyyy') : filterDateTo; } catch { return filterDateTo; } })() : 'mm/dd/yyyy'}
                        <CalendarIcon className="ml-auto h-3 w-3" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                      <EnhancedCalendar mode="single" selected={filterDateTo ? (() => { try { const d = parse(filterDateTo, 'yyyy-MM-dd', new Date()); return isValid(d) ? d : undefined; } catch { return undefined; } })() : undefined} onSelect={(d) => setFilterDateTo(d ? format(d, 'yyyy-MM-dd') : '')} onClear={() => setFilterDateTo('')} onToday={() => setFilterDateTo(format(new Date(), 'yyyy-MM-dd'))} initialFocus />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1 h-8 text-xs"><Settings2 className="h-3.5 w-3.5" /> Columns</Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3" align="end">
            <div className="space-y-2">
              <span className="text-sm font-medium">Toggle Columns</span>
              {ALL_COLUMNS.map(c => (
                <div key={c.id} className="flex items-center gap-2">
                  <Checkbox id={`bc-col-${c.id}`} checked={visibleColumns.has(c.id)} onCheckedChange={() => toggleColumn(c.id)} />
                  <label htmlFor={`bc-col-${c.id}`} className="text-xs cursor-pointer">{c.label}</label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" onClick={handleExport}>
          <Download className="h-3.5 w-3.5" /> Export
        </Button>
      </div>

      {/* Grid */}
      <div className="border border-border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              {activeColumns.map(c => (
                <SortableTableHead key={c.id} columnId={c.id} label={c.label} sortColumnId={sortCol} sortDirection={sortDir} onSort={handleSort} className="whitespace-nowrap text-xs" />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={activeColumns.length} className="text-center py-8 text-muted-foreground text-sm">
                  No charge records found for this borrower.
                </TableCell>
              </TableRow>
            ) : filtered.map(r => (
              <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => handleRowClick(r)}>
                {activeColumns.map(c => (
                  <TableCell key={c.id} className="whitespace-nowrap text-xs">
                    {c.id === 'status' ? statusBadge(r.status) : (r as any)[c.id] || '-'}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default BorrowerCharges;
