import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Plus, Trash2, Pencil, Loader2, Download, Search, X, Filter, SlidersHorizontal, History, Check, AlertTriangle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { AddFundingModal, FundingFormData } from './AddFundingModal';
import { FundingAdjustmentModal, FundingAdjustmentData } from './FundingAdjustmentModal';
import { DeleteConfirmationDialog } from './DeleteConfirmationDialog';
import { FundingHistoryDialog } from './FundingHistoryDialog';
import { ColumnConfigPopover, ColumnConfig } from './ColumnConfigPopover';
import { useTableColumnConfig } from '@/hooks/useTableColumnConfig';
import { FilterOption } from './GridToolbar';
import { GridExportDialog, ExportColumn } from './GridExportDialog';
import { CreateContactModal } from '@/components/contacts/CreateContactModal';
import { formatPercentDisplay, Decimal, computeAmortizedPayment } from '@/lib/precisionFormat';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { SortableTableHead } from './SortableTableHead';
import { useGridSortFilter } from '@/hooks/useGridSortFilter';
import { useGridSelection } from '@/hooks/useGridSelection';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { formatCurrencyDisplay } from '@/lib/numericInputFilter';

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'lenderAccount', label: 'Lender ID', visible: true },
  { id: 'lenderName', label: 'Name', visible: true },
  { id: 'lenderEmail', label: 'Email', visible: true },
  { id: 'lenderPhone', label: 'Phone', visible: true },
  { id: 'originalAmount', label: 'Funding Amount', visible: true },
  { id: 'currentBalance', label: 'Current Balance', visible: true },
  
  { id: 'pctOwned', label: 'Pro Rata', visible: true },
  { id: 'fundingDate', label: 'Funding Date', visible: true },
  { id: 'interestFrom', label: 'Interest From', visible: true },
  { id: 'noteRate', label: 'Note Rate', visible: true },
  { id: 'lenderRate', label: 'Lender Rate', visible: true },
  { id: 'regularPayment', label: 'Payment', visible: true },
  { id: 'disbursements', label: 'Disbursements', visible: true },
  { id: 'netPayment', label: 'Net Payment', visible: true },
  { id: 'roundingError', label: 'Rounding', visible: true },
];

export interface FundingRecord {
  id: string;
  fundingDate: string;
  lenderAccount: string;
  lenderName: string;
  lenderEmail?: string;
  lenderPhone?: string;
  pctOwned: number;
  lenderRate: number;
  principalBalance: number;
  originalAmount: number;
  baseFee?: number;
  currentBalance?: number;
  regularPayment: number;
  lenderShare: number;
  roundingError: boolean;
  rateSelection?: 'note_rate' | 'sold_rate' | 'lender_rate';
  rateNoteValue?: string;
  rateSoldValue?: string;
  rateLenderValue?: string;
  lenderRateOverride?: boolean;
  lenderRateOverrideValue?: string;
  brokerParticipates?: boolean;
  interestFrom?: string;
  roundingAdjustment?: boolean;
  disbursements?: Array<{accountId: string; name: string; amount: string; percentage: string; comments: string; startDate?: string; endDate?: string; debitPercent?: string; debitOf?: string; plusAmount?: string; minimumAmount?: string; maximumAmount?: string; debitThrough?: string; debitThroughDate?: string; debitThroughAmount?: string; debitThroughPayments?: string; from?: string}>;
  payments?: Array<{active: boolean; accountId: string; name: string; amount: string; percentage: string; comment: string; from: string}>;
  // Fees to Company
  overrideServicing?: boolean;
  companyBaseFee?: string;
  companyBaseFeePct?: string;
  companyAdditionalServices?: string;
  companyMinimum?: string;
  companyMaximum?: string;
  companyNrSitSplitPct?: string;
  companyNrSitSplit?: string;
  companyTotal?: string;
  // Fees to Vendor
  vendorId?: string;
  vendorName?: string;
  vendorBaseFee?: string;
  vendorBaseFeePct?: string;
  vendorAdditionalServices?: string;
  vendorMinimum?: string;
  vendorMaximum?: string;
  vendorNrSitSplitPct?: string;
  vendorNrSitSplit?: string;
  vendorTotal?: string;
  // Note rate display
  noteRateDisplay?: string;
  // Legacy servicing fees
  overrideServicingFees?: boolean;
  companyServicingFee?: string;
  companyServicingFeePct?: string;
  companyMaxFee?: string;
  companyMaxFeePct?: string;
  companyMinFee?: string;
  companyMinFeePct?: string;
  brokerServicingFee?: string;
  brokerServicingFeePct?: string;
  brokerMaxFee?: string;
  brokerMaxFeePct?: string;
  brokerMinFee?: string;
  brokerMinFeePct?: string;
  // Default fees
  overrideDefaultFees?: boolean;
  lateFee1Lender?: string;
  lateFee1Company?: string;
  lateFee1Broker?: string;
  lateFee1Total?: string;
  lateFee1Maximum?: string;
  lateFee2Lender?: string;
  lateFee2Company?: string;
  lateFee2Broker?: string;
  lateFee2Total?: string;
  lateFee2Maximum?: string;
  defaultInterestLender?: string;
  defaultInterestCompany?: string;
  defaultInterestBroker?: string;
  defaultInterestTotal?: string;
  defaultInterestMaximum?: string;
  interestGuaranteeLender?: string;
  interestGuaranteeCompany?: string;
  interestGuaranteeBroker?: string;
  interestGuaranteeTotal?: string;
  interestGuaranteeMaximum?: string;
  prepaymentLender?: string;
  prepaymentCompany?: string;
  prepaymentBroker?: string;
  prepaymentTotal?: string;
  prepaymentMaximum?: string;
  maturityLender?: string;
  maturityCompany?: string;
  maturityBroker?: string;
  maturityTotal?: string;
  maturityMaximum?: string;
}

