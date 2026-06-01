import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Download, Settings2, Loader2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import SortableTableHead from '@/components/deal/SortableTableHead';
import { type SortDirection } from '@/hooks/useGridSortFilter';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  resolveContactPortfolioDealIds,
  fetchContactPortfolioDealContext,
} from '@/services/contacts/contact-portfolio.service';
import { format, parseISO, differenceInDays } from 'date-fns';
import {
  extractPortfolioLoanAmount,
  extractSectionFieldValue,
  PORTFOLIO_FIELD_IDS,
} from '@/lib/sectionFieldValues';

const FIELD_IDS = PORTFOLIO_FIELD_IDS;

interface PortfolioRow {
  id: string;
  dealId: string;
  loanId: string;
  accountNumber: string;
  loanStatus: string;
  originalAmount: number;
  currentBalance: number;
  guaranteeType: string;
  guaranteeAmount: number;
  guaranteeDate: string;
  maturityDate: string;
  daysPastDue: number;
  defaultStatus: string;
  legalActionStatus: string;
}

const DEFAULT_VISIBLE = new Set([
  'loanId', 'accountNumber', 'loanStatus',
  'originalAmount', 'currentBalance',
  'guaranteeType',
  'guaranteeAmount', 'guaranteeDate',
  'maturityDate', 'daysPastDue',
  'defaultStatus', 'legalActionStatus',
]);

const ALL_COLUMNS = [
  { id: 'loanId', label: 'Loan ID' },
  { id: 'accountNumber', label: 'Account Number' },
  { id: 'loanStatus', label: 'Loan Status' },
  { id: 'originalAmount', label: 'Original Amount' },
  { id: 'currentBalance', label: 'Current Balance' },
  { id: 'guaranteeType', label: 'Guarantee Type' },
  { id: 'guaranteeAmount', label: 'Guarantee Amount' },
  { id: 'guaranteeDate', label: 'Guarantee Date' },
  { id: 'maturityDate', label: 'Maturity Date' },
  { id: 'daysPastDue', label: 'Days Past Due' },
  { id: 'defaultStatus', label: 'Default Status' },
  { id: 'legalActionStatus', label: 'Legal Action Status' },
];

const fmtCurrency = (v: number) =>
  v ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(v) : '-';

const fmtDate = (v: string) => {
  if (!v) return '-';
  try { return format(parseISO(v), 'MM/dd/yyyy'); } catch { return '-'; }
};

function extractFieldValue(
  fv: Record<string, any>,
  fieldId: string | string[],
  valueKey: 'value_number' | 'value_text' | 'value_date' | 'auto' = 'auto',
): any {
  const prefer = valueKey === 'auto' ? 'auto' : valueKey;
  return extractSectionFieldValue(fv, fieldId, prefer);
}

function calcDaysLate(nextStr: string): number {
  if (!nextStr) return 0;
  try {
    const d = differenceInDays(new Date(), parseISO(nextStr));
    return d > 0 ? d : 0;
  } catch { return 0; }
}

interface Props {
  guarantorId: string;
  contactDbId: string;
}

