import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Download, Settings2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import SortableTableHead from '@/components/deal/SortableTableHead';
import { type SortDirection } from '@/hooks/useGridSortFilter';
import { listParticipantsByContactAndRole } from '@/services/deals/participants.service';
import { fetchSectionValuesBySection } from '@/services/deals/section-values.service';
import { listDealsByIds } from '@/services/deals/deals.service';
import { listLoanHistoryByDealIds } from '@/services/deals/loan-history.service';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';


interface HistoryRow {
  id: string;
  dealId: string;
  transactionDate: string;
  transactionDateRaw: string;
  accountNumber: string;
  address: string;
  borrower: string;
  status: string;
  total: string;
  totalNum: number;
  principal: string;
  principalNum: number;
  interest: string;
  interestNum: number;
  lateFeePaid: string;
  lateFeePaidNum: number;
  servicingFees: string;
  servicingFeesNum: number;
  other: string;
  otherNum: number;
  principalBalance: string;
  principalBalanceNum: number;
}

const ALL_COLUMNS = [
  { id: 'transactionDate', label: 'Transaction Date' },
  { id: 'accountNumber', label: 'Account Number' },
  { id: 'address', label: 'Address' },
  { id: 'borrower', label: 'Borrower' },
  { id: 'status', label: 'Status' },
  { id: 'total', label: 'Total' },
  { id: 'principal', label: 'Principal' },
  { id: 'interest', label: 'Interest' },
  { id: 'lateFeePaid', label: 'Late Fee Paid' },
  { id: 'servicingFees', label: 'Servicing Fees' },
  { id: 'other', label: 'Other' },
  { id: 'principalBalance', label: 'Principal Balance' },
];