interface LoanFundingGridProps {
  dealId: string;
  loanNumber?: string;
  borrowerName?: string;
  fundingRecords: FundingRecord[];
  totalRecordCount?: number;
  historyRecords?: any[];
  onAddFunding: (data: any) => void;
  onDeleteRecord?: (record: FundingRecord) => void;
  onBulkDelete?: (records: FundingRecord[]) => void;
  onUpdateRecord: (id: string, data: Partial<FundingRecord>) => void;
  onRefresh?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  noteRate?: string;
  soldRate?: string;
  totalPayment?: string;
  loanAmount?: string;
  loanPrincipalBalance?: string;
  remainingPayments?: number;
  onLoanNumberChange?: (value: string) => void;
  onBorrowerNameChange?: (value: string) => void;
  onHeaderFieldBlur?: () => void;
  proRata?: string;
  onProRataChange?: (value: string) => void;
  // Funding Adjustment
  fundingAdjustments?: FundingAdjustmentData[];
  onSaveAdjustment?: (adjustment: FundingAdjustmentData) => void;
  onDeleteHistoryRecord?: (record: { id: string }) => void;
}

const SEARCH_FIELDS = ['lenderAccount', 'lenderName', 'lenderEmail', 'lenderPhone'];

const buildFundingFilterOptions = (records: FundingRecord[]): FilterOption[] => {
  const uniqueAccounts = [...new Set(records.map(r => r.lenderAccount).filter(Boolean))];
  const uniqueNames = [...new Set(records.map(r => r.lenderName).filter(Boolean))];
  const uniqueRates = [...new Set(records.map(r => r.lenderRate))].sort((a, b) => a - b);

  return [
    {
      id: 'lenderAccount',
      label: 'Lender Account',
      options: uniqueAccounts.map(a => ({ value: a, label: a })),
    },
    {
      id: 'lenderName',
      label: 'Lender Name',
      options: uniqueNames.map(n => ({ value: n, label: n })),
    },
    {
      id: 'lenderRate',
      label: 'Lender Rate',
      options: uniqueRates.map(r => ({ value: String(r), label: `${formatPercentDisplay(r, 3)}%` })),
    },
  ];
};

const formatDate = (val: string | undefined): string => {
  if (!val) return '';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
  } catch { return val; }
};

