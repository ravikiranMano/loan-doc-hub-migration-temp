import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, X } from 'lucide-react';
import { formatPercentDisplay, allocateDollarsByPercentsWithReconciliation } from '@/lib/precisionFormat';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EnhancedCalendar } from '@/components/ui/enhanced-calendar';
import { CalendarIcon } from 'lucide-react';
import { formatDateOnly, parseDateOnly } from '@/lib/dateOnly';
import { TypableDateField } from '@/components/ui/typable-date-field';
import { cn } from '@/lib/utils';
import { LenderIdSearch } from './LenderIdSearch';
import { numericKeyDown, formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';
import { toast } from 'sonner';
import type { FundingRecord } from './LoanFundingGrid';

export interface AdjustmentLenderRow {
  id: string;
  lenderId: string;
  name: string;
  currentBalance: string;
  adjustment: string;
  proRata: string;
  lenderRate: string;
  payment: string;
}

export interface FundingAdjustmentData {
  id: string;
  account: string;
  borrower: string;
  loanBalance: string;
  adjustmentAmount: string;
  asOfDate: string;
  distributeByProRata: boolean;
  lenders: AdjustmentLenderRow[];
  description: string;
  descriptionType: string;
  createdAt: string;
  updatedAt: string;
}

interface FundingAdjustmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loanNumber?: string;
  borrowerName?: string;
  loanBalance?: number;
  fundingRecords?: FundingRecord[];
  existingAdjustments?: FundingAdjustmentData[];
  onSave: (adjustment: FundingAdjustmentData) => void;
  editData?: FundingAdjustmentData | null;
}

const DESCRIPTION_TYPE_OPTIONS = [
  { value: 'correction', label: 'Correction' },
  { value: 'assignment', label: 'Assignment' },
  { value: 'forgiveness', label: 'Forgiveness' },
  { value: 'paid_away_from_us', label: 'Paid Away From Us' },
  { value: 'other', label: 'Other' },
];

const safeParseFloat = (v: string | undefined): number => {
  if (!v) return 0;
  return parseFloat((v || '').replace(/[$,]/g, '')) || 0;
};

