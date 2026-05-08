import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Plus, Trash2, Pencil, Loader2, Download, Search, X, Filter, SlidersHorizontal, History, Check } from 'lucide-react';
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
import { formatPercentDisplay, Decimal } from '@/lib/precisionFormat';
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
  pctOwned: number;
  lenderRate: number;
  principalBalance: number;
  originalAmount: number;
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
  onLoanNumberChange?: (value: string) => void;
  onBorrowerNameChange?: (value: string) => void;
  onHeaderFieldBlur?: () => void;
  // Funding Adjustment
  fundingAdjustments?: FundingAdjustmentData[];
  onSaveAdjustment?: (adjustment: FundingAdjustmentData) => void;
  onDeleteHistoryRecord?: (record: { id: string }) => void;
}

const SEARCH_FIELDS = ['lenderAccount', 'lenderName'];

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
  onLoanNumberChange,
  onBorrowerNameChange,
  onHeaderFieldBlur,
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

  const {
    selectedIds, selectedItems, toggleOne, toggleAll, clearSelection,
    isAllSelected, isSomeSelected, selectedCount,
  } = useGridSelection(filteredData);

  const parsePaymentAmount = (value?: string) => parseFloat((value || '').replace(/[$,]/g, '')) || 0;
  const getDisplayedPayment = (record: FundingRecord) => {
    if (record.regularPayment > 0) return record.regularPayment;
    return (record.payments || []).reduce((sum, payment) => sum + parsePaymentAmount(payment.amount), 0);
  };
  const getDisbursementsTotal = (record: FundingRecord) => {
    return (record.disbursements || []).reduce(
      (sum, d) => sum + parsePaymentAmount(d.amount), 0
    );
  };
  const getNetPayment = (record: FundingRecord) => {
    return Math.max(0, getDisplayedPayment(record) - getDisbursementsTotal(record));
  };

  const computeCurrentBalance = (record: FundingRecord): number => {
    if (record.currentBalance !== undefined && record.currentBalance !== null && !isNaN(record.currentBalance)) {
      return record.currentBalance;
    }
    const disbSum = (record.disbursements || []).reduce(
      (s, d) => s + (parseFloat(String(d.amount || '').replace(/[$,]/g, '')) || 0), 0
    );
    return Math.max(0, (record.originalAmount || 0) - disbSum);
  };

  const totalOwnership = fundingRecords.reduce((sum, r) => sum + r.pctOwned, 0);
  const totalPrincipalBalance = fundingRecords.reduce((sum, r) => sum + r.principalBalance, 0);
  const totalCurrentBalance = fundingRecords.reduce((sum, r) => sum + computeCurrentBalance(r), 0);
  const totalPaymentSum = fundingRecords.reduce((sum, r) => sum + getDisplayedPayment(r), 0);
  const totalDisbursementsSum = fundingRecords.reduce((sum, r) => sum + getDisbursementsTotal(r), 0);
  const totalNetPaymentSum = fundingRecords.reduce((sum, r) => sum + getNetPayment(r), 0);
  const totalFundingAmount = fundingRecords.reduce((sum, r) => sum + r.originalAmount, 0);

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
      lenderRate: String(record.lenderRate),
      fundingAmount: formatCurrencyDisplay(String(record.originalAmount)),
      fundingDate: record.fundingDate || '',
      interestFrom: record.interestFrom || '',
      notes: '',
      brokerParticipates: record.brokerParticipates || false,
      percentOwned: String(record.pctOwned),
      regularPayment: String(record.regularPayment),
      lenderShare: String(record.lenderShare || ''),
      rateSelection: record.rateSelection || 'note_rate',
      rateNoteValue: record.rateNoteValue || noteRate,
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
      noteRateDisplay: record.noteRateDisplay || noteRate,
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
      case 'originalAmount':
        return <span>{formatCurrency(record.originalAmount)}</span>;
      case 'principalBalance':
        return <span>{formatCurrency(record.principalBalance)}</span>;
      case 'currentBalance':
        return <span>{formatCurrency(computeCurrentBalance(record))}</span>;
      case 'pctOwned':
        return <span>{formatPercentage(record.pctOwned, 4)}</span>;
      case 'fundingDate':
        return formatDate(record.fundingDate) || '-';
      case 'interestFrom':
        return formatDate(record.interestFrom) || '-';
      case 'noteRate':
        return <span>{record.rateNoteValue ? `${formatPercentDisplay(record.rateNoteValue, 3)}%` : (noteRate ? `${formatPercentDisplay(noteRate, 3)}%` : '-')}</span>;
      case 'lenderRate':
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
        const totalPctOwned = filteredData.reduce((sum, r) => sum + (Number(r.pctOwned) || 0), 0);
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
                value={(() => {
                  const parsed = parseFloat((loanPrincipalBalance || '').toString().replace(/[$,]/g, ''));
                  const fallback = parseFloat((loanAmount || '').toString().replace(/[$,]/g, ''));
                  const v = !isNaN(parsed) && parsed > 0 ? parsed : (!isNaN(fallback) && fallback > 0 ? fallback : 0);
                  return v > 0 ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) : '-';
                })()}
                readOnly
                className="h-7 text-xs w-28 pl-5 bg-muted/30"
              />
            </div>
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
                  <TableHead className="w-[40px] text-center text-xs">Edit</TableHead>
                  <TableHead className="w-[50px] text-center text-xs">Delete</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={visibleColumns.length + 2} className="text-center text-muted-foreground py-8">
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
                      {visibleColumns.map((col) => (
                        <TableCell key={col.id} className="text-left text-xs py-1.5">{renderCellValue(record, col.id)}</TableCell>
                      ))}
                      <TableCell className="text-center px-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={(e) => handleEditClick(e, record)}
                          disabled={disabled}
                          title="Edit"
                        >
                          <Pencil className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      </TableCell>
                      <TableCell className="text-center px-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-destructive hover:text-destructive"
                          onClick={(e) => handleDeleteRowClick(e, record)}
                          disabled={disabled}
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}

                {fundingRecords.length > 0 && (
                  <TableRow className="bg-muted/30 font-semibold border-t-2">
                    {visibleColumns.map((col) => (
                      <TableCell key={col.id} className="text-left text-xs py-1.5">
                        {renderTotalCell(col.id)}
                      </TableCell>
                    ))}
                    <TableCell />
                    <TableCell />
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

      {totalOwnership > 100 && fundingRecords.length > 0 && (
        <p className="text-sm text-destructive font-medium">⚠ Total ownership exceeds 100% ({formatPercentage(totalOwnership)}). Cannot save new funding until resolved.</p>
      )}

      {fundingRecords.length > 0 && (
        <div className="flex justify-end">
          <div className="text-sm text-muted-foreground">
            {filteredData.length !== fundingRecords.length && `Showing ${filteredData.length} of `}
            Total Funding Records: {fundingRecords.length} | Total Funding Amount: {formatCurrency(totalFundingAmount)}
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
            const hasSoldRate = soldRateVal !== '' && !isNaN(parseFloat(soldRateVal));
            let lenderRate = 0;
            if (data.lenderRateOverride) lenderRate = parseFloat(data.lenderRateOverrideValue || '') || 0;
            else if (hasSoldRate) lenderRate = parseFloat(soldRateVal) || 0;
            else if (data.rateSelection === 'note_rate') lenderRate = parseFloat(data.rateNoteValue) || 0;
            else if (data.rateSelection === 'sold_rate') lenderRate = parseFloat(data.rateSoldValue) || 0;
            else if (data.rateSelection === 'lender_rate') lenderRate = parseFloat(data.rateLenderValue) || 0;

            const safeParse = (v: string) => parseFloat((v || '').replace(/[$,]/g, '')) || 0;
            onUpdateRecord(selectedRecord.id, {
              fundingDate: data.fundingDate || '',
              lenderAccount: data.lenderId,
              lenderName: data.lenderFullName,
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
        loanPrincipalBalance={(() => {
          const parsed = parseFloat((loanPrincipalBalance || '').toString().replace(/[$,]/g, ''));
          const fallback = parseFloat((loanAmount || '').toString().replace(/[$,]/g, ''));
          const v = !isNaN(parsed) && parsed > 0 ? parsed : (!isNaN(fallback) && fallback > 0 ? fallback : 0);
          return v > 0 ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) : '';
        })()}
        existingRecords={fundingRecords.map(r => ({ id: r.id, roundingError: r.roundingError, pctOwned: r.pctOwned }))}
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