const GuarantorPortfolio: React.FC<Props> = ({ guarantorId, contactDbId }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PortfolioRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>(null);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(DEFAULT_VISIBLE));

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const dealIds = await resolveContactPortfolioDealIds({
        contactDbId,
        externalId: guarantorId,
      });

      if (dealIds.length === 0) {
        setRows([]);
        setIsLoading(false);
        return;
      }

      const { dealsMap, loanTermsMap: ltMap, borrowerMap: brMap } =
        await fetchContactPortfolioDealContext(dealIds);

      const portfolioRows: PortfolioRow[] = [];

      for (const dealId of dealIds) {
        const deal = dealsMap.get(dealId);
        if (!deal) continue;
        const lt = ltMap.get(dealId) || {};
        const br = brMap.get(dealId) || {};

        const findIn = (obj: Record<string, any>, ...frags: string[]): any => {
          for (const [k, v] of Object.entries(obj)) {
            const lk = k.toLowerCase();
            if (frags.some(f => lk.includes(f))) {
              if (v && typeof v === 'object') {
                const o = v as Record<string, any>;
                return o.value_number ?? o.value_date ?? o.value_text ?? null;
              }
              return v;
            }
          }
          return null;
        };

        const originalAmount = Number(
          extractPortfolioLoanAmount(lt) || deal.loan_amount || 0,
        );
        const currentBalance = Number(
          extractFieldValue(lt, FIELD_IDS.principalBalance, 'value_number') || originalAmount,
        );
        const maturityDate =
          extractFieldValue(lt, FIELD_IDS.maturityDate, 'value_date') ||
          extractFieldValue(lt, FIELD_IDS.maturityDate, 'value_text') || '';
        const nextPaymentDate =
          extractFieldValue(lt, FIELD_IDS.nextPaymentDate, 'value_date') ||
          extractFieldValue(lt, FIELD_IDS.nextPaymentDate, 'value_text') || '';
        const accountNumber =
          extractFieldValue(lt, FIELD_IDS.accountNumber, 'value_text') ||
          findIn(lt, 'account_number', 'loan_account') || '';

        const daysPastDue = calcDaysLate(nextPaymentDate);

        const lsField = extractFieldValue(lt, FIELD_IDS.loanStatus, 'value_text');
        let loanStatus = 'Active';
        const lsRaw = lsField || lt['loan_status'] || lt['status'] || '';
        if (typeof lsRaw === 'string' && lsRaw) {
          loanStatus = lsRaw;
          const low = lsRaw.toLowerCase();
          if (low.includes('paid') || low.includes('closed')) loanStatus = 'Paid Off';
          else if (low.includes('default')) loanStatus = 'Default';
          else if (low.includes('delinquent')) loanStatus = 'Delinquent';
          else if (low.includes('active')) loanStatus = 'Active';
        }
        if (daysPastDue > 30 && loanStatus === 'Active') loanStatus = 'Delinquent';

        // Guarantee-specific fields (best-effort from borrower or loan_terms; '-' fallback)
        const guaranteeTypeRaw = findIn(br, 'guarantor.guarantee_type', 'guarantee_type') ||
          findIn(lt, 'guarantee_type') || '';
        const guaranteeType = typeof guaranteeTypeRaw === 'string' && guaranteeTypeRaw
          ? guaranteeTypeRaw.charAt(0).toUpperCase() + guaranteeTypeRaw.slice(1).toLowerCase()
          : '';
        const guaranteeAmount = Number(
          findIn(br, 'guarantor.guarantee_amount', 'guarantee_amount') ||
          findIn(lt, 'guarantee_amount') || 0,
        );
        const guaranteeDate = String(
          findIn(br, 'guarantor.guarantee_date', 'guarantee_date') ||
          findIn(lt, 'guarantee_date') || '',
        );
        const defaultStatusRaw = findIn(br, 'default_status') || findIn(lt, 'default_status');
        const defaultStatus = defaultStatusRaw
          ? String(defaultStatusRaw)
          : (loanStatus === 'Default' ? 'In Default' : 'None');
        const legalActionStatusRaw =
          findIn(br, 'legal_action_status', 'legal_action') ||
          findIn(lt, 'legal_action_status', 'legal_action');
        const legalActionStatus = legalActionStatusRaw ? String(legalActionStatusRaw) : 'None';

        portfolioRows.push({
          id: `${dealId}-${guarantorId || contactDbId}`,
          dealId,
          loanId: deal.deal_number || '-',
          accountNumber: accountNumber ? String(accountNumber) : '-',
          loanStatus,
          originalAmount,
          currentBalance,
          guaranteeType: guaranteeType || '-',
          guaranteeAmount,
          guaranteeDate,
          maturityDate,
          daysPastDue,
          defaultStatus,
          legalActionStatus,
        });
      }

      setRows(portfolioRows);
    } catch (err) {
      console.error('Failed to load guarantor portfolio:', err);
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [contactDbId, guarantorId]);

  useEffect(() => {
    if (contactDbId) load();
  }, [contactDbId, load]);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : sortDir === 'desc' ? null : 'asc');
      if (sortDir === 'desc') setSortCol(null);
    } else { setSortCol(col); setSortDir('asc'); }
  };

  const activeColumns = useMemo(
    () => ALL_COLUMNS.filter(c => visibleColumns.has(c.id)),
    [visibleColumns],
  );

  const filtered = useMemo(() => {
    let result = rows;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        r.loanId.toLowerCase().includes(q) ||
        r.accountNumber.toLowerCase().includes(q) ||
        r.loanStatus.toLowerCase().includes(q),
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

  const formatCell = (colId: string, row: PortfolioRow): React.ReactNode => {
    switch (colId) {
      case 'originalAmount': return fmtCurrency(row.originalAmount);
      case 'currentBalance': return fmtCurrency(row.currentBalance);
      case 'guaranteeAmount': return fmtCurrency(row.guaranteeAmount);
      case 'guaranteeDate': return fmtDate(row.guaranteeDate);
      case 'maturityDate': return fmtDate(row.maturityDate);
      case 'daysPastDue':
        return row.daysPastDue > 30
          ? <span className="text-destructive font-medium">{row.daysPastDue}</span>
          : (row.daysPastDue || '0');
      case 'loanStatus': {
        const s = row.loanStatus;
        if (s === 'Default' || s === 'Delinquent') return <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{s}</Badge>;
        if (s === 'Paid Off' || s === 'Closed') return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{s}</Badge>;
        if (s === 'Active') return <Badge className="text-[10px] px-1.5 py-0 bg-emerald-600 hover:bg-emerald-700">{s}</Badge>;
        return <Badge variant="outline" className="text-[10px] px-1.5 py-0">{s}</Badge>;
      }
      case 'defaultStatus': {
        const s = row.defaultStatus;
        if (s && s.toLowerCase() !== 'none')
          return <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{s}</Badge>;
        return <span className="text-muted-foreground">None</span>;
      }
      case 'legalActionStatus': {
        const s = row.legalActionStatus;
        if (s && s.toLowerCase() !== 'none')
          return <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{s}</Badge>;
        return <span className="text-muted-foreground">None</span>;
      }
      default: return String((row as any)[colId] || '-');
    }
  };

  const handleExport = () => {
    const headers = activeColumns.map(c => c.label).join(',');
    const csvRows = filtered.map(r =>
      activeColumns.map(c => {
        const v = formatCell(c.id, r);
        const text = typeof v === 'string' || typeof v === 'number' ? String(v) : String((r as any)[c.id] ?? '');
        return `"${text.replace(/"/g, '""')}"`;
      }).join(','),
    );
    const csv = [headers, ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'guarantor_portfolio.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const rowClass = (r: PortfolioRow) => {
    if (r.loanStatus === 'Default' || r.loanStatus === 'Delinquent' || (r.legalActionStatus && r.legalActionStatus.toLowerCase() !== 'none')) {
      return 'cursor-pointer hover:bg-muted/60 bg-destructive/5 border-l-2 border-l-destructive';
    }
    return 'cursor-pointer hover:bg-muted/60';
  };

  return (
    <div className="space-y-4">
      <h4 className="text-lg font-semibold text-foreground">Portfolio</h4>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search loans..." value={search} onChange={e => setSearch(e.target.value)} className="pl-7 h-8 w-[200px] text-xs" />
        </div>
        <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" onClick={handleExport}>
          <Download className="h-3.5 w-3.5" /> Export
        </Button>
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
                  <Checkbox id={`gp-col-${c.id}`} checked={visibleColumns.has(c.id)} onCheckedChange={() => toggleColumn(c.id)} />
                  <label htmlFor={`gp-col-${c.id}`} className="text-xs cursor-pointer">{c.label}</label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="border border-border rounded-lg overflow-x-auto">
        <Table className="min-w-[1400px]">
          <TableHeader>
            <TableRow className="bg-muted/50">
              {activeColumns.map(c => (
                <SortableTableHead key={c.id} columnId={c.id} label={c.label}
                  sortColumnId={sortCol} sortDirection={sortDir} onSort={handleSort}
                  className="whitespace-nowrap text-xs" />
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
                  No loans found for this guarantor. Portfolio will populate when this guarantor is added to a deal.
                </TableCell>
              </TableRow>
            ) : filtered.map(r => (
              <TableRow key={r.id} className={rowClass(r)} onClick={() => navigate(`/deals/${r.dealId}/data`)}>
                {activeColumns.map(c => (
                  <TableCell key={c.id} className="whitespace-nowrap text-xs">
                    {formatCell(c.id, r)}
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

export default GuarantorPortfolio;