export const FundingAdjustmentModal: React.FC<FundingAdjustmentModalProps> = ({
  open,
  onOpenChange,
  loanNumber = '',
  borrowerName = '',
  loanBalance = 0,
  fundingRecords = [],
  existingAdjustments = [],
  onSave,
  editData = null,
}) => {
  const [account, setAccount] = useState(loanNumber);
  const [borrower, setBorrower] = useState(borrowerName);
  const [balance, setBalance] = useState(
    loanBalance > 0 ? formatCurrencyDisplay(String(loanBalance)) : ''
  );
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [asOfDate, setAsOfDate] = useState<Date | undefined>(undefined);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [distributeByProRata, setDistributeByProRata] = useState(false);
  const [lenders, setLenders] = useState<AdjustmentLenderRow[]>([]);
  const [description, setDescription] = useState('');
  const [descriptionType, setDescriptionType] = useState('');

  // Initialize from editData, existing saved adjustments, or fundingRecords
  useEffect(() => {
    if (!open) return;

    const latestSavedAdjustment = existingAdjustments.length > 0
      ? existingAdjustments[existingAdjustments.length - 1]
      : null;

    const initialData = editData || latestSavedAdjustment;

    if (initialData) {
      setAccount(initialData.account);
      setBorrower(initialData.borrower);
      setBalance(initialData.loanBalance);
      setAdjustmentAmount(initialData.adjustmentAmount);
      setAsOfDate(parseDateOnly(initialData.asOfDate));
      setDistributeByProRata(initialData.distributeByProRata);
      setLenders(initialData.lenders);
      setDescription(initialData.description);
      setDescriptionType(initialData.descriptionType);
    } else {
      setAccount(loanNumber);
      setBorrower(borrowerName);
      setBalance(loanBalance > 0 ? formatCurrencyDisplay(String(loanBalance)) : '');
      setAdjustmentAmount('');
      setAsOfDate(undefined);
      setDistributeByProRata(false);
      setDescription('');
      setDescriptionType('');

      // Pre-populate lender rows from existing funding records.
      // Pro Rata is recomputed locally as originalAmount / SUM(originalAmount)
      // so it always reflects each lender's original funding share — never
      // outstanding/principal balance, which would drift as the loan is paid
      // down. The funding record flagged with `roundingAdjustment` absorbs
      // the fractional residual so the column totals 100.0000%.
      if (fundingRecords.length > 0) {
        const totalFunded = fundingRecords.reduce(
          (s, r) => s + (Number(r.originalAmount) || 0), 0
        );
        const adjIdx = fundingRecords.findIndex(r => (r as any).roundingAdjustment);
        const proRataMap = new Map<string, number>();
        if (totalFunded > 0) {
          let sumOthers = 0;
          fundingRecords.forEach((r, i) => {
            if (i === adjIdx) return;
            const pct = parseFloat(((Number(r.originalAmount) || 0) / totalFunded * 100).toFixed(4));
            proRataMap.set(r.id, pct);
            sumOthers += pct;
          });
          if (adjIdx >= 0) {
            proRataMap.set(fundingRecords[adjIdx].id, parseFloat((100 - sumOthers).toFixed(4)));
          }
        }
        setLenders(
          fundingRecords.map((r) => ({
            id: `adj-${r.id}`,
            lenderId: r.lenderAccount,
            name: r.lenderName,
            currentBalance: formatCurrencyDisplay(String(r.principalBalance)),
            adjustment: '',
            proRata: formatPercentDisplay(proRataMap.get(r.id) ?? r.pctOwned, 4),
            lenderRate: formatPercentDisplay(r.lenderRate, 3),
            payment: formatCurrencyDisplay(String(r.regularPayment)),
          }))
        );
      } else {
        setLenders([]);
      }
    }
  }, [open, editData, existingAdjustments, loanNumber, borrowerName, loanBalance, fundingRecords]);

  // Warn the user before the browser/tab is closed if the modal has entered (unsaved) data.
  // Triggers the browser's native "Leave site?" confirmation dialog.
  useEffect(() => {
    if (!open) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasEntry =
        !!adjustmentAmount ||
        !!asOfDate ||
        distributeByProRata ||
        !!description ||
        !!descriptionType ||
        lenders.some((l) => !!l.adjustment);
      if (hasEntry) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [open, adjustmentAmount, asOfDate, distributeByProRata, description, descriptionType, lenders]);

  // Distribute by Pro Rata — penny-safe reconciliation.
  // Calculate every lender's share at full Decimal precision, round to 2dp,
  // then assign the residual penny delta to the largest allocation so the
  // sum of rounded shares reconciles EXACTLY to the input adjustment total.
  // Never round per-row in isolation — that's what produces $0.01 drift on
  // splits like $100 / 3 lenders or 27.2727 / 36.3636 / 36.3637 %.
  useEffect(() => {
    if (!distributeByProRata || !adjustmentAmount) return;
    const totalAdj = safeParseFloat(adjustmentAmount);
    if (totalAdj === 0) return;

    setLenders((prev) => {
      const pcts = prev.map((l) => l.proRata);
      const shares = allocateDollarsByPercentsWithReconciliation(totalAdj, pcts);
      if (shares.length !== prev.length) {
        // Fallback: invalid percent input — leave rows untouched rather than
        // corrupting allocations.
        return prev;
      }
      return prev.map((l, i) => ({
        ...l,
        adjustment: formatCurrencyDisplay(shares[i]),
      }));
    });
  }, [distributeByProRata, adjustmentAmount]);

  const handleAddLender = () => {
    setLenders((prev) => [
      ...prev,
      {
        id: `adj-new-${Date.now()}`,
        lenderId: '',
        name: '',
        currentBalance: '',
        adjustment: '',
        proRata: '',
        lenderRate: '',
        payment: '',
      },
    ]);
  };

  const handleRemoveLender = (id: string) => {
    setLenders((prev) => prev.filter((l) => l.id !== id));
  };

  const handleLenderChange = (id: string, field: keyof AdjustmentLenderRow, value: string) => {
    setLenders((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l))
    );
  };

  const handleLenderSelect = (id: string, lenderId: string, lenderName: string) => {
    // Auto-fill from funding records. Pro Rata uses Original Amount as the
    // authoritative calculation basis (never Current/Principal Balance) so
    // it matches the funding grid display.
    const fundingMatch = fundingRecords.find(
      (r) => r.lenderAccount === lenderId || r.lenderName === lenderName
    );
    let matchProRata: number | undefined;
    if (fundingMatch) {
      const totalFunded = fundingRecords.reduce(
        (s, r) => s + (Number(r.originalAmount) || 0), 0
      );
      if (totalFunded > 0) {
        matchProRata = parseFloat(
          ((Number(fundingMatch.originalAmount) || 0) / totalFunded * 100).toFixed(4)
        );
      }
    }
    setLenders((prev) =>
      prev.map((l) =>
        l.id === id
          ? {
              ...l,
              lenderId,
              name: lenderName,
              currentBalance: fundingMatch
                ? formatCurrencyDisplay(String(fundingMatch.principalBalance))
                : l.currentBalance,
              proRata: fundingMatch
                ? formatPercentDisplay(matchProRata ?? fundingMatch.pctOwned, 4)
                : l.proRata,
              lenderRate: fundingMatch ? formatPercentDisplay(fundingMatch.lenderRate, 3) : l.lenderRate,
              payment: fundingMatch
                ? formatCurrencyDisplay(String(fundingMatch.regularPayment))
                : l.payment,
            }
          : l
      )
    );
  };

  // Compute totals
  const totalCurrentBalance = lenders.reduce(
    (sum, l) => sum + safeParseFloat(l.currentBalance),
    0
  );
  const totalAdjustment = lenders.reduce(
    (sum, l) => sum + safeParseFloat(l.adjustment),
    0
  );

  const handleSave = () => {
    if (!adjustmentAmount && totalAdjustment === 0) {
      toast.error('Please enter an adjustment amount');
      return;
    }

    const data: FundingAdjustmentData = {
      id: editData?.id || `fundadj-${Date.now()}`,
      account,
      borrower,
      loanBalance: balance,
      adjustmentAmount: adjustmentAmount || formatCurrencyDisplay(totalAdjustment.toFixed(2)),
      asOfDate: formatDateOnly(asOfDate),
      distributeByProRata,
      lenders,
      description,
      descriptionType,
      createdAt: editData?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onSave(data);
    onOpenChange(false);
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[900px] max-h-[85vh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 px-4 py-2 border-b border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-sm font-semibold">Funding Adjustment</DialogTitle>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 p-4 space-y-4">
          {/* Header Fields - Two-column layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 items-start">
            {/* Left column */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs font-medium min-w-[110px]">Account</Label>
                <Input
                  value={account}
                  readOnly
                  className="h-7 text-xs w-40 bg-muted/30"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs font-medium min-w-[110px]">Borrower</Label>
                <Input
                  value={borrower}
                  readOnly
                  className="h-7 text-xs w-40 bg-muted/30"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs font-medium min-w-[110px]">Loan Balance</Label>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                  <Input
                    value={balance}
                    readOnly
                    className="h-7 text-xs w-40 pl-5 bg-muted/30"
                  />
                </div>
              </div>
            </div>

            {/* Right column */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs font-medium min-w-[130px]">Adjustment Amount</Label>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                  <Input
                    value={adjustmentAmount}
                    onChange={(e) => setAdjustmentAmount(e.target.value)}
                    onKeyDown={numericKeyDown}
                    onBlur={() => {
                      if (adjustmentAmount) {
                        setAdjustmentAmount(formatCurrencyDisplay(adjustmentAmount));
                      }
                    }}
                    className="h-7 text-xs w-40 pl-5"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs font-medium min-w-[130px]">As of Date</Label>
                <div className="w-40">
                  <TypableDateField
                    value={asOfDate ? formatDateOnly(asOfDate) : ''}
                    onChange={(iso) => setAsOfDate(iso ? parseDateOnly(iso) : undefined)}
                    inputClassName="h-7 text-xs"
                    ariaLabel="As of Date"
                  />
                </div>

              </div>
            </div>
          </div>

          {/* Distribute checkbox + Add button - top right of table */}
          <div className="flex items-center justify-end gap-4">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={distributeByProRata}
                onCheckedChange={(checked) => setDistributeByProRata(checked === true)}
                id="distribute-pro-rata"
              />
              <Label htmlFor="distribute-pro-rata" className="text-xs font-medium cursor-pointer">
                Distribute by Pro Rata
              </Label>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={handleAddLender}
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>

          {/* Lender Grid */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs min-w-[90px]">Lender ID</TableHead>
                    <TableHead className="text-xs min-w-[100px]">Name</TableHead>
                    <TableHead className="text-xs min-w-[110px] text-right">Current Balance</TableHead>
                    <TableHead className="text-xs min-w-[100px] text-right">Adjustment</TableHead>
                    <TableHead className="text-xs min-w-[70px] text-right">Pro Rata</TableHead>
                    <TableHead className="text-xs min-w-[80px] text-right">Lender Rate</TableHead>
                    <TableHead className="text-xs min-w-[90px] text-right">Payment</TableHead>
                    <TableHead className="text-xs w-[40px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lenders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-6 text-xs">
                        No lenders. Click "Add" to add a lender row.
                      </TableCell>
                    </TableRow>
                  ) : (
                    lenders.map((lender) => (
                      <TableRow key={lender.id}>
                        <TableCell className="py-1 px-1">
                          <LenderIdSearch
                            value={lender.lenderId}
                            onChange={(lenderId, lenderFullName) => handleLenderSelect(lender.id, lenderId, lenderFullName)}
                            className="h-6 text-xs"
                          />
                        </TableCell>
                        <TableCell className="py-1 px-1">
                          <Input
                            value={lender.name}
                            onChange={(e) => handleLenderChange(lender.id, 'name', e.target.value)}
                            className="h-6 text-xs"
                          />
                        </TableCell>
                        <TableCell className="py-1 px-1">
                          <div className="relative">
                            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                            <Input
                              value={lender.currentBalance}
                              onChange={(e) => handleLenderChange(lender.id, 'currentBalance', e.target.value)}
                              onKeyDown={numericKeyDown}
                              onBlur={() => {
                                if (lender.currentBalance) {
                                  handleLenderChange(lender.id, 'currentBalance', formatCurrencyDisplay(lender.currentBalance));
                                }
                              }}
                              className="h-6 text-xs pl-4 text-right"
                            />
                          </div>
                        </TableCell>
                        <TableCell className="py-1 px-1">
                          <div className="relative">
                            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                            <Input
                              value={lender.adjustment}
                              onChange={(e) => handleLenderChange(lender.id, 'adjustment', e.target.value)}
                              onKeyDown={numericKeyDown}
                              onBlur={() => {
                                if (lender.adjustment) {
                                  handleLenderChange(lender.id, 'adjustment', formatCurrencyDisplay(lender.adjustment));
                                }
                              }}
                              className="h-6 text-xs pl-4 text-right"
                            />
                          </div>
                        </TableCell>
                        <TableCell className="py-1 px-1">
                          <div className="relative">
                            <Input
                              value={lender.proRata}
                              onChange={(e) => handleLenderChange(lender.id, 'proRata', e.target.value)}
                              onKeyDown={numericKeyDown}
                              className="h-6 text-xs text-right pr-5"
                            />
                            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-1 px-1">
                          <div className="relative">
                            <Input
                              value={lender.lenderRate}
                              onChange={(e) => handleLenderChange(lender.id, 'lenderRate', e.target.value)}
                              onKeyDown={numericKeyDown}
                              className="h-6 text-xs text-right pr-5"
                            />
                            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-1 px-1">
                          <div className="relative">
                            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                            <Input
                              value={lender.payment}
                              onChange={(e) => handleLenderChange(lender.id, 'payment', e.target.value)}
                              onKeyDown={numericKeyDown}
                              onBlur={() => {
                                if (lender.payment) {
                                  handleLenderChange(lender.id, 'payment', formatCurrencyDisplay(lender.payment));
                                }
                              }}
                              className="h-6 text-xs pl-4 text-right"
                            />
                          </div>
                        </TableCell>
                        <TableCell className="py-1 px-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-destructive hover:text-destructive"
                            onClick={() => handleRemoveLender(lender.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}

                  {/* Totals Row */}
                  {lenders.length > 0 && (
                    <TableRow className="bg-muted/30 font-semibold border-t-2">
                      <TableCell className="text-xs py-1 px-1" />
                      <TableCell className="text-xs py-1 px-1 font-semibold">Total</TableCell>
                      <TableCell className="text-xs py-1 px-1 text-right font-semibold">
                        {formatCurrency(totalCurrentBalance)}
                      </TableCell>
                      <TableCell className="text-xs py-1 px-1 text-right font-semibold">
                        {formatCurrency(totalAdjustment)}
                      </TableCell>
                      <TableCell className="text-xs py-1 px-1" />
                      <TableCell className="text-xs py-1 px-1" />
                      <TableCell className="text-xs py-1 px-1" />
                      <TableCell className="text-xs py-1 px-1" />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Description */}
          <div className="flex items-end gap-4 justify-end">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Description</Label>
              <Select value={description || '__none__'} onValueChange={(v) => setDescription(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-7 text-xs w-44">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="z-[9999]">
                  <SelectItem value="__none__" className="text-xs text-muted-foreground">Select description</SelectItem>
                  {DESCRIPTION_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

        </div>

        {/* Action Buttons - fixed footer */}
        <div className="shrink-0 flex justify-end gap-2 px-4 py-3 border-t border-border bg-background">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            Save Adjustment
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default FundingAdjustmentModal;
