import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Download, Settings2, Filter, Users } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import SortableTableHead from '@/components/deal/SortableTableHead';
import { type SortDirection } from '@/hooks/useGridSortFilter';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { listParticipantsByContact, listParticipantsByDealIds } from '@/services/deals/participants.service';
import { listDealsByIds } from '@/services/deals/deals.service';
import { fetchSectionValuesForDeals } from '@/services/deals/section-values.service';
import {
  extractSectionFieldValue,
  extractPortfolioLoanAmount,
  PORTFOLIO_FIELD_IDS,
} from '@/lib/sectionFieldValues';

interface ParticipantInfo {
  name: string;
  capacity: string;
}

interface PortfolioLoan {
  id: string;
  dealId: string;
  loanNumber: string;
  loanAmount: string;
  capacity: string;
  status: string;
  nextPaymentDate: string;
  principalBalance: string;
  interestRate: string;
  maturityDate: string;
  participants: ParticipantInfo[];
  // Spec additions (read-only, '-' when unavailable)
  accountNumber: string;
  loanType: string;
  originationDate: string;
  paymentAmount: string;
  lastPaymentDate: string;
  lastPaymentAmount: string;
  daysPastDue: string;
  totalPaidToDate: string;
  propertyAddress: string;
}

const DEFAULT_VISIBLE_BP = new Set([
  'loanNumber', 'accountNumber', 'status',
  'loanAmount', 'principalBalance',
  'interestRate', 'loanType',
  'originationDate', 'maturityDate',
  'nextPaymentDate', 'paymentAmount',
  'lastPaymentDate', 'lastPaymentAmount',
  'daysPastDue', 'totalPaidToDate',
  'propertyAddress',
]);

const ALL_COLUMNS = [
  { id: 'loanNumber', label: 'Loan ID' },
  { id: 'accountNumber', label: 'Account Number' },
  { id: 'status', label: 'Loan Status' },
  { id: 'loanAmount', label: 'Original Amount' },
  { id: 'principalBalance', label: 'Current Balance' },
  { id: 'interestRate', label: 'Note Rate' },
  { id: 'loanType', label: 'Loan Type' },
  { id: 'originationDate', label: 'Origination Date' },
  { id: 'maturityDate', label: 'Maturity Date' },
  { id: 'nextPaymentDate', label: 'Next Payment Date' },
  { id: 'paymentAmount', label: 'Payment Amount' },
  { id: 'lastPaymentDate', label: 'Last Payment Date' },
  { id: 'lastPaymentAmount', label: 'Last Payment Amount' },
  { id: 'daysPastDue', label: 'Days Past Due' },
  { id: 'totalPaidToDate', label: 'Total Paid to Date' },
  { id: 'propertyAddress', label: 'Property/Collateral Address' },
  // Optional (hidden by default)
  { id: 'capacity', label: 'Capacity' },
];

const ROLE_FILTER_OPTIONS = ['Borrower (Primary)', 'Borrower', 'Co-Borrower', 'Additional Guarantor', 'Trustee', 'Co-Trustee', 'Managing Member', 'Authorized Signer', 'Lender', 'Broker'];
const STATUS_FILTER_OPTIONS = ['Active', 'Closed', 'Default'];

// Map canonical capacity values to display roles
const CAPACITY_TO_ROLE: Record<string, string> = {
  borrower_primary: 'Borrower (Primary)',
  borrower: 'Borrower',
  co_borrower: 'Co-Borrower',
  additional_guarantor: 'Additional Guarantor',
  trustee: 'Trustee',
  co_trustee: 'Co-Trustee',
  managing_member: 'Managing Member',
  authorized_signer: 'Authorized Signer',
  primary_lender: 'Primary Lender',
  participant_lender: 'Participant Lender',
  syndicate_lender: 'Syndicate Lender',
  authorized_party: 'Authorized Party',
};

// Fallback: map deal_participants.role to a display label
const ROLE_FALLBACK: Record<string, string> = {
  borrower: 'Borrower (Primary)',
  lender: 'Lender',
  broker: 'Broker',
  other: 'Other',
};

const normalizeCapacityKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

const resolveCapacityLabel = (value: string): string => {
  const raw = value.trim();
  if (!raw) return '';

  const direct = CAPACITY_TO_ROLE[raw];
  if (direct) return direct;

  const normalized = CAPACITY_TO_ROLE[normalizeCapacityKey(raw)];
  if (normalized) return normalized;

  // If it's already a human-readable capacity label, preserve it.
  return raw;
};

interface Props { borrowerId: string; contactDbId: string; }

