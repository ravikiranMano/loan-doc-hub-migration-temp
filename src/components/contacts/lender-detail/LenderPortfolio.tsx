import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Download, Settings2, Filter, Loader2 } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import SortableTableHead from '@/components/deal/SortableTableHead';
import { type SortDirection } from '@/hooks/useGridSortFilter';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { format, parseISO, differenceInMonths, differenceInDays } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const FIELD_IDS = {
  loanAmount: '163cd0b4-7cc0-4975-bcfb-43aa4be9c5c8',
  noteRate: '969b2029-d56f-4789-8d77-1f9aecc88f2b',
  principalBalance: '27c1bee2-05d4-46e5-a16b-e10c1e38cafd',
  maturityDate: '33fadfcb-b70c-4425-944e-23044f21a06b',
  nextPaymentDate: '384a8113-5d6d-47fd-9146-b3b1e9f65037',
  fundingRecords: 'fe607d1f-3d27-4e37-8d10-326ac34d7a3f',
  fundingHistory: 'b179de11-dbe6-4e3b-b987-0a155114bc52',
  // Spec additions resolved from field_dictionary
  accountNumber: 'b593a1fb-df22-405c-8ed0-670d251901a4', // ln_p_previousAccountNumber
  loanStatus: '356839ff-f156-4431-ac7d-87f038428178',    // ln_p_loanStatus
  paymentAmount: '273499a9-02a6-4a18-abb7-47c7cc9755ac', // ln_p_paymentAmount
};

interface PortfolioRow {
  id: string;
  dealId: string;
  dealNumber: string;
  lenderCode: string;
  borrowerName: string;
  propertyAddress: string;
  loanAmount: number;
  capacity: string;
  fundingAmount: number;
  ownershipPct: number;
  noteRate: number;
  lenderRate: number;
  maturityDate: string;
  outstandingBalance: number;
  currentBalance: number;
  accruedInterest: number;
  paymentReceived: number;
  roiYield: number;
  loanStatus: string;
  nextPaymentDate: string;
  termLeft: string;
  daysLate: number;
  regularPayment: number;
  // Spec additions
  accountNumber: string;
  fundingDate: string;
  interestFromDate: string;
  spreadPct: number;
  disbursements: number;
  netPayment: number;
  totalEarnedToDate: number;
}

const DEFAULT_VISIBLE_LP = new Set([
  'dealNumber', 'accountNumber', 'loanStatus',
  'fundingAmount', 'currentBalance',
  'ownershipPct',
  'fundingDate', 'interestFromDate',
  'noteRate', 'lenderRate', 'spreadPct',
  'regularPayment', 'disbursements', 'netPayment',
  'maturityDate', 'totalEarnedToDate',
]);

const ALL_COLUMNS = [
  { id: 'dealNumber', label: 'Loan ID' },
  { id: 'accountNumber', label: 'Account Number' },
  { id: 'loanStatus', label: 'Loan Status' },
  { id: 'fundingAmount', label: 'Funding Amount' },
  { id: 'currentBalance', label: 'Current Balance' },
  { id: 'ownershipPct', label: 'Pro Rata %' },
  { id: 'fundingDate', label: 'Funding Date' },
  { id: 'interestFromDate', label: 'Interest From Date' },
  { id: 'noteRate', label: 'Note Rate' },
  { id: 'lenderRate', label: 'Lender Rate' },
  { id: 'spreadPct', label: 'Spread %' },
  { id: 'regularPayment', label: 'Monthly Payment' },
  { id: 'disbursements', label: 'Disbursements' },
  { id: 'netPayment', label: 'Net Payment' },
  { id: 'maturityDate', label: 'Maturity Date' },
  { id: 'totalEarnedToDate', label: 'Total Earned to Date' },
  // Optional (hidden by default)
  { id: 'borrowerName', label: 'Borrower Name' },
  { id: 'outstandingBalance', label: 'Principal Balance' },
  { id: 'nextPaymentDate', label: 'Next Payment' },
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

function parseFundingRecords(fv: Record<string, any>): any[] {
  // Try UUID key first, then legacy key
  const raw = fv[FIELD_IDS.fundingRecords] || fv['loan_terms.funding_records'];
  if (!raw) return [];
  try {
    // Handle the field_values structure: { value_text: "[...]", value_json: ... }
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      const textVal = raw.value_text || raw.value_json;
      if (textVal) {
        const parsed = typeof textVal === 'string' ? JSON.parse(textVal) : textVal;
        if (Array.isArray(parsed)) return parsed;
      }
    }
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === 'object' && parsed !== null) {
      const val = parsed.value_json || parsed.value_text;
      const records = val ? (typeof val === 'string' ? JSON.parse(val) : val) : parsed;
      if (Array.isArray(records)) return records;
    }
  } catch { /* ignore */ }
  return [];
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

