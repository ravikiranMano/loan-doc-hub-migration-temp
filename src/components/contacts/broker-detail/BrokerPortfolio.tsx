import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Download, Settings2, Loader2 } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from '@/components/ui/table';
import SortableTableHead from '@/components/deal/SortableTableHead';
import { type SortDirection } from '@/hooks/useGridSortFilter';
import { listParticipantsByContactAndRole } from '@/services/deals/participants.service';
import {
  fetchSectionValuesBySection,
  fetchSectionValuesForDeals,
} from '@/services/deals/section-values.service';
import { listDealsByIds } from '@/services/deals/deals.service';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';

import { format, parseISO, differenceInMonths, differenceInDays } from 'date-fns';
import { Badge } from '@/components/ui/badge';

const FIELD_IDS = {
  loanAmount: '163cd0b4-7cc0-4975-bcfb-43aa4be9c5c8',
  noteRate: '969b2029-d56f-4789-8d77-1f9aecc88f2b',
  principalBalance: '27c1bee2-05d4-46e5-a16b-e10c1e38cafd',
  maturityDate: '33fadfcb-b70c-4425-944e-23044f21a06b',
  nextPaymentDate: '384a8113-5d6d-47fd-9146-b3b1e9f65037',
};

interface PortfolioRow {
  id: string;
  dealId: string;
  dealNumber: string;
  brokerCode: string;
  borrowerName: string;
  propertyAddress: string;
  loanAmount: number;
  noteRate: number;
  maturityDate: string;
  outstandingBalance: number;
  loanStatus: string;
  nextPaymentDate: string;
  termLeft: string;
  daysLate: number;
  regularPayment: number;
}

const ALL_COLUMNS = [
  { id: 'dealNumber', label: 'Loan Account' },
  { id: 'borrowerName', label: 'Borrower Name' },
  { id: 'noteRate', label: 'Note Rate' },
  { id: 'regularPayment', label: 'Regular Payment' },
  { id: 'outstandingBalance', label: 'Principal Balance' },
  { id: 'nextPaymentDate', label: 'Next Payment' },
  { id: 'maturityDate', label: 'Maturity Date' },
  { id: 'termLeft', label: 'Term Left' },
  { id: 'daysLate', label: 'Days Late' },
  { id: 'propertyAddress', label: 'Property Description' },
];

function extractFieldValue(fv: Record<string, any>, fieldId: string, key: string): any {
  const entry = fv[fieldId];
  if (!entry) return null;
  if (typeof entry === 'object' && entry !== null) return entry[key] ?? null;
  return entry;
}

const fmtCurrency = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(v);

const fmtPct = (v: number) => (v != null && !isNaN(v) ? `${v.toFixed(2)}%` : '-');

const fmtDate = (v: string) => {
  if (!v) return '-';
  try { return format(parseISO(v), 'MM/dd/yyyy'); } catch { return '-'; }
};

function calcTermLeft(matStr: string): string {
  if (!matStr) return '-';
  try {
    const m = differenceInMonths(parseISO(matStr), new Date());
    if (m <= 0) return 'Matured';
    const y = Math.floor(m / 12);
    const r = m % 12;
    return y > 0 ? `${y}y ${r}m` : `${r}m`;
  } catch { return '-'; }
}

function calcDaysLate(nextStr: string): number {
  if (!nextStr) return 0;
  try {
    const d = differenceInDays(new Date(), parseISO(nextStr));
    return d > 0 ? d : 0;
  } catch { return 0; }
}

interface BrokerPortfolioProps {
  brokerId: string;
  contactDbId: string;
}