const BorrowerPortfolio: React.FC<Props> = ({ contactDbId }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PortfolioLoan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>(null);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(DEFAULT_VISIBLE_BP));
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Fetch portfolio data from deal_participants + deals
  useEffect(() => {
    if (!contactDbId) return;
    const load = async () => {
      setIsLoading(true);
      try {
        // 1. Get all deal_participants for this contact (any role/capacity)
        const participants = await listParticipantsByContact(
          contactDbId,
          'deal_id, role, name, contact_id'
        );
        if (!participants || participants.length === 0) {
          setRows([]);
          setIsLoading(false);
          return;
        }

        // 2. Get unique deal IDs
        const dealIds = [...new Set(participants.map(p => p.deal_id))];

        // 3. Fetch deals
        const deals = await listDealsByIds(
          dealIds,
          'id, deal_number, loan_amount, status, property_address, product_type'
        );

        // Field dictionary UUIDs for the fields we need (supports composite storage keys)
        const FIELD_IDS = PORTFOLIO_FIELD_IDS;

        const sectionValues = await fetchSectionValuesForDeals(dealIds, { section: 'loan_terms' });

        const extractFieldValue = (
          fieldValues: Record<string, any>,
          fieldId: string | string[],
          valueKey: 'value_number' | 'value_text' | 'value_date' | 'auto' = 'auto',
        ): any => {
          const prefer = valueKey === 'auto' ? 'auto' : valueKey;
          return extractSectionFieldValue(fieldValues, fieldId, prefer);
        };

        const extractLoanAmount = (fieldValues: Record<string, any>) =>
          extractPortfolioLoanAmount(fieldValues);

        const sectionMap = new Map<string, Record<string, any>>();
        (sectionValues || []).forEach(sv => {
          sectionMap.set(sv.deal_id, sv.field_values as Record<string, any>);
        });

        // 5. Fetch participant section values for capacity info
        const participantSections = await fetchSectionValuesForDeals(dealIds, {
          section: 'participants',
        });

        const parseCapacityValue = (value: unknown): string => {
          if (typeof value === 'string') return value;
          if (value && typeof value === 'object') {
            const obj = value as Record<string, unknown>;
            if (typeof obj.value_text === 'string') return obj.value_text;
            if (typeof obj.value_json === 'string') return obj.value_json;
          }
          return '';
        };

        // 5b. Fetch ALL participants across all linked deals for the info popover
        const allDealParticipants = await listParticipantsByDealIds(
          dealIds,
          'deal_id, role, name, contact_id'
        );

        // Build per-deal participants map with resolved capacities
        // Also build a capacity map per contact_id per deal from participant section values
        const perDealContactCapacity = new Map<string, Map<string, string>>();
        (participantSections || []).forEach(ps => {
          const fv = ps.field_values as Record<string, any>;
          if (!fv) return;
          const dealCapMap = perDealContactCapacity.get(ps.deal_id) || new Map<string, string>();
          Object.entries(fv).forEach(([key, val]) => {
            // Check for new participant_{contactId}_capacity key pattern
            const participantMatch = key.match(/^participant_(.+)_capacity$/);
            if (participantMatch) {
              const cid = participantMatch[1];
              const parsedCapacity = parseCapacityValue(val);
              if (parsedCapacity) {
                const label = resolveCapacityLabel(parsedCapacity);
                if (label) dealCapMap.set(cid, label);
              }
            } else if (key.includes('capacity')) {
              // Legacy key pattern fallback
              const parsedCapacity = parseCapacityValue(val);
              if (!parsedCapacity) return;
              const contactKey = key.replace('capacity', 'contact_id');
              const cid = fv[contactKey];
              if (cid && typeof cid === 'string') {
                const label = resolveCapacityLabel(parsedCapacity);
                if (label) dealCapMap.set(cid, label);
              }
            }
          });
          perDealContactCapacity.set(ps.deal_id, dealCapMap);
        });

        // Helper: resolve display capacity for a participant
        const resolveCapacity = (dealId: string, contactId: string | null, role: string): string => {
          // Priority 1: deal-specific section values (reliable, per-deal)
          if (contactId) {
            const sectionCap = perDealContactCapacity.get(dealId)?.get(contactId);
            if (sectionCap) return sectionCap;
          }
          // Priority 2: role-based fallback (skip unreliable global contact_data.capacity)
          return ROLE_FALLBACK[role] || role || 'Other';
        };

        // Build allParticipantsMap: dealId -> ParticipantInfo[]
        const allParticipantsMap = new Map<string, ParticipantInfo[]>();
        (allDealParticipants || []).forEach(dp => {
          const list = allParticipantsMap.get(dp.deal_id) || [];
          list.push({
            name: dp.name || 'Unknown',
            capacity: resolveCapacity(dp.deal_id, dp.contact_id, dp.role),
          });
          allParticipantsMap.set(dp.deal_id, list);
        });

        // 6. Also fetch funding section for lender funding data
        const fundingSections = await fetchSectionValuesForDeals(dealIds, {
          sections: ['loan_terms'],
        });

        // Build a map for funding records (stored under 'loan_terms.funding_records' key)
        const fundingMap = new Map<string, any[]>();
        (fundingSections || []).forEach(fs => {
          const fv = fs.field_values as Record<string, any>;
          if (fv) {
            // Check for funding_records stored with various key patterns
            const fundingRecords = fv['loan_terms.funding_records'];
            if (fundingRecords) {
              try {
                const parsed = typeof fundingRecords === 'string' ? JSON.parse(fundingRecords) : fundingRecords;
                if (typeof parsed === 'object' && parsed !== null) {
                  const val = parsed.value_json || parsed.value_text;
                  const records = val ? (typeof val === 'string' ? JSON.parse(val) : val) : parsed;
                  if (Array.isArray(records)) {
                    fundingMap.set(fs.deal_id, records);
                  }
                }
              } catch { /* ignore parse errors */ }
            }
          }
        });

        const dealsMap = new Map((deals || []).map(d => [d.id, d]));

        // 7. Build rows - one per unique deal
        const seenDeals = new Set<string>();
        const portfolioRows: PortfolioLoan[] = [];

        for (const p of participants) {
          if (seenDeals.has(p.deal_id)) continue;
          seenDeals.add(p.deal_id);

          const deal = dealsMap.get(p.deal_id);
          if (!deal) continue;

          const loanTerms = sectionMap.get(p.deal_id) || {};
          const displayRole = resolveCapacity(p.deal_id, contactDbId, p.role);

          const formatCurrency = (val: any) => {
            if (val == null || val === '') return '-';
            const num = typeof val === 'number' ? val : parseFloat(String(val));
            if (isNaN(num)) return '-';
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

          const formatPercent = (val: any) => {
            if (val == null || val === '') return '-';
            const num = typeof val === 'number' ? val : parseFloat(String(val));
            if (isNaN(num)) return '-';
            return `${num}%`;
          };

          // Extract values from field_values using field dictionary IDs
          const loanAmountVal = extractLoanAmount(loanTerms);
          const noteRateVal = extractFieldValue(loanTerms, FIELD_IDS.noteRate, 'value_number');
          const principalBalanceVal = extractFieldValue(loanTerms, FIELD_IDS.principalBalance, 'value_number');
          const maturityDateVal = extractFieldValue(loanTerms, FIELD_IDS.maturityDate, 'value_date') 
                               || extractFieldValue(loanTerms, FIELD_IDS.maturityDate, 'value_text');
          const nextPaymentDateVal = extractFieldValue(loanTerms, FIELD_IDS.nextPaymentDate, 'value_date')
                                   || extractFieldValue(loanTerms, FIELD_IDS.nextPaymentDate, 'value_text')
                                   || extractFieldValue(loanTerms, FIELD_IDS.nextPayment, 'value_date')
                                   || extractFieldValue(loanTerms, FIELD_IDS.nextPayment, 'value_text');

          // Use loan_amount from section values first, then fall back to deals table
          const displayLoanAmount = loanAmountVal ?? deal.loan_amount;
          const displayPrincipalBalance = principalBalanceVal ?? loanAmountVal ?? deal.loan_amount;

          // Fallback fragment lookup for legacy keys
          const findByKey = (...frags: string[]): any => {
            for (const [k, v] of Object.entries(loanTerms)) {
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

          // Spec column lookups: prefer field_dictionary UUID; fallback to legacy keys
          const accountNumberVal =
            extractFieldValue(loanTerms, FIELD_IDS.accountNumber, 'value_text') ??
            findByKey('account_number', 'loan_account', 'previousaccount');
          const loanStatusVal =
            extractFieldValue(loanTerms, FIELD_IDS.loanStatus, 'value_text') ??
            findByKey('loan_status', 'loanstatus');
          const loanTypeVal =
            extractFieldValue(loanTerms, FIELD_IDS.loanType, 'value_text') ??
            findByKey('loan_type', 'loantype') ?? deal.product_type;
          const originationDateVal =
            extractFieldValue(loanTerms, FIELD_IDS.originationDate, 'value_date') ??
            extractFieldValue(loanTerms, FIELD_IDS.originationDate, 'value_text') ??
            extractFieldValue(loanTerms, FIELD_IDS.closingDate, 'value_date') ??
            extractFieldValue(loanTerms, FIELD_IDS.closingDate, 'value_text') ??
            findByKey('origination_date', 'funding_date', 'closing_date', 'originat');
          const paymentAmountVal =
            extractFieldValue(loanTerms, FIELD_IDS.paymentAmount, 'value_number') ??
            findByKey('regular_payment', 'monthly_payment', 'payment_amount', 'paymentamount');
          const lastPaymentDateVal =
            extractFieldValue(loanTerms, FIELD_IDS.lastPaymentDate, 'value_date') ??
            extractFieldValue(loanTerms, FIELD_IDS.lastPaymentDate, 'value_text') ??
            findByKey('last_payment_date', 'lastpaymen');
          const lastPaymentAmountVal =
            extractFieldValue(loanTerms, FIELD_IDS.lastPaymentAmount, 'value_number') ??
            findByKey('last_payment_amount', 'lastpaymenamount');
          const totalPaidVal = findByKey('total_paid', 'paid_to_date', 'totalpaid');

          // Display status: prefer ln_p_loanStatus, fall back to legacy
          let displayStatus = 'Active';
          const rawStatus = (typeof loanStatusVal === 'string' ? loanStatusVal : '') ||
            (typeof loanTerms['loan_status'] === 'string' ? loanTerms['loan_status'] : '') ||
            (typeof loanTerms['status'] === 'string' ? loanTerms['status'] : '');
          if (rawStatus) {
            const r = rawStatus.toLowerCase();
            if (r.includes('closed') || r.includes('paid')) displayStatus = 'Closed';
            else if (r.includes('default')) displayStatus = 'Default';
            else if (rawStatus.trim()) displayStatus = rawStatus;
          }

          let daysPastDueStr = '-';
          if (nextPaymentDateVal) {
            try {
              const d = new Date(String(nextPaymentDateVal));
              if (!isNaN(d.getTime())) {
                const diff = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
                daysPastDueStr = diff > 0 ? String(diff) : '0';
              }
            } catch { /* ignore */ }
          }


          portfolioRows.push({
            id: `${p.deal_id}`,
            dealId: p.deal_id,
            loanNumber: deal.deal_number || '-',
            loanAmount: formatCurrency(displayLoanAmount),
            capacity: displayRole,
            status: displayStatus,
            nextPaymentDate: formatDate(nextPaymentDateVal),
            principalBalance: formatCurrency(displayPrincipalBalance),
            interestRate: formatPercent(noteRateVal),
            maturityDate: formatDate(maturityDateVal),
            participants: allParticipantsMap.get(p.deal_id) || [],
            accountNumber: accountNumberVal ? String(accountNumberVal) : '-',
            loanType: loanTypeVal ? String(loanTypeVal) : '-',
            originationDate: formatDate(originationDateVal),
            paymentAmount: formatCurrency(paymentAmountVal),
            lastPaymentDate: formatDate(lastPaymentDateVal),
            lastPaymentAmount: formatCurrency(lastPaymentAmountVal),
            daysPastDue: daysPastDueStr,
            totalPaidToDate: formatCurrency(totalPaidVal),
            propertyAddress: deal.property_address || '-',
          });
        }

        setRows(portfolioRows);
      } catch (err) {
        console.error('Failed to load portfolio:', err);
        setRows([]);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [contactDbId]);

  // Summary calculations
  const summary = useMemo(() => {
    const parseCurrency = (val: string) => {
      const num = parseFloat(val.replace(/[^0-9.-]/g, ''));
      return isNaN(num) ? 0 : num;
    };
    const totalLoans = rows.length;
    const activeLoans = rows.filter(r => r.status === 'Active').length;
    const totalAmount = rows.reduce((sum, r) => sum + parseCurrency(r.loanAmount), 0);
    const totalBalance = rows.reduce((sum, r) => sum + parseCurrency(r.principalBalance), 0);
    return { totalLoans, activeLoans, totalAmount, totalBalance };
  }, [rows]);

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

  const filtered = useMemo(() => {
    let result = rows;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r => r.loanNumber.toLowerCase().includes(q));
    }
    if (roleFilter !== 'all') {
      result = result.filter(r => r.capacity === roleFilter);
    }
    if (statusFilter !== 'all') {
      result = result.filter(r => r.status === statusFilter);
    }
    if (sortCol && sortDir) {
      result = [...result].sort((a, b) => {
        const av = (a as any)[sortCol] || '';
        const bv = (b as any)[sortCol] || '';
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    return result;
  }, [rows, search, sortCol, sortDir, roleFilter, statusFilter]);

  const toggleColumn = (colId: string) => setVisibleColumns(prev => {
    const n = new Set(prev);
    n.has(colId) ? n.delete(colId) : n.add(colId);
    return n;
  });

  const handleExport = () => {
    const headers = activeColumns.map(c => c.label).join(',');
    const csvRows = filtered.map(r => activeColumns.map(c => `"${String((r as any)[c.id] || '').replace(/"/g, '""')}"`).join(','));
    const csv = [headers, ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'borrower_portfolio.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRowClick = (row: PortfolioLoan) => {
    navigate(`/deals/${row.dealId}/data`);
  };

  const formatSummaryCurrency = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);

  return (
    <div className="space-y-4">
      <h4 className="text-lg font-semibold text-foreground">Portfolio</h4>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="border border-border rounded-lg p-3 bg-muted/30">
          <p className="text-xs text-muted-foreground">Total Loans</p>
          <p className="text-xl font-semibold text-foreground">{summary.totalLoans}</p>
        </div>
        <div className="border border-border rounded-lg p-3 bg-muted/30">
          <p className="text-xs text-muted-foreground">Active Loans</p>
          <p className="text-xl font-semibold text-foreground">{summary.activeLoans}</p>
        </div>
        <div className="border border-border rounded-lg p-3 bg-muted/30">
          <p className="text-xs text-muted-foreground">Total Loan Amount (Exposure)</p>
          <p className="text-xl font-semibold text-foreground">{formatSummaryCurrency(summary.totalAmount)}</p>
        </div>
        <div className="border border-border rounded-lg p-3 bg-muted/30">
          <p className="text-xs text-muted-foreground">Total Outstanding Balance</p>
          <p className="text-xl font-semibold text-foreground">{formatSummaryCurrency(summary.totalBalance)}</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by Loan Number..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-7 h-8 w-[200px] text-xs"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Capacities</SelectItem>
            {ROLE_FILTER_OPTIONS.map(r => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUS_FILTER_OPTIONS.map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
                    id={`bp-col-${c.id}`}
                    checked={visibleColumns.has(c.id)}
                    onCheckedChange={() => toggleColumn(c.id)}
                  />
                  <label htmlFor={`bp-col-${c.id}`} className="text-xs cursor-pointer">{c.label}</label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" onClick={handleExport}>
          <Download className="h-3.5 w-3.5" /> Export
        </Button>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-x-auto">
        <Table>
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
              <TableHead className="whitespace-nowrap text-xs w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={activeColumns.length + 1} className="text-center py-8 text-muted-foreground text-sm">
                  Loading portfolio...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={activeColumns.length + 1} className="text-center py-8 text-muted-foreground text-sm">
                  No loans found for this borrower
                </TableCell>
              </TableRow>
            ) : (
              filtered.map(r => {
                const grouped = new Map<string, string[]>();
                r.participants.forEach(pt => {
                  const list = grouped.get(pt.capacity) || [];
                  list.push(pt.name);
                  grouped.set(pt.capacity, list);
                });
                return (
                  <TableRow key={r.id} onClick={() => handleRowClick(r)} className="cursor-pointer hover:bg-muted/50">
                    {activeColumns.map(c => (
                      <TableCell key={c.id} className="whitespace-nowrap text-xs">
                        {c.id === 'status' ? (
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            r.status === 'Active' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                            r.status === 'Closed' ? 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400' :
                            'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                          }`}>
                            {r.status}
                          </span>
                        ) : (
                          (r as any)[c.id] || '-'
                        )}
                      </TableCell>
                    ))}
                    <TableCell className="text-center w-10" onClick={e => e.stopPropagation()}>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                            <Users className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-3" align="end">
                          <p className="text-xs font-semibold text-foreground mb-2">Loan Participants</p>
                          {grouped.size === 0 ? (
                            <p className="text-xs text-muted-foreground">No participants.</p>
                          ) : (
                            <div className="space-y-2">
                              {[...grouped.entries()].map(([cap, names]) => (
                                <div key={cap}>
                                  <p className="text-xs font-medium text-muted-foreground">{cap}</p>
                                  {names.map((n, i) => (
                                    <p key={i} className="text-xs text-foreground pl-2">{n}</p>
                                  ))}
                                </div>
                              ))}
                            </div>
                          )}
                        </PopoverContent>
                      </Popover>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default BorrowerPortfolio;