export const LoanFundingGrid: React.FC<LoanFundingGridProps> = ({
  dealId,
  loanNumber,
  borrowerName,
  fundingRecords,
  totalRecordCount,
  historyRecords = [],
  onAddFunding,
  onDeleteRecord,
  onBulkDelete,
  onUpdateRecord,
  onRefresh,
  isLoading = false,
  currentPage,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  disabled = false,
  noteRate = '',
  soldRate = '',
  totalPayment = '',
  loanAmount = '',
  loanPrincipalBalance = '',
  remainingPayments = 0,
  onLoanNumberChange,
  onBorrowerNameChange,
  onHeaderFieldBlur,
  proRata = '',
  onProRataChange,
  fundingAdjustments = [],
  onSaveAdjustment,
  onDeleteHistoryRecord,
}) => {
  const { user } = useAuth();
  const [createLenderModalOpen, setCreateLenderModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAdjustmentOpen, setIsAdjustmentOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<FundingRecord | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [deleteRowRecord, setDeleteRowRecord] = useState<FundingRecord | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [editFundingData, setEditFundingData] = useState<FundingFormData | null>(null);
  const [columns, setColumns, resetColumns] = useTableColumnConfig('funding', DEFAULT_COLUMNS);
  const visibleColumns = columns.filter((col) => col.visible);

  const {
    searchQuery, setSearchQuery, sortState, toggleSort,
    activeFilters, setFilter, clearFilters, activeFilterCount, filteredData,
  } = useGridSortFilter(fundingRecords, SEARCH_FIELDS);

  // Auto-clear search/filter constraints when grid record count grows
  // (e.g., after adding a new Funding record), so newly added rows are
  // never hidden behind a stale search/filter.
  const effectiveTotalCount = totalRecordCount ?? fundingRecords.length;
  const prevTotalRef = useRef(effectiveTotalCount);
  useEffect(() => {
    if (effectiveTotalCount > prevTotalRef.current) {
      if (searchQuery || activeFilterCount > 0) {
        clearFilters();
      }
    }
    prevTotalRef.current = effectiveTotalCount;
  }, [effectiveTotalCount, searchQuery, activeFilterCount, clearFilters]);

  const {
    selectedIds, selectedItems, toggleOne, toggleAll, clearSelection,
    isAllSelected, isSomeSelected, selectedCount,
  } = useGridSelection(filteredData);

  const parsePaymentAmount = (value?: string) => parseFloat((value || '').replace(/[$,]/g, '')) || 0;

  // Effective loan principal balance (LOAN-LEVEL): single source of truth.
  // Bound directly to loan_terms.principal (Loan → Balances → Principal).
  // No fallback to loanAmount — Loan Amount is no longer a UI field.
  const effectiveLoanPrincipal = React.useMemo(() => {
    const parsed = parseFloat(String(loanPrincipalBalance || '').replace(/[$,]/g, ''));
    if (!isNaN(parsed) && parsed > 0) return parsed;
    return 0;
  }, [loanPrincipalBalance]);

  // Strict tolerance: only floating-point rounding noise ($0.01) is allowed.
  const FUNDING_TOLERANCE = 0.01;

  // Borrower Regular P&I Payment (from Terms & Balances → Payments).
  // Source of truth for per-lender Payment calculation:
  //   Lender Payment = Lender Pro Rata × Regular P&I
  const regularPIDec = React.useMemo(() => {
    return new Decimal(parseFloat(String(totalPayment || '').replace(/[$,]/g, '')) || 0);
  }, [totalPayment]);

  // Helper: per-record current balance (preferred) or fallback to original
  // minus disbursements. Used as the canonical numerator for Pro Rata.
  const computeCurrentBalance = (record: FundingRecord): number => {
    if (record.currentBalance !== undefined && record.currentBalance !== null && !isNaN(record.currentBalance)) {
      return record.currentBalance;
    }
    const disbSum = (record.disbursements || []).reduce(
      (s, d) => s + (parseFloat(String(d.amount || '').replace(/[$,]/g, '')) || 0), 0
    );
    return Math.max(0, (record.originalAmount || 0) - disbSum);
  };

  // Pro Rata: lender CURRENT BALANCE / loan PRINCIPAL × 100. Stored at 6dp,
  // displayed at 4dp. Indexed by record position (not id) to guarantee each
  // lender row keeps its own value even if record ids ever collide or are
  // missing on legacy data.
  const computedPctOwnedArr = React.useMemo(() => {
    if (!fundingRecords.length) return [] as number[];
    if (effectiveLoanPrincipal <= 0) return fundingRecords.map(() => 0);
    const den = new Decimal(effectiveLoanPrincipal);
    const exact = fundingRecords.map(r =>
      new Decimal(computeCurrentBalance(r)).div(den).times(100)
    );
    const rounded = exact.map(d => d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP));
    // Pro Rata can never exceed 100% in total. Absorb sub-percent rounding
    // drift so the displayed total equals exactly the sum of current balances'
    // share of principal — capped at 100. Adjustment is done at display
    // precision (4dp) so the visible row values sum exactly to the visible total.
    const sumExactCapped = exact.reduce((a, b) => a.plus(b), new Decimal(0));
    const cappedTarget = Decimal.min(sumExactCapped, new Decimal(100))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    const sumRounded = rounded.reduce((a, b) => a.plus(b), new Decimal(0));
    const diff = cappedTarget.minus(sumRounded);
    if (!diff.isZero()) {
      let adjIdx = fundingRecords.findIndex(r => r.roundingAdjustment);
      if (adjIdx < 0) {
        let max = new Decimal(-1);
        rounded.forEach((d, i) => { if (d.gt(max)) { max = d; adjIdx = i; } });
      }
      if (adjIdx >= 0) {
        const adjusted = rounded[adjIdx].plus(diff);
        rounded[adjIdx] = adjusted.lt(0) ? new Decimal(0) : adjusted;
      }
    }
    return rounded.map(d => d.toNumber());
  }, [fundingRecords, effectiveLoanPrincipal]);

  const recordIndexMap = React.useMemo(() => {
    const m = new Map<FundingRecord, number>();
    fundingRecords.forEach((r, i) => m.set(r, i));
    return m;
  }, [fundingRecords]);

  const getDisplayedPctOwned = (record: FundingRecord) => {
    const i = recordIndexMap.get(record);
    if (i === undefined) return Number(record.pctOwned) || 0;
    const v = computedPctOwnedArr[i];
    return v !== undefined ? v : (Number(record.pctOwned) || 0);
  };

  // Per-lender Payment (GROSS): Pro Rata × Regular P&I. Calculated independently
  // for every lender via .map (no shared scope, no early break). Banker's
  // rounding to 2dp; sub-cent drift absorbed by the row flagged roundingAdjustment.
  const computedPaymentsArr = React.useMemo(() => {
    if (!fundingRecords.length) return [] as number[];
    const exact = fundingRecords.map((_, i) => {
      const pct = computedPctOwnedArr[i] ?? 0;
      return new Decimal(pct).div(100).mul(regularPIDec);
    });
    const rounded = exact.map(d => d.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN));
    const sumExact = exact.reduce((a, b) => a.plus(b), new Decimal(0))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
    const sumRounded = rounded.reduce((a, b) => a.plus(b), new Decimal(0));
    const diff = sumExact.minus(sumRounded);
    const adjIdx = fundingRecords.findIndex(r => r.roundingAdjustment);
    if (adjIdx >= 0 && !diff.isZero()) {
      rounded[adjIdx] = rounded[adjIdx].plus(diff);
    }
    return rounded.map(d => d.toNumber());
  }, [fundingRecords, computedPctOwnedArr, regularPIDec]);

  const getDisplayedPayment = (record: FundingRecord) => {
    const i = recordIndexMap.get(record);
    if (i === undefined) return 0;
    return computedPaymentsArr[i] ?? 0;
  };
  const getDisbursementsTotal = (record: FundingRecord) => {
    return (record.disbursements || []).reduce(
      (sum, d) => sum + parsePaymentAmount(d.amount), 0
    );
  };

  // Lender-rate columns (still derived from Note Rate when override absent).
  const noteRateNumValue = parseFloat((noteRate || '').replace(/[%,]/g, '')) || 0;
  const hasLenderRate = (record: FundingRecord) =>
    record.lenderRate !== undefined && record.lenderRate !== null && !isNaN(record.lenderRate) && record.lenderRate > 0;
  const getEffectiveLenderRate = (record: FundingRecord) =>
    hasLenderRate(record) ? record.lenderRate : noteRateNumValue;

  // Net Payment = Lender Payment − Σ Disbursements (per-lender, never shared).
  // When disbursements = 0, Net Payment === Lender Payment exactly.
  const getNetPayment = (record: FundingRecord) => {
    const payment = new Decimal(getDisplayedPayment(record));
    const disb = new Decimal(getDisbursementsTotal(record));
    return payment.minus(disb).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toNumber();
  };

  const totalOwnership = fundingRecords.reduce((sum, r) => sum + r.pctOwned, 0);
  const totalPrincipalBalance = fundingRecords.reduce((sum, r) => sum + r.principalBalance, 0);
  const totalCurrentBalance = fundingRecords.reduce((sum, r) => sum + computeCurrentBalance(r), 0);
  const totalPaymentSum = fundingRecords.reduce((sum, r) => sum + getDisplayedPayment(r), 0);
  const totalDisbursementsSum = fundingRecords.reduce((sum, r) => sum + getDisbursementsTotal(r), 0);
  const totalNetPaymentSum = fundingRecords.reduce((sum, r) => sum + getNetPayment(r), 0);
  const totalFundingAmount = fundingRecords.reduce((sum, r) => sum + r.originalAmount, 0);

  // Funding status compares the larger of Funding Amount total and Current
  // Balance total vs loan principal. Neither total may exceed Balance.
  // Over-funding is blocked at edit time (see AddFundingModal) — this branch
  // remains as a defensive surface to flag any legacy bad data.
  const fundedAmount = Math.max(totalCurrentBalance, totalFundingAmount);
  const unfundedAmount = Math.max(0, effectiveLoanPrincipal - fundedAmount);
  const overAmount = Math.max(0, fundedAmount - effectiveLoanPrincipal);
  const fundedPct = effectiveLoanPrincipal > 0
    ? (fundedAmount / effectiveLoanPrincipal) * 100
    : 0;
  const unfundedPct = effectiveLoanPrincipal > 0
    ? Math.max(0, 100 - fundedPct)

    : 0;
  const fundingStatus: 'under' | 'full' | 'over' | 'none' =
    effectiveLoanPrincipal <= 0 || fundingRecords.length === 0
      ? 'none'
      : overAmount > FUNDING_TOLERANCE
        ? 'over'
        : unfundedAmount > FUNDING_TOLERANCE
          ? 'under'
          : 'full';

  const formatCurrency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  const formatPercentage = (value: number, max = 2) => `${formatPercentDisplay(value, max)}%`;

  const handleRoundingChange = (recordId: string, checked: boolean) => {
    onUpdateRecord(recordId, { roundingError: checked });
  };

  const handleRowClick = (record: FundingRecord) => {
    setEditFundingData({
      loan: loanNumber || '',
      borrower: borrowerName || '',
      lenderId: record.lenderAccount,
      lenderFullName: record.lenderName,
      lenderEmail: record.lenderEmail || '',
      lenderPhone: record.lenderPhone || '',
      lenderRate: String(record.lenderRate),
      fundingAmount: formatCurrencyDisplay(String(record.originalAmount)),
      baseFee: record.baseFee !== undefined && record.baseFee !== null ? formatCurrencyDisplay(String(record.baseFee)) : '',
      fundingDate: record.fundingDate || '',
      interestFrom: record.interestFrom || '',
      notes: '',
      brokerParticipates: record.brokerParticipates || false,
      percentOwned: String(record.pctOwned),
      regularPayment: String(record.regularPayment),
      lenderShare: String(record.lenderShare || ''),
      rateSelection: record.rateSelection || 'note_rate',
      rateNoteValue: noteRate || record.rateNoteValue || '',
      rateSoldValue: soldRate || record.rateSoldValue || '',
      rateLenderValue: record.rateLenderValue || '',
      lenderRateOverride: record.lenderRateOverride || false,
      lenderRateOverrideValue: record.lenderRateOverrideValue || '',
      roundingAdjustment: record.roundingAdjustment || false,
      disbursements: record.disbursements?.length ? record.disbursements.map(d => ({
        active: (d as any).active ?? true,
        accountId: d.accountId || '', name: d.name || '', startDate: (d as any).startDate || '', endDate: (d as any).endDate || '',
        amount: d.amount || '', percentage: d.percentage || '', from: (d as any).from || '' as const, comments: d.comments || '',
        debitPercent: (d as any).debitPercent || '', debitOf: (d as any).debitOf || '' as const,
        plusAmount: (d as any).plusAmount || '', minimumAmount: (d as any).minimumAmount || '',
        maximumAmount: (d as any).maximumAmount || '',
        debitThrough: (d as any).debitThrough || '' as const, debitThroughDate: (d as any).debitThroughDate || '',
        debitThroughAmount: (d as any).debitThroughAmount || '', debitThroughPayments: (d as any).debitThroughPayments || '',
      })) : [],
      principalBalance: formatCurrencyDisplay(String(record.principalBalance)),
      currentBalance: record.currentBalance !== undefined && record.currentBalance !== null
        ? formatCurrencyDisplay(String(record.currentBalance))
        : '',
      noteRateDisplay: noteRate || record.noteRateDisplay || '',
      overrideServicing: record.overrideServicing ?? record.overrideServicingFees ?? false,
      companyBaseFee: record.companyBaseFee || record.companyServicingFee || '',
      companyBaseFeePct: record.companyBaseFeePct || record.companyServicingFeePct || '',
      companyAdditionalServices: record.companyAdditionalServices || '',
      companyMinimum: record.companyMinimum || record.companyMinFee || '',
      companyMaximum: record.companyMaximum || record.companyMaxFee || '',
      companyNrSitSplitPct: record.companyNrSitSplitPct || '',
      companyNrSitSplit: record.companyNrSitSplit || '',
      companyTotal: record.companyTotal || '',
      vendorId: record.vendorId || '',
      vendorName: record.vendorName || '',
      vendorBaseFee: record.vendorBaseFee || record.brokerServicingFee || '',
      vendorBaseFeePct: record.vendorBaseFeePct || record.brokerServicingFeePct || '',
      vendorAdditionalServices: record.vendorAdditionalServices || '',
      vendorMinimum: record.vendorMinimum || record.brokerMinFee || '',
      vendorMaximum: record.vendorMaximum || record.brokerMaxFee || '',
      vendorNrSitSplitPct: record.vendorNrSitSplitPct || '',
      vendorNrSitSplit: record.vendorNrSitSplit || '',
      vendorTotal: record.vendorTotal || '',
      payments: (record as any).payments?.length ? (record as any).payments : undefined,
      overrideServicingFees: record.overrideServicingFees || false,
      companyServicingFee: record.companyServicingFee || '', companyServicingFeePct: record.companyServicingFeePct || '',
      companyMaxFee: record.companyMaxFee || '', companyMaxFeePct: record.companyMaxFeePct || '',
      companyMinFee: record.companyMinFee || '', companyMinFeePct: record.companyMinFeePct || '',
      brokerServicingFee: record.brokerServicingFee || '', brokerServicingFeePct: record.brokerServicingFeePct || '',
      brokerMaxFee: record.brokerMaxFee || '', brokerMaxFeePct: record.brokerMaxFeePct || '',
      brokerMinFee: record.brokerMinFee || '', brokerMinFeePct: record.brokerMinFeePct || '',
      overrideDefaultFees: record.overrideDefaultFees || false,
      lateFee1Lender: record.lateFee1Lender || '', lateFee1Company: record.lateFee1Company || '', lateFee1Broker: record.lateFee1Broker || '', lateFee1Total: record.lateFee1Total || '', lateFee1Maximum: record.lateFee1Maximum || '',
      lateFee2Lender: record.lateFee2Lender || '', lateFee2Company: record.lateFee2Company || '', lateFee2Broker: record.lateFee2Broker || '', lateFee2Total: record.lateFee2Total || '', lateFee2Maximum: record.lateFee2Maximum || '',
      defaultInterestLender: record.defaultInterestLender || '', defaultInterestCompany: record.defaultInterestCompany || '', defaultInterestBroker: record.defaultInterestBroker || '', defaultInterestTotal: record.defaultInterestTotal || '', defaultInterestMaximum: record.defaultInterestMaximum || '',
      interestGuaranteeLender: record.interestGuaranteeLender || '', interestGuaranteeCompany: record.interestGuaranteeCompany || '', interestGuaranteeBroker: record.interestGuaranteeBroker || '', interestGuaranteeTotal: record.interestGuaranteeTotal || '', interestGuaranteeMaximum: record.interestGuaranteeMaximum || '',
      prepaymentLender: record.prepaymentLender || '', prepaymentCompany: record.prepaymentCompany || '', prepaymentBroker: record.prepaymentBroker || '', prepaymentTotal: record.prepaymentTotal || '', prepaymentMaximum: record.prepaymentMaximum || '',
      maturityLender: record.maturityLender || '', maturityCompany: record.maturityCompany || '', maturityBroker: record.maturityBroker || '', maturityTotal: record.maturityTotal || '', maturityMaximum: record.maturityMaximum || '',
    });
    setSelectedRecord(record);
    setIsAddModalOpen(true);
  };

  const handleAddFundingClick = () => {
    setSelectedRecord(null);
    setEditFundingData(null);
    setIsAddModalOpen(true);
  };

  const handleDeleteRowClick = (e: React.MouseEvent, record: FundingRecord) => {
    e.stopPropagation();
    setDeleteRowRecord(record);
  };

  const handleConfirmDeleteRow = () => {
    if (deleteRowRecord && onDeleteRecord) {
      onDeleteRecord(deleteRowRecord);
    }
    setDeleteRowRecord(null);
  };

  const handleEditClick = (e: React.MouseEvent, record: FundingRecord) => {
    e.stopPropagation();
    handleRowClick(record);
  };

  const renderCellValue = (record: FundingRecord, columnId: string) => {
    switch (columnId) {
      case 'lenderAccount':
        return <span className="font-medium">{record.lenderAccount || '-'}</span>;
      case 'lenderName':
        return record.lenderName || '-';
      case 'lenderEmail':
        return record.lenderEmail || '-';
      case 'lenderPhone':
        return record.lenderPhone || '-';
      case 'originalAmount':
        return <span>{formatCurrency(record.originalAmount)}</span>;
      case 'principalBalance':
        return <span>{formatCurrency(record.principalBalance)}</span>;
      case 'currentBalance':
        return <span>{formatCurrency(computeCurrentBalance(record))}</span>;
      case 'pctOwned':
        return <span>{formatPercentage(getDisplayedPctOwned(record), 4)}</span>;
      case 'fundingDate':
        return formatDate(record.fundingDate) || '-';
      case 'interestFrom':
        if (!record.interestFrom) {
          return (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 text-amber-600">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-xs">Not set</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs max-w-[260px]">
                  Interest From date is missing. Pro Rata and Payment are unaffected,
                  but interest accrual for this lender cannot be calculated until a date is set.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        }
        return formatDate(record.interestFrom);
      case 'noteRate':
        // Always sync display with Loan > Terms & Balances > Note Rate (source of truth)
        return <span>{noteRate ? `${formatPercentDisplay(noteRate, 3)}%` : (record.rateNoteValue ? `${formatPercentDisplay(record.rateNoteValue, 3)}%` : '-')}</span>;
      case 'lenderRate':
        if (!hasLenderRate(record)) {
          return (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    <span>-</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Lender Rate not set — defaulting to Note Rate
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        }
        return <span>{formatPercentage(record.lenderRate, 3)}</span>;
      case 'regularPayment':
        return <span>{formatCurrency(getDisplayedPayment(record))}</span>;
      case 'disbursements':
        return <span>{formatCurrency(getDisbursementsTotal(record))}</span>;
      case 'netPayment':
        return <span>{formatCurrency(getNetPayment(record))}</span>;
      case 'roundingError':
        return (
          <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center justify-center h-5 w-5">
                    {record.roundingAdjustment ? (
                      <Check className="h-4 w-4 text-primary" aria-label="Receives rounding adjustment" />
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  This lender will receive any rounding difference (e.g., $0.01)
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        );
      default:
        return '-';
    }
  };

  const handleBulkDelete = () => {
    if (onBulkDelete) {
      onBulkDelete(selectedItems);
    } else if (onDeleteRecord) {
      selectedItems.forEach((item) => onDeleteRecord(item));
    }
    clearSelection();
    setBulkDeleteOpen(false);
  };

  const exportColumns: ExportColumn[] = DEFAULT_COLUMNS.map(c => ({ id: c.id, label: c.label }));

  const renderTotalCell = (columnId: string) => {
    switch (columnId) {
      case 'lenderAccount':
        return '';
      case 'lenderName':
        return <span className="font-semibold">Total</span>;
      case 'originalAmount':
        return <span className="font-semibold">{formatCurrency(totalFundingAmount)}</span>;
      case 'principalBalance':
        return <span className="font-semibold">{formatCurrency(totalPrincipalBalance)}</span>;
      case 'currentBalance':
        return <span className="font-semibold">{formatCurrency(totalCurrentBalance)}</span>;
      case 'pctOwned': {
        const totalPctOwned = filteredData.reduce((sum, r) => sum + getDisplayedPctOwned(r), 0);
        return <span className="font-semibold">{formatPercentage(totalPctOwned, 4)}</span>;
      }
      case 'regularPayment':
        return <span className="font-semibold">{formatCurrency(totalPaymentSum)}</span>;
      case 'disbursements':
        return <span className="font-semibold">{formatCurrency(totalDisbursementsSum)}</span>;
      case 'netPayment':
        return <span className="font-semibold">{formatCurrency(totalNetPaymentSum)}</span>;
      default:
        return '';
    }
  };

  const fundingFilterOptions = buildFundingFilterOptions(fundingRecords);
  const [filterOpen, setFilterOpen] = useState(false);

  return (
    <div className="p-4 space-y-3">
      <div className="border border-border rounded-lg">
        <div className="px-3 py-1.5 border-b border-border flex items-center justify-between">
          <span className="font-semibold text-sm text-foreground">Loan Funding</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={handleAddFundingClick} disabled={disabled}>
              <Plus className="h-3.5 w-3.5" /> Add Funding
            </Button>
            <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={() => setCreateLenderModalOpen(true)} disabled={disabled}>
              <Plus className="h-3.5 w-3.5" /> Add New Lender
            </Button>
            {onSaveAdjustment && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1 h-7 text-xs"
                onClick={() => setIsAdjustmentOpen(true)}
                disabled={disabled}
                title="Funding Adjustment"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" /> Funding Adjustment
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-1 h-7 text-xs"
              onClick={() => setIsHistoryOpen(true)}
              disabled={disabled}
              title="Funding History"
            >
              <History className="h-3.5 w-3.5" /> Funding History
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 text-xs w-40 pl-7 pr-2"
              disabled={disabled}
            />
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setFilterOpen(!filterOpen)} disabled={disabled}>
            <Filter className="h-3.5 w-3.5" /> Filters
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setExportOpen(true)} disabled={disabled}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          {selectedCount > 0 && (
            <Button
              variant="destructive"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setBulkDeleteOpen(true)}
              disabled={disabled}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete ({selectedCount})
            </Button>
          )}
          <ColumnConfigPopover columns={columns} onColumnsChange={setColumns} onResetColumns={resetColumns} />
        </div>

        <div className="flex items-center gap-4 px-3 py-2 flex-wrap border-b border-border">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-foreground font-medium shrink-0">Account</Label>
            <Input
              value={loanNumber || ''}
              onChange={(e) => onLoanNumberChange?.(e.target.value)}
              onBlur={onHeaderFieldBlur}
              disabled={disabled}
              className="h-7 text-xs w-28"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-foreground font-medium shrink-0">Borrower</Label>
            <Input
              value={borrowerName || ''}
              onChange={(e) => onBorrowerNameChange?.(e.target.value)}
              onBlur={onHeaderFieldBlur}
              disabled={disabled}
              className="h-7 text-xs w-40"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-foreground font-medium shrink-0">Balance</Label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
              <Input
                value={effectiveLoanPrincipal > 0
                  ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(effectiveLoanPrincipal)
                  : '-'}
                readOnly
                className="h-7 text-xs w-28 pl-5 bg-muted/30"
              />
          </div>
          {fundingStatus !== 'none' && (
            <Badge
              variant={fundingStatus === 'over' ? 'destructive' : fundingStatus === 'full' ? 'default' : 'secondary'}
              className={cn(
                'text-[10px] uppercase tracking-wide',
                fundingStatus === 'under' && 'bg-orange-500/15 text-orange-700 border-orange-500/30 hover:bg-orange-500/20',
                fundingStatus === 'full' && 'bg-green-600/15 text-green-700 border-green-600/30 hover:bg-green-600/20',
              )}
            >
              {fundingStatus === 'over' ? 'Over-funded' : fundingStatus === 'full' ? 'Fully funded' : 'Under-funded'}
            </Badge>
          )}
        </div>
        </div>


        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center min-h-[200px]">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={isAllSelected}
                      ref={(el) => {
                        if (el) (el as any).indeterminate = isSomeSelected;
                      }}
                      onCheckedChange={toggleAll}
                      disabled={disabled || filteredData.length === 0}
                    />
                  </TableHead>
                  {visibleColumns.map((col) => (
                    col.id === 'roundingError' ? (
                      <TableHead key={col.id} className="text-center text-xs">{col.label}</TableHead>
                    ) : (
                      <SortableTableHead
                        key={col.id}
                        columnId={col.id}
                        label={col.label}
                        sortColumnId={sortState.columnId}
                        sortDirection={sortState.direction}
                        onSort={toggleSort}
                      />
                    )
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={visibleColumns.length + 1} className="text-center text-muted-foreground py-8">
                      {fundingRecords.length === 0 ? 'No funding records found. Click "Add Funding" to add a new funding record.' : 'No funding records match your search.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredData.map((record) => (
                    <TableRow
                      key={record.id}
                      className={cn(!disabled && 'cursor-pointer hover:bg-muted/30', selectedRecord?.id === record.id && 'bg-primary/10')}
                      onClick={() => !disabled && handleRowClick(record)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(record.id)}
                          onCheckedChange={() => toggleOne(record.id)}
                          disabled={disabled}
                        />
                      </TableCell>
                      {visibleColumns.map((col) => (
                        <TableCell key={col.id} className="text-left text-xs py-1.5">{renderCellValue(record, col.id)}</TableCell>
                      ))}
                    </TableRow>
                  ))
                )}

                {fundingRecords.length > 0 && (
                  <TableRow className="bg-muted/30 font-semibold border-t-2">
                    <TableCell />
                    {visibleColumns.map((col) => (
                      <TableCell key={col.id} className="text-left text-xs py-1.5">
                        {renderTotalCell(col.id)}
                      </TableCell>
                    ))}
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, fundingRecords.length)} of {fundingRecords.length} records
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => onPageChange(1)} disabled={currentPage === 1}>First</Button>
            <Button variant="outline" size="sm" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1}>Previous</Button>
            <span className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm">{currentPage}</span>
            <Button variant="outline" size="sm" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage >= totalPages}>Next</Button>
            <Button variant="outline" size="sm" onClick={() => onPageChange(totalPages)} disabled={currentPage >= totalPages}>Last</Button>
          </div>
        </div>
      )}

      {fundingStatus === 'over' && (
        <p className="text-sm text-destructive font-medium">
          ⚠ Funding exceeds loan principal balance by {formatCurrency(overAmount)}.
        </p>
      )}

      {fundingRecords.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground">
            {effectiveLoanPrincipal > 0 ? (
              <>
                <span className="font-medium text-foreground">Funded:</span>{' '}
                {formatCurrency(fundedAmount)} of {formatCurrency(effectiveLoanPrincipal)}{' '}
                ({formatPercentDisplay(fundedPct, 4)}%)
                {fundingStatus !== 'over' && (
                  <>
                    {' '}|{' '}
                    <span className="font-medium text-foreground">Unfunded:</span>{' '}
                    {formatCurrency(unfundedAmount)} ({formatPercentDisplay(unfundedPct, 4)}%)
                  </>
                )}
                {fundingStatus === 'over' && (
                  <>
                    {' '}|{' '}
                    <span className="font-medium text-destructive">Over by:</span>{' '}
                    {formatCurrency(overAmount)}
                  </>
                )}
              </>
            ) : (
              <>Total Funding Amount: {formatCurrency(totalFundingAmount)}</>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            {filteredData.length !== fundingRecords.length && `Showing ${filteredData.length} of `}
            Total Funding Records: {fundingRecords.length}
          </div>
        </div>
      )}


      <AddFundingModal
        open={isAddModalOpen}
        onOpenChange={(open) => { setIsAddModalOpen(open); if (!open) { setEditFundingData(null); setSelectedRecord(null); } }}
        loanNumber={loanNumber}
        borrowerName={borrowerName}
        onSubmit={(data) => {
          // Mutual exclusivity for Rounding Adjustment is enforced atomically in the parent's
          // handleAddFunding / handleUpdateRecord (single write to the records array) to avoid
          // stale-closure races when clearing the flag on other records.
          if (selectedRecord) {
            const soldRateVal = (data.rateSoldValue || '').trim();
            const hasSoldRate = soldRateVal !== '' && !isNaN(parseFloat(soldRateVal)) && parseFloat(soldRateVal) > 0;
            const noteRateVal = (data.rateNoteValue || data.noteRateDisplay || noteRate || '').trim();
            const modalLenderRate = parseFloat((data.lenderRate || '').toString().replace(/[%,]/g, '')) || 0;
            let lenderRate = 0;
            if (data.lenderRateOverride) lenderRate = parseFloat(data.lenderRateOverrideValue || '') || 0;
            else if (modalLenderRate > 0) lenderRate = modalLenderRate;
            else if (hasSoldRate) lenderRate = parseFloat(soldRateVal) || 0;
            else if (data.rateSelection === 'note_rate') lenderRate = parseFloat(data.rateNoteValue) || 0;
            else if (data.rateSelection === 'sold_rate') lenderRate = parseFloat(data.rateSoldValue) || 0;
            else if (data.rateSelection === 'lender_rate') lenderRate = parseFloat(data.rateLenderValue) || 0;
            // Final fallback: Note Rate (when Sold Rate is not configured and nothing else resolved)
            if (!lenderRate || lenderRate <= 0) {
              const nrNum = parseFloat(noteRateVal.replace(/[%,]/g, '')) || 0;
              if (nrNum > 0) lenderRate = nrNum;
            }

            const safeParse = (v: string) => parseFloat((v || '').replace(/[$,]/g, '')) || 0;
            onUpdateRecord(selectedRecord.id, {
              fundingDate: data.fundingDate || '',
              lenderAccount: data.lenderId,
              lenderName: data.lenderFullName,
              lenderEmail: data.lenderEmail || '',
              lenderPhone: data.lenderPhone || '',
              lenderRate,
              originalAmount: safeParse(data.fundingAmount),
              principalBalance: safeParse(data.principalBalance || data.fundingAmount),
              currentBalance: data.currentBalance !== undefined && data.currentBalance !== ''
                ? safeParse(data.currentBalance)
                : safeParse(data.fundingAmount),
              pctOwned: safeParse(data.percentOwned),
              regularPayment: safeParse(data.regularPayment),
              lenderShare: safeParse(data.lenderShare),
              rateSelection: data.rateSelection,
              rateNoteValue: data.rateNoteValue,
              rateSoldValue: data.rateSoldValue,
              rateLenderValue: data.rateLenderValue,
              lenderRateOverride: data.lenderRateOverride,
              lenderRateOverrideValue: data.lenderRateOverrideValue,
              brokerParticipates: data.brokerParticipates,
              interestFrom: data.interestFrom,
              roundingAdjustment: data.roundingAdjustment,
              disbursements: data.disbursements,
              payments: data.payments,
              noteRateDisplay: data.noteRateDisplay,
              // Fees to Company
              overrideServicing: data.overrideServicing,
              companyBaseFee: data.companyBaseFee, companyBaseFeePct: data.companyBaseFeePct,
              companyAdditionalServices: data.companyAdditionalServices,
              companyMinimum: data.companyMinimum, companyMaximum: data.companyMaximum,
              companyNrSitSplitPct: data.companyNrSitSplitPct, companyNrSitSplit: data.companyNrSitSplit,
              companyTotal: data.companyTotal,
              // Fees to Vendor
              vendorId: data.vendorId, vendorName: data.vendorName,
              vendorBaseFee: data.vendorBaseFee, vendorBaseFeePct: data.vendorBaseFeePct,
              vendorAdditionalServices: data.vendorAdditionalServices,
              vendorMinimum: data.vendorMinimum, vendorMaximum: data.vendorMaximum,
              vendorNrSitSplitPct: data.vendorNrSitSplitPct, vendorNrSitSplit: data.vendorNrSitSplit,
              vendorTotal: data.vendorTotal,
              // Legacy servicing fees
              overrideServicingFees: data.overrideServicingFees,
              companyServicingFee: data.companyServicingFee, companyServicingFeePct: data.companyServicingFeePct,
              companyMaxFee: data.companyMaxFee, companyMaxFeePct: data.companyMaxFeePct,
              companyMinFee: data.companyMinFee, companyMinFeePct: data.companyMinFeePct,
              brokerServicingFee: data.brokerServicingFee, brokerServicingFeePct: data.brokerServicingFeePct,
              brokerMaxFee: data.brokerMaxFee, brokerMaxFeePct: data.brokerMaxFeePct,
              brokerMinFee: data.brokerMinFee, brokerMinFeePct: data.brokerMinFeePct,
              overrideDefaultFees: data.overrideDefaultFees,
              lateFee1Lender: data.lateFee1Lender, lateFee1Company: data.lateFee1Company, lateFee1Broker: data.lateFee1Broker, lateFee1Total: data.lateFee1Total, lateFee1Maximum: data.lateFee1Maximum,
              lateFee2Lender: data.lateFee2Lender, lateFee2Company: data.lateFee2Company, lateFee2Broker: data.lateFee2Broker, lateFee2Total: data.lateFee2Total, lateFee2Maximum: data.lateFee2Maximum,
              defaultInterestLender: data.defaultInterestLender, defaultInterestCompany: data.defaultInterestCompany, defaultInterestBroker: data.defaultInterestBroker, defaultInterestTotal: data.defaultInterestTotal, defaultInterestMaximum: data.defaultInterestMaximum,
              interestGuaranteeLender: data.interestGuaranteeLender, interestGuaranteeCompany: data.interestGuaranteeCompany, interestGuaranteeBroker: data.interestGuaranteeBroker, interestGuaranteeTotal: data.interestGuaranteeTotal, interestGuaranteeMaximum: data.interestGuaranteeMaximum,
              prepaymentLender: data.prepaymentLender, prepaymentCompany: data.prepaymentCompany, prepaymentBroker: data.prepaymentBroker, prepaymentTotal: data.prepaymentTotal, prepaymentMaximum: data.prepaymentMaximum,
              maturityLender: data.maturityLender, maturityCompany: data.maturityCompany, maturityBroker: data.maturityBroker, maturityTotal: data.maturityTotal, maturityMaximum: data.maturityMaximum,
            });
          } else {
            onAddFunding(data);
          }
        }}
        editData={editFundingData}
        isEditing={!!selectedRecord}
        noteRate={noteRate}
        soldRate={soldRate}
        totalPayment={totalPayment}
        loanAmount={loanAmount}
        loanPrincipalBalance={effectiveLoanPrincipal > 0
          ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(effectiveLoanPrincipal)
          : ''}
        remainingPayments={remainingPayments}
        existingRecords={fundingRecords.map(r => ({ id: r.id, roundingError: r.roundingError, pctOwned: r.pctOwned, originalAmount: r.originalAmount, currentBalance: computeCurrentBalance(r), lenderId: r.lenderAccount, lenderName: r.lenderName }))}
        editingRecordId={selectedRecord?.id}
      />

      <FundingHistoryDialog
        open={isHistoryOpen}
        onOpenChange={setIsHistoryOpen}
        dealId={dealId}
        historyRecords={historyRecords}
        loanReleased={true}
        onDeleteRecord={onDeleteHistoryRecord}
      />

      <DeleteConfirmationDialog
        open={!!deleteRowRecord}
        onOpenChange={(open) => { if (!open) setDeleteRowRecord(null); }}
        onConfirm={handleConfirmDeleteRow}
        title="Delete Funding Record"
        description={`Are you sure you want to delete the funding record for "${deleteRowRecord?.lenderName || 'this lender'}"? This action cannot be undone.`}
      />

      <DeleteConfirmationDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        onConfirm={handleBulkDelete}
        title="Delete Selected Funding Records"
        description={`Are you sure you want to delete ${selectedCount} selected funding record(s)? This action cannot be undone.`}
      />
      <GridExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        columns={exportColumns}
        data={fundingRecords}
        fileName="funding_records"
      />

      <CreateContactModal
        open={createLenderModalOpen}
        onOpenChange={setCreateLenderModalOpen}
        contactType="lender"
        onSubmit={async (data) => {
          if (!user) return;
          try {
            const fullName = data.full_name || `${data.first_name || ''} ${data.last_name || ''}`.trim();
            const { data: idData, error: idError } = await supabase.rpc('generate_contact_id', { p_type: 'lender' });
            if (idError) throw idError;
            const contactId = idData as string;
            const insertPayload = {
              contact_type: 'lender' as const,
              contact_id: contactId,
              created_by: user.id,
              full_name: fullName,
              first_name: data.first_name || '',
              last_name: data.last_name || '',
              email: data.email || '',
              phone: data.phone || data['phone.cell'] || data['phone.home'] || data['phone.work'] || '',
              city: data['primary_address.city'] || data.city || '',
              state: data['primary_address.state'] || data.state || '',
              company: data.company || '',
              contact_data: data,
            };
            const { error } = await supabase.from('contacts').insert(insertPayload);
            if (error) throw error;
            toast.success('Lender created successfully');
            setCreateLenderModalOpen(false);
          } catch (err: any) {
            console.error('Error creating lender:', err);
            toast.error('Failed to create lender');
          }
        }}
      />

      {onSaveAdjustment && (
        <FundingAdjustmentModal
          open={isAdjustmentOpen}
          onOpenChange={setIsAdjustmentOpen}
          loanNumber={loanNumber}
          borrowerName={borrowerName}
          loanBalance={totalPrincipalBalance}
          fundingRecords={fundingRecords}
          existingAdjustments={fundingAdjustments}
          onSave={onSaveAdjustment}
        />
      )}
    </div>
  );
};

export default LoanFundingGrid;