const BrokerPortfolio: React.FC<BrokerPortfolioProps> = ({ brokerId, contactDbId }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PortfolioRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>(null);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    new Set(ALL_COLUMNS.map(c => c.id))
  );

  const loadPortfolio = useCallback(async () => {
    setIsLoading(true);
    try {
      // 1. Find deal_participants for this broker
      let allParticipants = await listParticipantsByContactAndRole(
        contactDbId,
        'broker',
        'deal_id, role, name'
      );

      if (allParticipants.length === 0 && brokerId) {
        const brokerSections = await fetchSectionValuesBySection('broker');

        const matchedDealIds: string[] = [];
        (brokerSections || []).forEach(bs => {
          const fv = bs.field_values as Record<string, any>;
          if (!fv) return;
          for (const v of Object.values(fv)) {
            if (typeof v === 'object' && v !== null && (v as any).value_text === brokerId) {
              matchedDealIds.push(bs.deal_id);
              break;
            }
            if (typeof v === 'string' && v === brokerId) {
              matchedDealIds.push(bs.deal_id);
              break;
            }
          }
        });

        if (matchedDealIds.length > 0) {
          allParticipants = matchedDealIds.map(did => ({ deal_id: did, role: 'broker', name: '' }));
        }
      }

      if (allParticipants.length === 0) {
        setRows([]);
        setIsLoading(false);
        return;
      }

      const dealIds = [...new Set(allParticipants.map(p => p.deal_id))];

      const deals = await listDealsByIds(
        dealIds,
        'id, deal_number, borrower_name, property_address, loan_amount, status'
      );

      const dealsMap = new Map(deals.map((d) => [d.id, d]));

      const loanTermsSections = await fetchSectionValuesForDeals(dealIds, {
        section: 'loan_terms',
      });

      const loanTermsMap = new Map<string, Record<string, any>>();
      loanTermsSections.forEach((sv) => {
        loanTermsMap.set(sv.deal_id, sv.field_values as Record<string, any>);
      });

      const portfolioRows: PortfolioRow[] = [];

      for (const dealId of dealIds) {
        const deal = dealsMap.get(dealId);
        if (!deal) continue;

        const lt = loanTermsMap.get(dealId) || {};

        const totalLoanAmount = Number(
          extractFieldValue(lt, FIELD_IDS.loanAmount, 'value_number') || deal.loan_amount || 0
        );
        const noteRateVal = Number(
          extractFieldValue(lt, FIELD_IDS.noteRate, 'value_number') || 0
        );
        const principalBalanceFull = Number(
          extractFieldValue(lt, FIELD_IDS.principalBalance, 'value_number') || totalLoanAmount
        );
        const maturityDateVal =
          extractFieldValue(lt, FIELD_IDS.maturityDate, 'value_date') ||
          extractFieldValue(lt, FIELD_IDS.maturityDate, 'value_text') || '';
        const nextPaymentVal =
          extractFieldValue(lt, FIELD_IDS.nextPaymentDate, 'value_date') ||
          extractFieldValue(lt, FIELD_IDS.nextPaymentDate, 'value_text') || '';

        const daysLate = calcDaysLate(nextPaymentVal);
        let loanStatus = 'Active';
        const lsRaw = lt['loan_status'] || lt['status'] || '';
        if (typeof lsRaw === 'string') {
          if (lsRaw.toLowerCase().includes('paid') || lsRaw.toLowerCase().includes('closed')) loanStatus = 'Paid Off';
          if (lsRaw.toLowerCase().includes('default')) loanStatus = 'Default';
          if (lsRaw.toLowerCase().includes('delinquent')) loanStatus = 'Delinquent';
        }
        if (daysLate > 30 && loanStatus === 'Active') loanStatus = 'Delinquent';

        portfolioRows.push({
          id: `${dealId}-${brokerId}`,
          dealId,
          dealNumber: deal.deal_number || '-',
          brokerCode: brokerId || '',
          borrowerName: deal.borrower_name || '-',
          propertyAddress: deal.property_address || '-',
          loanAmount: totalLoanAmount,
          noteRate: noteRateVal,
          maturityDate: maturityDateVal,
          outstandingBalance: principalBalanceFull,
          loanStatus,
          nextPaymentDate: nextPaymentVal,
          termLeft: calcTermLeft(maturityDateVal),
          daysLate,
          regularPayment: 0,
        });
      }

      setRows(portfolioRows);
    } catch (err) {
      console.error('Failed to load broker portfolio:', err);
    } finally {
      setIsLoading(false);
    }
  }, [brokerId, contactDbId]);

  useEffect(() => {
    if (contactDbId) loadPortfolio();
  }, [contactDbId, loadPortfolio]);

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
    let result = rows;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        r.dealNumber.toLowerCase().includes(q) ||
        r.borrowerName.toLowerCase().includes(q) ||
        r.propertyAddress.toLowerCase().includes(q)
      );
    }
    if (sortCol && sortDir) {
      result = [...result].sort((a, b) => {
        const av = (a as any)[sortCol];
        const bv = (b as any)[sortCol];
        if (typeof av === 'number' && typeof bv === 'number') {
          return sortDir === 'asc' ? av - bv : bv - av;
        }
        return sortDir === 'asc'
          ? String(av || '').localeCompare(String(bv || ''))
          : String(bv || '').localeCompare(String(av || ''));
      });
    }
    return result;
  }, [rows, search, sortCol, sortDir]);

  const toggleColumn = (colId: string) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      next.has(colId) ? next.delete(colId) : next.add(colId);
      return next;
    });
  };

  const formatCellValue = (colId: string, row: PortfolioRow): string => {
    switch (colId) {
      case 'loanAmount': return fmtCurrency(row.loanAmount);
      case 'noteRate': return fmtPct(row.noteRate);
      case 'regularPayment': return fmtCurrency(row.regularPayment);
      case 'outstandingBalance': return fmtCurrency(row.outstandingBalance);
      case 'maturityDate': return fmtDate(row.maturityDate);
      case 'nextPaymentDate': return fmtDate(row.nextPaymentDate);
      case 'daysLate': return row.daysLate > 0 ? String(row.daysLate) : '0';
      default: return String((row as any)[colId] || '-');
    }
  };

  const handleExport = () => {
    const headers = activeColumns.map(c => c.label).join(',');
    const csvRows = filtered.map(r =>
      activeColumns.map(c => `"${String(formatCellValue(c.id, r)).replace(/"/g, '""')}"`).join(',')
    );
    const csv = [headers, ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'broker_portfolio.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRowClick = (row: PortfolioRow) => {
    navigate(`/deals/${row.dealId}/data`);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Delinquent':
      case 'Default':
        return <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{status}</Badge>;
      case 'Paid Off':
      case 'Closed':
        return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{status}</Badge>;
      case 'Active':
        return <Badge className="text-[10px] px-1.5 py-0 bg-emerald-600 hover:bg-emerald-700">{status}</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px] px-1.5 py-0">{status}</Badge>;
    }
  };

  const getRowClassName = (row: PortfolioRow) => {
    if (row.loanStatus === 'Delinquent' || row.loanStatus === 'Default') {
      return 'cursor-pointer hover:bg-muted/60 bg-destructive/5 border-l-2 border-l-destructive';
    }
    return 'cursor-pointer hover:bg-muted/60';
  };

  return (
    <div className="space-y-4">
      <h4 className="text-lg font-semibold text-foreground">Portfolio</h4>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search deals..." value={search} onChange={e => setSearch(e.target.value)} className="pl-7 h-8 w-[200px] text-xs" />
        </div>
        <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" onClick={handleExport}>
          <Download className="h-3.5 w-3.5" /> Export
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1 h-8 text-xs"><Settings2 className="h-3.5 w-3.5" /> Columns</Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3" align="end">
            <div className="space-y-2">
              <span className="text-sm font-medium">Toggle Columns</span>
              {ALL_COLUMNS.map(c => (
                <div key={c.id} className="flex items-center gap-2">
                  <Checkbox id={`bp-col-${c.id}`} checked={visibleColumns.has(c.id)} onCheckedChange={() => toggleColumn(c.id)} />
                  <label htmlFor={`bp-col-${c.id}`} className="text-xs cursor-pointer">{c.label}</label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-x-auto">
        <Table className="min-w-[1400px]">
          <TableHeader>
            <TableRow className="bg-muted/50">
              {activeColumns.map(c => (
                <SortableTableHead key={c.id} columnId={c.id} label={c.label} sortColumnId={sortCol} sortDirection={sortDir} onSort={handleSort} className="whitespace-nowrap text-xs" />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={activeColumns.length} className="text-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={activeColumns.length} className="text-center py-8 text-muted-foreground text-sm">
                  No loans found for this broker. Portfolio will automatically populate when this broker is added to a deal.
                </TableCell>
              </TableRow>
            ) : filtered.map(r => (
              <TableRow key={r.id} className={getRowClassName(r)} onClick={() => handleRowClick(r)}>
                {activeColumns.map(c => (
                  <TableCell key={c.id} className="whitespace-nowrap text-xs">
                    {c.id === 'loanStatus' ? getStatusBadge(r.loanStatus) : (
                      c.id === 'daysLate' && r.daysLate > 30 ? (
                        <span className="text-destructive font-medium">{formatCellValue(c.id, r)}</span>
                      ) : formatCellValue(c.id, r)
                    )}
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

export default BrokerPortfolio;