const formatCurrency = (val: any) => {
  if (val == null || val === '') return '$0.00';
  const num = typeof val === 'number' ? val : parseFloat(String(val));
  if (isNaN(num)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
};

const formatDate = (val: any) => {
  if (!val) return '-';
  try {
    const d = new Date(String(val));
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('en-US');
  } catch { return '-'; }
};

const parseNum = (val: any): number => {
  if (val == null || val === '') return 0;
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return isNaN(n) ? 0 : n;
};

interface Props {
  brokerId: string;
  contactDbId?: string;
}

const BrokerHistory: React.FC<Props> = ({ brokerId, contactDbId }) => {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('all');
  const [sortCol, setSortCol] = useState<string | null>('transactionDate');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    new Set(ALL_COLUMNS.map(c => c.id))
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    const lookupId = contactDbId || brokerId;
    if (!lookupId) return;

    const load = async () => {
      setIsLoading(true);
      try {
        // 1. Find deal_participants for this broker
        let allParticipants = contactDbId
          ? await listParticipantsByContactAndRole(contactDbId, 'broker', 'deal_id')
          : [];

        if (allParticipants.length === 0 && brokerId) {
          const brokerSections = await fetchSectionValuesBySection('broker');

          const matchedDealIds: string[] = [];
          (brokerSections || []).forEach(bs => {
            const fv = bs.field_values as Record<string, any>;
            if (fv) {
              for (const v of Object.values(fv)) {
                if (typeof v === 'object' && v !== null) {
                  if ((v as any).value_text === brokerId) {
                    matchedDealIds.push(bs.deal_id);
                    break;
                  }
                }
                if (typeof v === 'string' && v === brokerId) {
                  matchedDealIds.push(bs.deal_id);
                  break;
                }
              }
            }
          });

          if (matchedDealIds.length > 0) {
            allParticipants = matchedDealIds.map(did => ({ deal_id: did }));
          }
        }

        if (allParticipants.length === 0) {
          setRows([]);
          setIsLoading(false);
          return;
        }

        const dealIds = [...new Set(allParticipants.map(p => p.deal_id))];

        // 2. Fetch deals
        const deals = await listDealsByIds(
          dealIds,
          'id, deal_number, borrower_name, property_address, status'
        );

        if (!deals || deals.length === 0) {
          setRows([]);
          setIsLoading(false);
          return;
        }

        const dealsMap = new Map(deals.map(d => [d.id, d]));

        // 3. Fetch loan_history for these deals
        const historyRecords = await listLoanHistoryByDealIds(
          dealIds,
          'date_received',
          false
        );

        if (!historyRecords || historyRecords.length === 0) {
          setRows([]);
          setIsLoading(false);
          return;
        }

        const historyRows: HistoryRow[] = historyRecords.map(rec => {
          const deal = dealsMap.get(rec.deal_id);
          const txDate = rec.date_received || rec.date_due;
          const totalNum = parseNum(rec.total_amount_received);
          const principalNum = parseNum(rec.applied_to_principal);
          const interestNum = parseNum(rec.applied_to_interest);
          const lateFeePaidNum = parseNum(rec.applied_to_late_charges);
          const servicingFeesNum = parseNum(rec.servicing_fees);
          const otherNum = parseNum(rec.other_amount);
          const principalBalanceNum = parseNum(rec.principal_balance);

          return {
            id: rec.id,
            dealId: rec.deal_id,
            transactionDate: formatDate(txDate),
            transactionDateRaw: txDate ? String(txDate) : '',
            accountNumber: deal?.deal_number || rec.account_number || '-',
            address: deal?.property_address || '-',
            borrower: deal?.borrower_name || '-',
            status: rec.payment_code || deal?.status || '-',
            total: formatCurrency(totalNum),
            totalNum,
            principal: formatCurrency(principalNum),
            principalNum,
            interest: formatCurrency(interestNum),
            interestNum,
            lateFeePaid: formatCurrency(lateFeePaidNum),
            lateFeePaidNum,
            servicingFees: formatCurrency(servicingFeesNum),
            servicingFeesNum,
            other: formatCurrency(otherNum),
            otherNum,
            principalBalance: formatCurrency(principalBalanceNum),
            principalBalanceNum,
          };
        });

        setRows(historyRows);
      } catch (err) {
        console.error('Failed to load broker history:', err);
        setRows([]);
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [contactDbId, brokerId]);

  const handleSort = useCallback((col: string) => {
    if (sortCol === col) {
      setSortDir(prev => prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc');
      if (sortDir === 'desc') setSortCol(null);
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }, [sortCol, sortDir]);

  const activeColumns = useMemo(
    () => ALL_COLUMNS.filter(c => visibleColumns.has(c.id)),
    [visibleColumns]
  );

  const filtered = useMemo(() => {
    let result = rows;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        r.accountNumber.toLowerCase().includes(q) ||
        r.borrower.toLowerCase().includes(q) ||
        r.address.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
      );
    }

    if (dateFilter !== 'all') {
      const now = new Date();
      result = result.filter(r => {
        if (!r.transactionDateRaw) return false;
        const d = new Date(r.transactionDateRaw);
        if (isNaN(d.getTime())) return false;
        switch (dateFilter) {
          case 'mtd': {
            const start = new Date(now.getFullYear(), now.getMonth(), 1);
            return d >= start && d <= now;
          }
          case 'last_month': {
            const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const end = new Date(now.getFullYear(), now.getMonth(), 0);
            return d >= start && d <= end;
          }
          case 'qtd': {
            const qMonth = Math.floor(now.getMonth() / 3) * 3;
            const start = new Date(now.getFullYear(), qMonth, 1);
            return d >= start && d <= now;
          }
          case 'ytd': {
            const start = new Date(now.getFullYear(), 0, 1);
            return d >= start && d <= now;
          }
          case 'last_year': {
            const start = new Date(now.getFullYear() - 1, 0, 1);
            const end = new Date(now.getFullYear() - 1, 11, 31);
            return d >= start && d <= end;
          }
          default: return true;
        }
      });
    }

    if (sortCol && sortDir) {
      const numCols: Record<string, string> = {
        total: 'totalNum', principal: 'principalNum', interest: 'interestNum',
        lateFeePaid: 'lateFeePaidNum', servicingFees: 'servicingFeesNum',
        other: 'otherNum', principalBalance: 'principalBalanceNum',
      };
      result = [...result].sort((a, b) => {
        let av: any, bv: any;
        if (sortCol === 'transactionDate') { av = a.transactionDateRaw; bv = b.transactionDateRaw; }
        else if (numCols[sortCol]) { av = (a as any)[numCols[sortCol]]; bv = (b as any)[numCols[sortCol]]; }
        else { av = (a as any)[sortCol] || ''; bv = (b as any)[sortCol] || ''; }

        if (typeof av === 'number' && typeof bv === 'number') {
          return sortDir === 'asc' ? av - bv : bv - av;
        }
        return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
    }

    return result;
  }, [rows, search, dateFilter, sortCol, sortDir]);

  // Pagination
  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(page, totalPages);
  const paginatedRows = filtered.slice((safeCurrentPage - 1) * pageSize, safeCurrentPage * pageSize);
  const startItem = totalItems === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const endItem = Math.min(safeCurrentPage * pageSize, totalItems);

  useEffect(() => { setPage(1); }, [search, dateFilter, pageSize]);

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
      activeColumns.map(c => `"${String((r as any)[c.id] || '').replace(/"/g, '""')}"`).join(',')
    );
    const csv = [headers, ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'broker_history.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-lg font-semibold text-foreground">Broker History</h4>
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
                    id={`bh-col-${c.id}`}
                    checked={visibleColumns.has(c.id)}
                    onCheckedChange={() => toggleColumn(c.id)}
                  />
                  <label htmlFor={`bh-col-${c.id}`} className="text-xs cursor-pointer">{c.label}</label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search Account / Borrower / Address..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-7 h-8 w-[260px] text-xs"
          />
        </div>

        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Dates</SelectItem>
            <SelectItem value="mtd">Month to Date</SelectItem>
            <SelectItem value="last_month">Last Month</SelectItem>
            <SelectItem value="qtd">Quarter to Date</SelectItem>
            <SelectItem value="ytd">Year to Date</SelectItem>
            <SelectItem value="last_year">Last Year</SelectItem>
          </SelectContent>
        </Select>

        <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" onClick={handleExport}>
          <Download className="h-3.5 w-3.5" /> Export
        </Button>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-x-auto">
        <Table className="min-w-[1400px]">
          <TableHeader>
            <TableRow className="bg-muted/50">
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
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={activeColumns.length} className="text-center py-8 text-muted-foreground text-sm">
                  Loading history...
                </TableCell>
              </TableRow>
            ) : paginatedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={activeColumns.length} className="text-center py-8 text-muted-foreground text-sm">
                  No history records found.
                </TableCell>
              </TableRow>
            ) : paginatedRows.map((r, idx) => (
              <TableRow key={r.id} className={idx % 2 === 1 ? 'bg-muted/30' : ''}>
                {activeColumns.map(c => (
                  <TableCell key={c.id} className="whitespace-nowrap text-xs">
                    {(r as any)[c.id] || '-'}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalItems > 0 && (
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Items per page:</span>
            <Select value={String(pageSize)} onValueChange={v => setPageSize(Number(v))}>
              <SelectTrigger className="h-7 w-[70px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {startItem} - {endItem} of {totalItems}
            </span>
            <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-xs" disabled={safeCurrentPage <= 1} onClick={() => setPage(1)}>«</Button>
            <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-xs" disabled={safeCurrentPage <= 1} onClick={() => setPage(p => p - 1)}>‹</Button>
            <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-xs" disabled={safeCurrentPage >= totalPages} onClick={() => setPage(p => p + 1)}>›</Button>
            <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-xs" disabled={safeCurrentPage >= totalPages} onClick={() => setPage(totalPages)}>»</Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BrokerHistory;