interface LenderPortfolioProps {
  lenderId: string;
  contactDbId: string;
}

const LenderPortfolio: React.FC<LenderPortfolioProps> = ({ lenderId, contactDbId }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PortfolioRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>(null);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(DEFAULT_VISIBLE_LP));
  const [capacityFilter, setCapacityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const loadPortfolio = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data: participants, error: pErr } = await supabase
        .from('deal_participants')
        .select('deal_id, role, name')
        .eq('contact_id', contactDbId)
        .eq('role', 'lender');

      if (pErr) throw pErr;
      if (!participants || participants.length === 0) {
        setRows([]);
        setIsLoading(false);
        return;
      }

      const dealIds = [...new Set(participants.map(p => p.deal_id))];

      const { data: deals } = await supabase
        .from('deals')
        .select('id, deal_number, borrower_name, property_address, loan_amount, status')
        .in('id', dealIds);

      const dealsMap = new Map((deals || []).map(d => [d.id, d]));

      const { data: loanTermsSections } = await supabase
        .from('deal_section_values')
        .select('deal_id, field_values')
        .in('deal_id', dealIds)
        .eq('section', 'loan_terms');

      const loanTermsMap = new Map<string, Record<string, any>>();
      (loanTermsSections || []).forEach(sv => {
        loanTermsMap.set(sv.deal_id, sv.field_values as Record<string, any>);
      });

      const { data: participantSections } = await supabase
        .from('deal_section_values')
        .select('deal_id, field_values')
        .in('deal_id', dealIds)
        .eq('section', 'participants');

      const capacityMap = new Map<string, string>();
      (participantSections || []).forEach(ps => {
        const fv = ps.field_values as Record<string, any>;
        if (!fv) return;
        Object.entries(fv).forEach(([key, val]) => {
          if (key.includes('capacity') && typeof val === 'string') {
            const contactKey = key.replace('capacity', 'contact_id');
            if (fv[contactKey] === contactDbId) {
              capacityMap.set(ps.deal_id, val);
            }
          }
        });
      });

      // Fetch charges section for accrued interest
      const { data: chargesSections } = await supabase
        .from('deal_section_values')
        .select('deal_id, field_values')
        .in('deal_id', dealIds)
        .eq('section', 'charges');

      const chargesMap = new Map<string, Record<string, any>>();
      (chargesSections || []).forEach(cs => {
        chargesMap.set(cs.deal_id, cs.field_values as Record<string, any>);
      });

      const portfolioRows: PortfolioRow[] = [];

      for (const dealId of dealIds) {
        const deal = dealsMap.get(dealId);
        if (!deal) continue;

        const lt = loanTermsMap.get(dealId) || {};
        const ch = chargesMap.get(dealId) || {};
        const fundingRecords = parseFundingRecords(lt);

        // Strict Lender Code mapping: match funding record by Lender Code (contact_id),
        // contact UUID, or lender name as a fallback.
        const fundingRec = fundingRecords.find(
          r =>
            r.lenderAccount === lenderId ||
            r.lenderCode === lenderId ||
            r.lenderId === contactDbId ||
            r.lenderContactId === contactDbId ||
            r.lenderName === lenderId
        ) || null;

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

        const pctOwned = fundingRec ? Number(fundingRec.pctOwned || 0) : 0;
        const lenderRate = fundingRec ? Number(fundingRec.lenderRate || 0) : 0;
        const regularPayment = fundingRec ? Number(fundingRec.regularPayment || 0) : 0;
        const fundingAmount = fundingRec ? Number(fundingRec.originalAmount || 0) : 0;
        const lenderBalance = pctOwned > 0
          ? principalBalanceFull * (pctOwned / 100)
          : (fundingRec ? Number(fundingRec.principalBalance || 0) : 0);
        const disbSumLender = fundingRec && Array.isArray(fundingRec.disbursements)
          ? fundingRec.disbursements.reduce(
              (s: number, d: any) => s + (parseFloat(String(d?.amount || '').replace(/[$,]/g, '')) || 0), 0
            )
          : 0;
        const lenderCurrentBalance = fundingRec && fundingRec.currentBalance !== undefined && fundingRec.currentBalance !== null && !isNaN(Number(fundingRec.currentBalance))
          ? Number(fundingRec.currentBalance)
          : Math.max(0, fundingAmount - disbSumLender);

        const rawCapacity = capacityMap.get(dealId) || '';
        const CAPACITY_MAP: Record<string, string> = {
          primary_lender: 'Primary Lender',
          participant_lender: 'Participant Lender',
          syndicate_lender: 'Syndicate Lender',
          authorized_party: 'Authorized Party',
        };
        const displayCapacity = CAPACITY_MAP[rawCapacity] || 'Primary Lender';

        const ownershipPct = totalLoanAmount > 0
          ? (fundingAmount / totalLoanAmount) * 100
          : pctOwned;

        // Payment received (pro-rata share of total payments)
        const totalPaymentsRaw = fundingRec ? Number(fundingRec.totalPayments || 0) : 0;
        const paymentReceived = totalPaymentsRaw > 0 ? totalPaymentsRaw : (regularPayment * 3); // estimate if not tracked

        // Accrued interest from charges or calculate
        let accruedInterest = 0;
        const resolveChargeField = (obj: Record<string, any>, ...frags: string[]) => {
          for (const [key, val] of Object.entries(obj)) {
            for (const frag of frags) {
              if (key.toLowerCase().includes(frag.toLowerCase())) return Number(val) || 0;
            }
          }
          return 0;
        };
        accruedInterest = resolveChargeField(ch, 'accrued_interest', 'unpaid_interest');
        if (accruedInterest === 0 && lenderBalance > 0 && lenderRate > 0) {
          accruedInterest = (lenderBalance * (lenderRate / 100)) / 365 * 30; // ~1 month estimate
        }
        // Pro-rata accrued interest
        if (ownershipPct > 0 && ownershipPct < 100) {
          accruedInterest = accruedInterest * (ownershipPct / 100);
        }

        // ROI / Yield calculation
        let roiYield = 0;
        if (fundingAmount > 0) {
          const effectiveRate = lenderRate > 0 ? lenderRate : noteRateVal;
          roiYield = effectiveRate;
        }

        // Loan status with delinquent detection
        const daysLate = calcDaysLate(nextPaymentVal);
        let loanStatus = 'Active';
        const lsRaw = lt['loan_status'] || lt['status'] || '';
        if (typeof lsRaw === 'string') {
          if (lsRaw.toLowerCase().includes('paid') || lsRaw.toLowerCase().includes('closed')) loanStatus = 'Paid Off';
          if (lsRaw.toLowerCase().includes('default')) loanStatus = 'Default';
          if (lsRaw.toLowerCase().includes('delinquent')) loanStatus = 'Delinquent';
        }
        if (deal.status === 'generated') loanStatus = loanStatus === 'Active' ? 'Active' : loanStatus;
        // Auto-detect delinquent based on days late
        if (daysLate > 30 && loanStatus === 'Active') loanStatus = 'Delinquent';

        // Spec column derivations from fundingRec / loan_terms
        const findLT = (...frags: string[]): any => {
          for (const [k, v] of Object.entries(lt)) {
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
        const accountNumberVal = fundingRec?.lenderAccount || fundingRec?.accountNumber
          || extractFieldValue(lt, FIELD_IDS.accountNumber, 'value_text')
          || findLT('account_number', 'loan_account', 'previousaccount') || '';
        const fundingDateVal = fundingRec?.fundingDate || findLT('funding_date', 'closing_date', 'originat') || '';
        const interestFromDateVal = fundingRec?.interestFromDate || findLT('interest_from', 'interestpaidto') || '';
        const spreadPctVal = (noteRateVal || 0) - (lenderRate || 0);
        const disbursementsSum = disbSumLender;
        const netPaymentVal = regularPayment - disbursementsSum;
        const totalEarnedVal = Number(fundingRec?.totalEarned || fundingRec?.totalInterestEarned || 0);

        portfolioRows.push({
          id: `${dealId}-${lenderId}`,
          dealId,
          dealNumber: deal.deal_number || '-',
          lenderCode: lenderId || '',
          borrowerName: deal.borrower_name || '-',
          propertyAddress: deal.property_address || '-',
          loanAmount: totalLoanAmount,
          capacity: displayCapacity,
          fundingAmount,
          ownershipPct: ownershipPct > 0 ? ownershipPct : pctOwned,
          noteRate: noteRateVal,
          lenderRate,
          maturityDate: maturityDateVal,
          outstandingBalance: lenderBalance,
          currentBalance: lenderCurrentBalance,
          accruedInterest,
          paymentReceived,
          roiYield,
          loanStatus,
          nextPaymentDate: nextPaymentVal,
          termLeft: calcTermLeft(maturityDateVal),
          daysLate,
          regularPayment,
          accountNumber: accountNumberVal ? String(accountNumberVal) : '-',
          fundingDate: fundingDateVal ? String(fundingDateVal) : '',
          interestFromDate: interestFromDateVal ? String(interestFromDateVal) : '',
          spreadPct: spreadPctVal,
          disbursements: disbursementsSum,
          netPayment: netPaymentVal,
          totalEarnedToDate: totalEarnedVal,
        });
      }

      setRows(portfolioRows);
    } catch (err) {
      console.error('Failed to load lender portfolio:', err);
    } finally {
      setIsLoading(false);
    }
  }, [lenderId, contactDbId]);

  useEffect(() => {
    if (contactDbId) loadPortfolio();
  }, [contactDbId, loadPortfolio]);

  // Summary metrics
  const summary = useMemo(() => {
    const totalLoans = rows.length;
    const totalInvested = rows.reduce((s, r) => s + r.fundingAmount, 0);
    const totalOutstanding = rows.reduce((s, r) => s + r.outstandingBalance, 0);
    const activeLoans = rows.filter(r => r.loanStatus === 'Active').length;
    const delinquentLoans = rows.filter(r => r.loanStatus === 'Delinquent').length;
    const delinquencyRate = totalLoans > 0 ? (delinquentLoans / totalLoans) * 100 : 0;
    const avgRoi = rows.length > 0 ? rows.reduce((s, r) => s + r.roiYield, 0) / rows.length : 0;
    const totalAccruedInterest = rows.reduce((s, r) => s + r.accruedInterest, 0);
    return { totalLoans, totalInvested, totalOutstanding, activeLoans, delinquentLoans, delinquencyRate, avgRoi, totalAccruedInterest };
  }, [rows]);

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
    if (capacityFilter !== 'all') {
      result = result.filter(r => r.capacity === capacityFilter);
    }
    if (statusFilter !== 'all') {
      result = result.filter(r => r.loanStatus === statusFilter);
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
  }, [rows, search, sortCol, sortDir, capacityFilter, statusFilter]);

  const toggleColumn = (colId: string) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      next.has(colId) ? next.delete(colId) : next.add(colId);
      return next;
    });
  };

  const handleExport = () => {
    const headers = activeColumns.map(c => c.label).join(',');
    const csvRows = filtered.map(r =>
      activeColumns.map(c => {
        const val = formatCellValue(c.id, r);
        return `"${String(val).replace(/"/g, '""')}"`;
      }).join(',')
    );
    const csv = [headers, ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lender_portfolio.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRowClick = (row: PortfolioRow) => {
    navigate(`/deals/${row.dealId}/data`);
  };

  const formatCellValue = (colId: string, row: PortfolioRow): string => {
    switch (colId) {
      case 'loanAmount': return fmtCurrency(row.loanAmount);
      case 'fundingAmount': return fmtCurrency(row.fundingAmount);
      case 'ownershipPct': return fmtPct(row.ownershipPct);
      case 'noteRate': return fmtPct(row.noteRate);
      case 'lenderRate': return fmtPct(row.lenderRate);
      case 'regularPayment': return fmtCurrency(row.regularPayment);
      case 'outstandingBalance': return fmtCurrency(row.outstandingBalance);
      case 'currentBalance': return fmtCurrency(row.currentBalance);
      case 'paymentReceived': return fmtCurrency(row.paymentReceived);
      case 'accruedInterest': return fmtCurrency(row.accruedInterest);
      case 'roiYield': return fmtPct(row.roiYield);
      case 'maturityDate': return fmtDate(row.maturityDate);
      case 'nextPaymentDate': return fmtDate(row.nextPaymentDate);
      case 'daysLate': return row.daysLate > 0 ? String(row.daysLate) : '0';
      case 'fundingDate': return fmtDate(row.fundingDate);
      case 'interestFromDate': return fmtDate(row.interestFromDate);
      case 'spreadPct': return fmtPct(row.spreadPct);
      case 'disbursements': return fmtCurrency(row.disbursements);
      case 'netPayment': return fmtCurrency(row.netPayment);
      case 'totalEarnedToDate': return fmtCurrency(row.totalEarnedToDate);
      default: return String((row as any)[colId] || '-');
    }
  };

  const fmtSumCurrency = (v: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Delinquent':
        return <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{status}</Badge>;
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
    if (row.roiYield > 10) {
      return 'cursor-pointer hover:bg-muted/60 bg-emerald-500/5';
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
                  <Checkbox id={`lp-col-${c.id}`} checked={visibleColumns.has(c.id)} onCheckedChange={() => toggleColumn(c.id)} />
                  <label htmlFor={`lp-col-${c.id}`} className="text-xs cursor-pointer">{c.label}</label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-x-auto">
        <Table className="min-w-[1800px]">
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
                  No loans found for this lender. Portfolio will automatically populate when this lender is added to the Funding section of a loan.
                </TableCell>
              </TableRow>
            ) : filtered.map(r => (
              <TableRow key={r.id} className={getRowClassName(r)} onClick={() => handleRowClick(r)}>
                {activeColumns.map(c => (
                  <TableCell key={c.id} className="whitespace-nowrap text-xs">
                    {c.id === 'loanStatus' ? getStatusBadge(r.loanStatus) : (
                      c.id === 'roiYield' && r.roiYield > 8 ? (
                        <span className="text-emerald-600 font-medium">{formatCellValue(c.id, r)}</span>
                      ) : (
                        c.id === 'daysLate' && r.daysLate > 30 ? (
                          <span className="text-destructive font-medium">{formatCellValue(c.id, r)}</span>
                        ) : formatCellValue(c.id, r)
                      )
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

export default LenderPortfolio;
