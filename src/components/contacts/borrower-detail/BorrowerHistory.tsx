import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Download, Filter, ChevronRight, ChevronDown, X } from 'lucide-react';
import { Table, TableBody, TableCell, TableHeader, TableRow, TableHead } from '@/components/ui/table';
import SortableTableHead from '@/components/deal/SortableTableHead';
import { type SortDirection } from '@/hooks/useGridSortFilter';
import { listParticipantsByContactAndRole } from '@/services/deals/participants.service';
import { fetchSectionValuesBySection } from '@/services/deals/section-values.service';
import { listDealsByIds } from '@/services/deals/deals.service';
import {
  listLoanHistoryByDealIds,
  listLoanHistoryLenders,
} from '@/services/deals/loan-history.service';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';


interface LenderSubRow {
  id: string;
  lender_name: string;
  percentage: number;
  release_date: string | null;
  status: string;
  principal_balance: number;
}

interface HistoryRow {
  id: string;
  dealId: string;
  dealNumber: string;
  borrowerName: string;
  dateDue: string | null;
  dateReceived: string | null;
  description: string;
  nextDueDate: string | null;
  total: number;
  principal: number;
  interest: number;
  lateFeePaid: number;
  servicingFees: number;
  reserves: number;
  other: number;
  principalBalance: number;
  lenders: LenderSubRow[];
}

const formatCurrency = (val: number | null | undefined): string => {
  if (val == null) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(val);
};

const formatDate = (val: string | null | undefined): string => {
  if (!val) return '-';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  } catch { return '-'; }
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

interface Props { borrowerId: string; contactDbId?: string; }

const BorrowerHistory: React.FC<Props> = ({ borrowerId, contactDbId }) => {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<string | null>('dateDue');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  // Header info
  const [headerAccountNumber, setHeaderAccountNumber] = useState('');
  const [headerBorrowerName, setHeaderBorrowerName] = useState('');

  useEffect(() => {
    const lookupId = contactDbId || borrowerId;
    if (!lookupId) return;

    const load = async () => {
      setIsLoading(true);
      try {
        // 1. Find deal_participants for this contact as borrower
        let allParticipants = contactDbId
          ? await listParticipantsByContactAndRole(contactDbId, 'borrower', 'deal_id, name')
          : [];

        if (allParticipants.length === 0 && borrowerId) {
          const borrowerSections = await fetchSectionValuesBySection('borrower');

          const matchedDealIds: string[] = [];
          (borrowerSections || []).forEach(bs => {
            const fv = bs.field_values as Record<string, any>;
            if (fv) {
              const vals = Object.values(fv);
              for (const v of vals) {
                if (typeof v === 'object' && v !== null && v.value_text === borrowerId) {
                  matchedDealIds.push(bs.deal_id);
                  break;
                }
                if (typeof v === 'string' && v === borrowerId) {
                  matchedDealIds.push(bs.deal_id);
                  break;
                }
              }
            }
          });

          if (matchedDealIds.length > 0) {
            allParticipants = matchedDealIds.map(did => ({ deal_id: did, name: null }));
          }
        }

        if (allParticipants.length === 0) {
          setRows([]);
          setIsLoading(false);
          return;
        }

        const dealIds = [...new Set(allParticipants.map(p => p.deal_id))];

        // 2. Fetch deals for header info
        const deals = await listDealsByIds(dealIds, 'id, deal_number, borrower_name');

        if (deals && deals.length > 0) {
          setHeaderAccountNumber(deals[0].deal_number || '');
          setHeaderBorrowerName(deals[0].borrower_name || allParticipants[0]?.name || '');
        }

        // 3. Fetch loan_history for these deals
        const historyRecords = await listLoanHistoryByDealIds(dealIds);
        const historyIds = historyRecords.map((h) => h.id);

        let lenderMap = new Map<string, LenderSubRow[]>();
        if (historyIds.length > 0) {
          const lenderData = await listLoanHistoryLenders(historyIds);

          (lenderData || []).forEach(lr => {
            const existing = lenderMap.get(lr.loan_history_id) || [];
            existing.push({
              id: lr.id,
              lender_name: lr.lender_name,
              percentage: lr.percentage || 0,
              release_date: lr.release_date,
              status: lr.status || 'Pending',
              principal_balance: lr.principal_balance || 0,
            });
            lenderMap.set(lr.loan_history_id, existing);
          });
        }

        const dealsMap = new Map((deals || []).map(d => [d.id, d]));

        // 5. Build rows
        const historyRows: HistoryRow[] = historyRecords.map(h => {
          const deal = dealsMap.get(h.deal_id);
          return {
            id: h.id,
            dealId: h.deal_id,
            dealNumber: deal?.deal_number || h.account_number || '',
            borrowerName: deal?.borrower_name || '',
            dateDue: h.date_due,
            dateReceived: h.date_received,
            description: h.description || h.payment_code || h.reference || '',
            nextDueDate: h.next_due_date,
            total: h.total_amount_received || 0,
            principal: h.applied_to_principal || 0,
            interest: h.applied_to_interest || 0,
            lateFeePaid: h.applied_to_late_charges || 0,
            servicingFees: h.servicing_fees || 0,
            reserves: h.applied_to_reserve || 0,
            other: h.other_amount || 0,
            principalBalance: h.principal_balance || 0,
            lenders: lenderMap.get(h.id) || [],
          };
        });

        setRows(historyRows);
      } catch (err) {
        console.error('Failed to load borrower history:', err);
        setRows([]);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [contactDbId, borrowerId]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSort = useCallback((col: string) => {
    if (sortCol === col) {
      setSortDir(prev => prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc');
      if (sortDir === 'desc') setSortCol(null);
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }, [sortCol, sortDir]);

  const filtered = useMemo(() => {
    let result = rows;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        r.description.toLowerCase().includes(q) ||
        r.dealNumber.toLowerCase().includes(q) ||
        r.borrowerName.toLowerCase().includes(q)
      );
    }

    if (sortCol && sortDir) {
      result = [...result].sort((a, b) => {
        let av: any, bv: any;
        const numCols = ['total', 'principal', 'interest', 'lateFeePaid', 'servicingFees', 'reserves', 'other', 'principalBalance'];
        if (numCols.includes(sortCol)) {
          av = (a as any)[sortCol] || 0;
          bv = (b as any)[sortCol] || 0;
        } else {
          av = (a as any)[sortCol] || '';
          bv = (b as any)[sortCol] || '';
        }
        if (typeof av === 'number' && typeof bv === 'number') {
          return sortDir === 'asc' ? av - bv : bv - av;
        }
        return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
    }

    return result;
  }, [rows, search, sortCol, sortDir]);

  // Pagination
  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIdx = (safeCurrentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalItems);
  const paginatedRows = filtered.slice(startIdx, endIdx);

  useEffect(() => { setCurrentPage(1); }, [search, pageSize]);

  const handleExport = () => {
    const headers = ['Due Date', 'Date Received', 'Description', 'Next Due Date', 'Total', 'Principal', 'Interest', 'Late Fee Paid', 'Servicing Fees', 'Reserves', 'Other', 'Principal Balance'];
    const csvRows = filtered.map(r =>
      [
        formatDate(r.dateDue), formatDate(r.dateReceived), r.description, formatDate(r.nextDueDate),
        r.total, r.principal, r.interest, r.lateFeePaid, r.servicingFees, r.reserves, r.other, r.principalBalance,
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    );
    const csv = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'borrower_history.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const COLUMNS = [
    { id: 'lenders', label: 'Lenders' },
    { id: 'dateDue', label: 'Due Date' },
    { id: 'dateReceived', label: 'Date Received' },
    { id: 'description', label: 'Description' },
    { id: 'nextDueDate', label: 'Next Due Date' },
    { id: 'total', label: 'Total' },
    { id: 'principal', label: 'Principal' },
    { id: 'interest', label: 'Interest' },
    { id: 'lateFeePaid', label: 'Late Fee Paid' },
    { id: 'servicingFees', label: 'Servicing Fees' },
    { id: 'reserves', label: 'Reserves' },
    { id: 'other', label: 'Other' },
    { id: 'principalBalance', label: 'Principal Balance' },
  ];

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-[hsl(var(--primary))] text-primary-foreground px-4 py-2 rounded-t-md">
        <div className="flex items-center gap-6 text-sm font-medium">
          {headerAccountNumber && <span>Account Number: {headerAccountNumber}</span>}
          {headerBorrowerName && <span>Borrower: {headerBorrowerName}</span>}
          {!headerAccountNumber && !headerBorrowerName && <span>History</span>}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-[280px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search history..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
          {search && (
            <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5" onClick={() => setSearch('')}>
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={handleExport}>
          <Download className="h-3.5 w-3.5" /> Export
        </Button>
      </div>

      {/* Table */}
      <div className="border border-border rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]">
                {COLUMNS.map(col => (
                  col.id === 'lenders' ? (
                    <TableHead key={col.id} className="text-primary-foreground text-xs font-semibold whitespace-nowrap px-3 py-2 w-[80px]">
                      {col.label}
                    </TableHead>
                  ) : (
                    <SortableTableHead
                      key={col.id}
                      columnId={col.id}
                      label={col.label}
                      sortColumnId={sortCol}
                      sortDirection={sortDir}
                      onSort={handleSort}
                      className="text-primary-foreground text-xs font-semibold whitespace-nowrap px-3 py-2 [&_svg]:text-primary-foreground/60"
                    />
                  )
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={COLUMNS.length} className="text-center py-8 text-sm text-muted-foreground">
                    Loading history...
                  </TableCell>
                </TableRow>
              ) : paginatedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={COLUMNS.length} className="text-center py-8 text-sm text-muted-foreground">
                    No history records found.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedRows.map((row, idx) => {
                  const isExpanded = expandedRows.has(row.id);
                  const hasLenders = row.lenders.length > 0;
                  return (
                    <React.Fragment key={row.id}>
                      <TableRow className={idx % 2 === 0 ? 'bg-background' : 'bg-muted/30'}>
                        <TableCell className="px-3 py-1.5 text-xs">
                          {hasLenders ? (
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => toggleExpand(row.id)}>
                              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </Button>
                          ) : (
                            <span className="inline-block w-5" />
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-1.5 text-xs whitespace-nowrap">{formatDate(row.dateDue)}</TableCell>
                        <TableCell className="px-3 py-1.5 text-xs whitespace-nowrap">{formatDate(row.dateReceived)}</TableCell>
                        <TableCell className="px-3 py-1.5 text-xs whitespace-nowrap">{row.description || '-'}</TableCell>
                        <TableCell className="px-3 py-1.5 text-xs whitespace-nowrap">{formatDate(row.nextDueDate)}</TableCell>
                        <TableCell className="px-3 py-1.5 text-xs whitespace-nowrap text-right">{formatCurrency(row.total)}</TableCell>
                        <TableCell className="px-3 py-1.5 text-xs whitespace-nowrap text-right">{formatCurrency(row.principal)}</TableCell>
                        <TableCell className="px-3 py-1.5 text-xs whitespace-nowrap text-right">{formatCurrency(row.interest)}</TableCell>
                        <TableCell className="px-3 py-1.5 text-xs whitespace-nowrap text-right">{formatCurrency(row.lateFeePaid)}</TableCell>
                        <TableCell className="px-3 py-1.5 text-xs whitespace-nowrap text-right">{formatCurrency(row.servicingFees)}</TableCell>
                        <TableCell className="px-3 py-1.5 text-xs whitespace-nowrap text-right">{formatCurrency(row.reserves)}</TableCell>
                        <TableCell className="px-3 py-1.5 text-xs whitespace-nowrap text-right">{formatCurrency(row.other)}</TableCell>
                        <TableCell className="px-3 py-1.5 text-xs whitespace-nowrap text-right font-medium">{formatCurrency(row.principalBalance)}</TableCell>
                      </TableRow>
                      {/* Expanded lender sub-rows */}
                      {isExpanded && row.lenders.map(lr => (
                        <TableRow key={lr.id} className="bg-muted/50">
                          <TableCell className="px-3 py-1 text-xs" />
                          <TableCell colSpan={2} className="px-3 py-1 text-xs font-medium text-muted-foreground pl-8">
                            {lr.lender_name}
                          </TableCell>
                          <TableCell className="px-3 py-1 text-xs text-muted-foreground">
                            {lr.percentage > 0 ? `${lr.percentage}%` : '-'}
                          </TableCell>
                          <TableCell className="px-3 py-1 text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(lr.release_date)}
                          </TableCell>
                          <TableCell className="px-3 py-1 text-xs text-muted-foreground">
                            {lr.status}
                          </TableCell>
                          <TableCell colSpan={6} />
                          <TableCell className="px-3 py-1 text-xs text-right text-muted-foreground">
                            {formatCurrency(lr.principal_balance)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </React.Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination footer */}
      {totalItems > 0 && (
        <div className="flex items-center justify-end gap-4 text-xs text-muted-foreground px-1">
          <div className="flex items-center gap-2">
            <span>Items per page:</span>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="h-7 w-[65px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map(s => (
                  <SelectItem key={s} value={String(s)}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span>{startIdx + 1} - {endIdx} of {totalItems}</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={safeCurrentPage <= 1} onClick={() => setCurrentPage(1)}>First</Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={safeCurrentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>Prev</Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={safeCurrentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>Next</Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={safeCurrentPage >= totalPages} onClick={() => setCurrentPage(totalPages)}>Last</Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BorrowerHistory;
